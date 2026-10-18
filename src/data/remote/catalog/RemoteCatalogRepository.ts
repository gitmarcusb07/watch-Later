import { CatalogError } from '@/domain/errors/CatalogError';
import type { CatalogFilter, CatalogMedia, CatalogSeason, CatalogSearchResult, MediaEpisode, MediaIdentity, MediaProvider, SeasonSummary, WatchProviderGroup } from '@/domain/models/media';
import type { CatalogRepository as CatalogRepositoryContract, GenrePageKind, PagedCatalog } from '@/domain/repositories/CatalogRepository';
import { imageUrl, getTmdbApiKey } from '@/data/remote/catalog/config';
import { normalizeSearchText, rankSearchResults, type SearchPopularity } from '@/data/remote/catalog/searchRank';
import { deviceRegion } from '@/data/remote/catalog/region';
import { mapAniListAnime, animeEntriesToSummaries, animeSeasonEntries, mapAnimeSeason, syntheticAnimeSeason } from '@/data/remote/anilist/mappers';
import type { AnimeSeasonEntry } from '@/data/remote/anilist/mappers';
import type { AniListMediaDto } from '@/data/remote/anilist/types';
import { anilistClient } from '@/data/remote/anilist/client';
import { jikanClient } from '@/data/remote/jikan/client';
import { kitsuClient } from '@/data/remote/kitsu/client';
import { mapTmdbMovie, mapTmdbSeason, mapTmdbTv } from '@/data/remote/tmdb/mappers';
import { tmdbClient } from '@/data/remote/tmdb/client';
import type { TmdbSeasonDto } from '@/data/remote/tmdb/types';
import { tvdbClient } from '@/data/remote/tvdb/client';
import {
  TVDB_ANIME_GENRE_ID,
  isAnimeGenres,
  mapTvdbEpisodeDto,
  mapTvdbFilterMovie,
  mapTvdbFilterSeries,
  mapTvdbMovie,
  mapTvdbSearchItem,
  mapTvdbSeason,
  mapTvdbSeries,
  seriesSeasonSummaries,
} from '@/data/remote/tvdb/mappers';
import { buildHitsRanking, HITS_MAX_PAGES, mergeHitPages, type HitCandidate } from '@/features/hits/ranking';
import { anilistGenreFor, tvGenreIdsFor } from '@/features/genres/catalog';
import { isPeriodComplete, parseHitsPeriod, type HitsPeriodType } from '@/features/hits/period';
import type { GlobalHitsLive, HitsMediaType } from '@/features/hits/types';

function normalizeTitle(title: string): string {
  return normalizeSearchText(title);
}

/** Bounds a side-channel lookup so ranking never delays the visible results. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CatalogError('tmdb', 'timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const SEARCH_POPULARITY_TIMEOUT_MS = 3_000;

/**
 * Popularity for the typed query from TMDB's own search, keyed by normalized
 * title (TVDB ids differ, so titles are the join). Pure ranking signal — TVDB
 * stays the only source of results. Any failure (offline, rate limit, missing
 * key, timeout) yields an empty map and ranking falls back to text match.
 */
async function searchQueryPopularity(term: string, signal?: AbortSignal): Promise<SearchPopularity> {
  if (!getTmdbApiKey()) return new Map();
  try {
    const [movies, tv] = await withTimeout(Promise.all([
      tmdbClient.searchMovies(term, signal),
      tmdbClient.searchTv(term, signal),
    ]), SEARCH_POPULARITY_TIMEOUT_MS);
    const popularity = new Map<string, number>();
    const record = (title: string | undefined, score: number | undefined) => {
      if (!title || typeof score !== 'number' || !Number.isFinite(score)) return;
      const key = normalizeSearchText(title);
      if (key) popularity.set(key, Math.max(popularity.get(key) ?? 0, score));
    };
    for (const dto of movies.results ?? []) record(dto.title, dto.popularity);
    for (const dto of tv.results ?? []) record(dto.name, dto.popularity);
    return popularity;
  } catch {
    return new Map();
  }
}

function toHitCandidate(dto: { id: number; title?: string; name?: string; poster_path?: string | null; release_date?: string; first_air_date?: string; popularity?: number | null; vote_average?: number | null; vote_count?: number | null }, media: HitsMediaType): HitCandidate {
  return {
    tmdbId: dto.id,
    mediaType: media,
    title: (media === 'movie' ? dto.title : dto.name) ?? `TMDB ${dto.id}`,
    posterPath: imageUrl(dto.poster_path, 'poster') ?? undefined,
    date: (media === 'movie' ? dto.release_date : dto.first_air_date) ?? null,
    popularity: dto.popularity ?? null,
    voteAverage: dto.vote_average ?? null,
    voteCount: dto.vote_count ?? null,
  };
}

/**
 * Picks the TMDB series matching an anime title. Exact normalized names win,
 * year proximity breaks ties, and anything uncertain resolves to null so a
 * wrong show (e.g. a live-action adaptation) never masquerades as the anime.
 */
export function pickTmdbSeriesMatch(
  results: { id: number; name?: string | null; first_air_date?: string | null }[],
  title: string,
  year?: number,
): number | null {
  const wanted = normalizeTitle(title);
  if (!wanted) return null;
  const scored = results
    .filter((item) => Number.isSafeInteger(item.id))
    .map((item) => {
      const name = typeof item.name === 'string' ? item.name : '';
      const itemYear = typeof item.first_air_date === 'string' && /^\d{4}/.test(item.first_air_date)
        ? Number(item.first_air_date.slice(0, 4))
        : undefined;
      return {
        id: item.id,
        exact: normalizeTitle(name) === wanted,
        yearDelta: year !== undefined && itemYear !== undefined ? Math.abs(itemYear - year) : undefined,
      };
    });
  const exactYear = scored.find((item) => item.exact && (item.yearDelta === undefined || item.yearDelta <= 1));
  if (exactYear) return exactYear.id;
  if (year !== undefined) {
    const yearMatch = scored.filter((item) => item.yearDelta !== undefined && item.yearDelta <= 1).sort((a, b) => (a.yearDelta ?? 0) - (b.yearDelta ?? 0));
    if (yearMatch.length) return yearMatch[0].id;
  }
  const exactAny = scored.find((item) => item.exact);
  return exactAny ? exactAny.id : null;
}

/** TMDB season episodes re-keyed onto the anime identity (stable local keys). */
function mapTmdbAnimeSeason(identity: MediaIdentity, seasonNumber: number, name: string, tmdbSeriesId: string, season: TmdbSeasonDto): CatalogSeason {
  const episodes: MediaEpisode[] = (season.episodes ?? [])
    .filter((episode) => Number.isSafeInteger(episode.episode_number) && episode.episode_number > 0)
    .map((episode) => ({
      provider: identity.provider,
      mediaType: identity.mediaType,
      providerId: `tmdb-${tmdbSeriesId}-s${seasonNumber}e${episode.episode_number}`,
      seriesId: identity.providerId,
      seasonNumber,
      episodeNumber: episode.episode_number,
      title: episode.name || `Episode ${episode.episode_number}`,
      overview: episode.overview || undefined,
      airDate: episode.air_date || undefined,
      stillUrl: imageUrl(episode.still_path, 'still'),
      runtimeMinutes: episode.runtime ?? undefined,
    }));
  return { series: identity, seasonNumber, name: name || `Season ${seasonNumber}`, episodes };
}

export function mergeCatalogResults(groups: readonly (readonly CatalogMedia[])[]): CatalogMedia[] {
  const seen = new Set<string>();
  const merged: CatalogMedia[] = [];
  for (const media of groups.flat()) {
    const title = normalizeTitle(media.title);
    const key = `${title}:${media.year ?? ''}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    merged.push(media);
  }
  return merged;
}

function isProviderIdentity(identity: MediaIdentity): boolean {
  if (identity.provider === 'tvdb') return identity.mediaType === 'movie' || identity.mediaType === 'series' || identity.mediaType === 'anime';
  return (identity.provider === 'tmdb' && (identity.mediaType === 'movie' || identity.mediaType === 'series')) || (identity.provider === 'anilist' && identity.mediaType === 'anime');
}

/** Round-robin interleave of ranked lists so no single provider dominates. */
export function interleaveRanked(groups: readonly (readonly CatalogMedia[])[], limit = 15): CatalogMedia[] {
  const seen = new Set<string>();
  const merged: CatalogMedia[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest && merged.length < limit; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

/**
 * Re-orders one provider slice so titles whose FIRST genre is the selected
 * genre lead the shelf; multi-tagged neighbours (an Action movie that also
 * carries Comedy) still appear, but after the pure-genre titles. Keeps every
 * shelf full while the top always reads as the genre the user opened.
 */
export function primaryFirst<T>(items: readonly T[] | undefined, size: number, isPrimary: (item: T) => boolean): T[] {
  const list = (items ?? []).slice(0, size);
  return [...list.filter(isPrimary), ...list.filter((item) => !isPrimary(item))];
}

function orderByRecency(items: readonly CatalogMedia[], limit = 15): CatalogMedia[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit);
}

export function isUpcomingMedia(media: CatalogMedia, today = new Date()): boolean {
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (media.releaseDate) {
    // Year-only dates ("2026") compare as plain strings badly against
    // "2026-10-10", so compare the year numerically.
    if (/^\d{4}$/.test(media.releaseDate)) {
      if (Number(media.releaseDate) > today.getFullYear()) return true;
    } else if (media.releaseDate > start) return true;
  }
  const status = (media.status ?? '').toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return status === 'announced' || status === 'planned' || status === 'in production' || status === 'post production' || status === 'pilot' || status === 'upcoming' || status === 'rumored' || status === 'not yet released';
}

/**
 * Browse and genre shelves are "what's out now" lists — pre-release titles
 * belong on the Upcoming screen only. Providers rank unreleased titles by
 * hype, so every discovery page drops them here before it leaves the
 * repository (the same rule `getTopRated` applies).
 */
export function releasedOnly(items: readonly CatalogMedia[]): CatalogMedia[] {
  return items.filter((item) => !isUpcomingMedia(item));
}

function orderUpcomingByDate(items: readonly CatalogMedia[], limit = 20): CatalogMedia[] {
  const seen = new Set<string>();
  return [...items]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'))
    .slice(0, limit);
}

function numericId(identity: MediaIdentity): number {
  const id = Number(identity.providerId);
  if (!Number.isSafeInteger(id) || id < 1) throw new CatalogError(identity.provider, 'not_found', 404);
  return id;
}

/**
 * Indian OTT platforms as pipe-joined TMDb provider ids (Netflix, Prime Video,
 * JioHotstar, Zee5, SonyLIV, Apple TV, MUBI, Lionsgate Play, Hoichoi, aha,
 * WeTV). The Hindi shows shelf is restricted to these so it stays an OTT
 * shelf — pipe means "any of" and the URL layer percent-encodes it.
 */
const IN_OTT_TV_PROVIDERS = '8|119|2336|232|237|350|11|561|315|532|623';
/**
 * Vote floor for the Hindi shelf: streaming originals clear it easily
 * (Mirzapur 194, Sacred Games 263, Panchayat 154) while daily broadcast
 * serials do not (C.I.D. 32, Taarak Mehta 41, Kundali Bhagya 4).
 */
const HINDI_SHOW_MIN_VOTES = 45;
/** Flops: bad on average but actually watched (keeps 0.0-vote curiosities out). */
const FLOP_MIN_VOTES = 500;
/** Best-of-year floor: enough votes that a score reflects an audience. */
const YEAR_MIN_VOTES = 200;

export class RemoteCatalogRepository implements CatalogRepositoryContract {
  async search(query: string, filter: CatalogFilter, signal?: AbortSignal): Promise<CatalogSearchResult> {
    const term = query.trim();
    if (!term) return { items: [], unavailableProviders: [] };
    // TVDB is the single catalog source: one dataset for movies, shows, and
    // anime (anime = series carrying the Anime genre).
    const tasks: { provider: MediaProvider; load: () => Promise<CatalogMedia[]> }[] = [];
    if (filter === 'all' || filter === 'movies') tasks.push({ provider: 'tvdb', load: async () => (await tvdbClient.search(term, 'movie', signal)).map(mapTvdbSearchItem).filter((item): item is CatalogMedia => item !== null) });
    if (filter === 'all' || filter === 'series') tasks.push({ provider: 'tvdb', load: async () => (await tvdbClient.search(term, 'series', signal)).map(mapTvdbSearchItem).filter((item): item is CatalogMedia => item !== null && item.mediaType === 'series') });
    if (filter === 'all' || filter === 'anime') tasks.push({ provider: 'tvdb', load: async () => (await tvdbClient.search(term, 'series', signal)).map(mapTvdbSearchItem).filter((item): item is CatalogMedia => item !== null && item.mediaType === 'anime') });
    // Ranking signal fetched in parallel; TVDB stays the only results source.
    const popularity = searchQueryPopularity(term, signal);
    const settled = await Promise.allSettled(tasks.map((task) => task.load()));
    if (signal?.aborted) throw settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const unavailableProviders = [...new Set(settled.flatMap((result, index) => result.status === 'rejected' ? [tasks[index].provider] : []))];
    if (!fulfilled.length && settled.some((result) => result.status === 'rejected')) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError(tasks[0].provider, 'network');
    }
    const merged = mergeCatalogResults(fulfilled);
    if (!merged.length) return { items: [], unavailableProviders };
    // The exact/popular match the user typed lands first; TVDB's own order
    // only breaks full ties, so the top title never needs scrolling to find.
    return { items: rankSearchResults(merged, term, await popularity), unavailableProviders };
  }

  async getMedia(identity: MediaIdentity, signal?: AbortSignal): Promise<CatalogMedia> {
    if (!isProviderIdentity(identity)) throw new CatalogError(identity.provider, 'not_found', 404);
    if (identity.provider === 'tvdb') return this.getTvdbMedia(identity, signal);
    const id = numericId(identity);
    if (identity.provider === 'anilist') {
      const { dto, summaries, total } = await this.getAnimeSeasons(id, signal);
      const media = mapAniListAnime(dto);
      // Multi-season franchises (prequel/sequel chain) expose every season;
      // the episode total becomes the franchise sum for honest progress math.
      if (summaries.length > 1) {
        media.seasonSummaries = summaries;
        if (total > 0) media.numberOfEpisodes = total;
      }
      await this.applyTmdbAnimeShell(media, dto.idMal ?? undefined, signal);
      return media;
    }
    if (identity.mediaType === 'movie') return mapTmdbMovie(await tmdbClient.getMovie(identity.providerId, signal));
    return mapTmdbTv(await tmdbClient.getTv(identity.providerId, signal));
  }

  /**
   * Anime titles, posters, and seasons from TMDB when it carries the show.
   * Anything uncertain (or any failure) leaves the AniList data untouched,
   * so this overlay can only improve the detail screen, never break it.
   */
  private async applyTmdbAnimeShell(media: CatalogMedia, malId: number | undefined, signal?: AbortSignal): Promise<void> {
    try {
      const search = await tmdbClient.searchTv(media.title, signal);
      const tmdbId = pickTmdbSeriesMatch(search.results ?? [], media.title, media.year);
      if (!tmdbId) return;
      const tv = await tmdbClient.getTv(String(tmdbId), signal);
      const shell = mapTmdbTv(tv);
      media.title = shell.title;
      media.posterUrl = shell.posterUrl ?? media.posterUrl;
      media.backdropUrl = shell.backdropUrl ?? media.backdropUrl;
      media.overview = shell.overview ?? media.overview;
      if (shell.genres.length) media.genres = shell.genres;
      if (shell.year !== undefined) media.year = shell.year;
      if (shell.releaseDate) media.releaseDate = shell.releaseDate;
      if (shell.rating !== undefined) media.rating = shell.rating;
      if (shell.voteCount !== undefined) media.voteCount = shell.voteCount;
      const tvSeasons = (tv.seasons ?? []).filter((season) => season.season_number > 0);
      if (!tvSeasons.length) return;
      const anilistId = media.providerId;
      media.seasonSummaries = tvSeasons.map((season) => ({
        seasonNumber: season.season_number,
        name: season.name || `Season ${season.season_number}`,
        episodeCount: season.episode_count,
        airDate: season.air_date || undefined,
        posterUrl: imageUrl(season.poster_path) ?? undefined,
        refProviderId: anilistId,
        refMalId: malId,
        refTmdbSeriesId: String(tmdbId),
      }));
      const total = tvSeasons.reduce((sum, season) => sum + (season.episode_count ?? 0), 0);
      if (total > 0) media.numberOfEpisodes = total;
    } catch {
      // AniList data stands on its own.
    }
  }
  private async getTvdbMedia(identity: MediaIdentity, signal?: AbortSignal): Promise<CatalogMedia> {
    numericId(identity);
    if (identity.mediaType === 'movie') return mapTvdbMovie(await tvdbClient.getMovie(identity.providerId, signal));
    const dto = await tvdbClient.getSeries(identity.providerId, signal);
    const mediaType = identity.mediaType === 'anime' || isAnimeGenres(dto.genres?.map((genre) => genre?.name)) ? 'anime' as const : 'series' as const;
    const media = mapTvdbSeries(dto, mediaType);
    try {
      const episodes = await tvdbClient.getAllSeriesEpisodes(identity.providerId, 'default', signal);
      const counts = new Map<number, number>();
      let total = 0;
      for (const episode of episodes) {
        if (!Number.isSafeInteger(episode.seasonNumber) || (episode.seasonNumber as number) < 1) continue;
        counts.set(episode.seasonNumber as number, (counts.get(episode.seasonNumber as number) ?? 0) + 1);
        total += 1;
      }
      if (media.seasonSummaries) {
        media.seasonSummaries = media.seasonSummaries.map((summary) => ({
          ...summary,
          episodeCount: counts.get(summary.seasonNumber) ?? summary.episodeCount,
        }));
      }
      if (total > 0) media.numberOfEpisodes = total;
    } catch {
      // Counts stay unknown; seasons still expand on demand below.
    }
    return media;
  }

  /**
   * TVDB season: official aired-order numbering shared by shows and anime —
   * no franchise chains, no third-party episode APIs. Episode rows carry
   * TVDB's own ids, stable across opens.
   */
  private async getTvdbSeason(identity: MediaIdentity, seasonNumber: number, signal?: AbortSignal): Promise<CatalogSeason> {
    const dto = await tvdbClient.getSeries(identity.providerId, signal);
    const summaries = seriesSeasonSummaries(dto);
    const summary = summaries.find((item) => item.seasonNumber === seasonNumber);
    if (!summary) throw new CatalogError(identity.provider, 'not_found', 404);
    const episodes = await tvdbClient.getAllSeriesEpisodes(identity.providerId, 'default', signal);
    const seasonEpisodes = episodes
      .filter((episode) => episode.seasonNumber === seasonNumber)
      .map((episode) => mapTvdbEpisodeDto(identity, seasonNumber, episode))
      .filter((episode): episode is NonNullable<typeof episode> => episode !== null)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (!seasonEpisodes.length) throw new CatalogError(identity.provider, 'metadata_unavailable');
    const season = mapTvdbSeason(identity, seasonNumber, seasonEpisodes);
    season.name = summary.name;
    season.posterUrl = summary.posterUrl;
    return season;
  }

  /**
   * The full season chain for an anime entry. AniList splits cours into
   * separate entries linked by prequel/sequel edges, so the chain is walked
   * in both directions from the opened entry (capped — loops are guarded).
   */
  private async getAnimeSeasons(id: number, signal?: AbortSignal): Promise<{ dto: AniListMediaDto; summaries: SeasonSummary[]; total: number }> {
    const dto = await anilistClient.getAnime(id, signal);
    const entries = new Map<string, AnimeSeasonEntry>();
    for (const entry of animeSeasonEntries(dto)) entries.set(entry.providerId, entry);
    const queue: number[] = [id];
    const visited = new Set<number>();
    while (queue.length > 0 && entries.size < 12 && visited.size < 24) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      let currentDto: AniListMediaDto | undefined = current === id ? dto : undefined;
      if (!currentDto) {
        try { currentDto = await anilistClient.getAnime(current, signal); }
        catch { continue; }
      }
      for (const entry of animeSeasonEntries(currentDto)) {
        if (!entries.has(entry.providerId)) entries.set(entry.providerId, entry);
      }
      for (const edge of currentDto.relations?.edges ?? []) {
        const nodeId = edge?.node?.id;
        const relation = edge?.relationType;
        if ((relation === 'PREQUEL' || relation === 'SEQUEL') && Number.isSafeInteger(nodeId) && !visited.has(nodeId as number)) {
          queue.push(nodeId as number);
        }
      }
    }
    const summaries = animeEntriesToSummaries([...entries.values()]);
    const total = [...entries.values()].reduce((sum, entry) => sum + (entry.episodes ?? 0), 0);
    return { dto, summaries, total };
  }

  async getSeason(identity: MediaIdentity, seasonNumber: number, signal?: AbortSignal): Promise<CatalogSeason> {
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) {
      throw new CatalogError(identity.provider, 'metadata_unavailable');
    }
    numericId(identity);
    if (identity.provider === 'tvdb' && identity.mediaType !== 'movie') {
      return this.getTvdbSeason(identity, seasonNumber, signal);
    }
    if (identity.provider === 'anilist' && identity.mediaType === 'anime') {
      return this.getAnimeSeason(identity, seasonNumber, signal);
    }
    if (identity.provider !== 'tmdb' || identity.mediaType !== 'series') {
      throw new CatalogError(identity.provider, 'metadata_unavailable');
    }
    const season = await tmdbClient.getSeason(identity.providerId, seasonNumber, signal);
    return mapTmdbSeason(season, identity);
  }

  /**
   * Anime season resolved from the summary already in hand (its backing
   * entry). Expanding a season costs at most a couple of cheap requests and
   * never re-walks the AniList chain, so slow connections don't stack
   * requests into rate limits. Falls back to the full walk only when the
   * summary carries no usable refs.
   */
  async getAnimeSeasonByRef(identity: MediaIdentity, summary: SeasonSummary, signal?: AbortSignal): Promise<CatalogSeason> {
    const seasonNumber = summary.seasonNumber;
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
      throw new CatalogError(identity.provider, 'metadata_unavailable');
    }
    // TVDB seasons are official aired-order rows — the summary's season
    // number is the whole address, exactly like shows.
    if (identity.provider === 'tvdb' && identity.mediaType !== 'movie') {
      return this.getTvdbSeason(identity, seasonNumber, signal);
    }
    if (identity.provider !== 'anilist' || identity.mediaType !== 'anime') {
      throw new CatalogError(identity.provider, 'metadata_unavailable');
    }
    const total = summary.episodeCount ?? 0;
    const episodes = await this.getAnimeSeasonEpisodes(identity, seasonNumber, summary.name, summary.refProviderId, summary.refMalId, total, signal, summary.refTmdbSeriesId);
    if (episodes) return episodes;
    return this.getAnimeSeason(identity, seasonNumber, signal);
  }

  /**
   * Episode list for one anime season, most reliable source first:
   * Kitsu (real titles, air dates, stills, generous limits) → Jikan
   * (MyAnimeList data, strict rate limits) → synthetic 1..N list when a
   * total is known so per-episode tracking still works. Returns undefined
   * only when nothing can produce a list.
   */
  private async getAnimeSeasonEpisodes(
    identity: MediaIdentity,
    seasonNumber: number,
    seasonName: string,
    refProviderId: string | undefined,
    refMalId: number | undefined,
    total: number,
    signal?: AbortSignal,
    refTmdbSeriesId?: string,
  ): Promise<CatalogSeason | undefined> {
    // TMDB-backed anime seasons resolve episodes from TMDB first (correct
    // titles, stills, counts); Kitsu/Jikan remain as fallbacks below.
    if (refTmdbSeriesId) {
      try {
        const season = await tmdbClient.getSeason(refTmdbSeriesId, seasonNumber, signal);
        const mapped = mapTmdbAnimeSeason(identity, seasonNumber, seasonName, refTmdbSeriesId, season);
        if (mapped.episodes.length) return mapped;
      } catch {
        // Fall through to Kitsu, then Jikan, then the synthetic list below.
      }
    }
    const anilistId = Number(refProviderId ?? identity.providerId);
    if (Number.isSafeInteger(anilistId) && anilistId > 0) {
      try {
        const kitsuId = await kitsuClient.resolveAnimeId(anilistId, signal);
        if (kitsuId) {
          const episodes = await kitsuClient.getAllEpisodes(kitsuId, signal);
          // Kitsu entries occasionally carry no episode rows (films, shorts
          // grouped under one entry); only trust a non-empty list.
          if (episodes.length) return mapAnimeSeason(identity, seasonNumber, seasonName, episodes);
        }
      } catch {
        // Fall through to Jikan, then the synthetic list below.
      }
    }
    if (refMalId) {
      try {
        const episodes = await jikanClient.getAllEpisodes(refMalId, signal);
        if (episodes.length) return mapAnimeSeason(identity, seasonNumber, seasonName, episodes);
      } catch {
        // Fall through to the synthetic list below.
      }
    }
    if (total > 0) return syntheticAnimeSeason(identity, seasonNumber, total);
    return undefined;
  }

  /**
   * Anime episode list for one season of the chain. Titles come from Kitsu
   * first (real titles, air dates, stills), then the Jikan open API via the
   * season's own MAL id; when both are unreachable (or the season has no
   * usable refs) a synthetic 1..N list is returned so per-episode tracking
   * still works — never an error when a total is known.
   */
  private async getAnimeSeason(identity: MediaIdentity, seasonNumber: number, signal?: AbortSignal): Promise<CatalogSeason> {
    const id = numericId(identity);
    const { summaries } = await this.getAnimeSeasons(id, signal);
    const summary = summaries.find((item) => item.seasonNumber === seasonNumber);
    if (!summary) throw new CatalogError(identity.provider, 'not_found', 404);
    // The season may be backed by a different AniList entry than the opened
    // title; refresh its count/MAL id so airing seasons stay correct.
    let malId = summary.refMalId;
    let total = summary.episodeCount ?? 0;
    const refId = Number(summary.refProviderId ?? id);
    if (Number.isSafeInteger(refId) && refId > 0 && refId !== id) {
      try {
        const refDto = await anilistClient.getAnime(refId, signal);
        malId = refDto.idMal ?? malId;
        if (refDto.episodes) total = refDto.episodes;
      } catch {
        // The chain data stands on its own.
      }
    }
    const episodes = await this.getAnimeSeasonEpisodes(identity, seasonNumber, summary.name, summary.refProviderId, malId, total, signal, summary.refTmdbSeriesId);
    if (episodes) return episodes;
    throw new CatalogError(identity.provider, 'metadata_unavailable');
  }

  async getTrending(signal?: AbortSignal): Promise<CatalogMedia[]> {
    const settled = await Promise.allSettled([
      tvdbClient.filterMovies({ page: 0 }, signal).then((response) => (response.data ?? []).map(mapTvdbFilterMovie).filter((item): item is CatalogMedia => item !== null)),
      tvdbClient.filterSeries({ page: 0 }, signal).then((response) => (response.data ?? []).map((item) => mapTvdbFilterSeries(item)).filter((item): item is CatalogMedia => item !== null)),
    ]);
    if (signal?.aborted) throw settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tvdb', 'network');
    }
    return interleaveRanked(fulfilled);
  }

  async getRecentlyReleased(signal?: AbortSignal): Promise<CatalogMedia[]> {
    // Last 3 months across Hollywood, Bollywood, and anime, mixed newest-first.
    // Movies/shows come from TMDB Discover constrained to the exact calendar
    // window (global + English + Hindi so Bollywood is always represented);
    // anime comes from AniList sorted by start date and filtered to the same
    // window in JS. Three pages per TMDB source would be 18 requests, so two
    // pages per source keeps the screen fast while still filling the grid.
    const today = new Date();
    const to = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const fromDate = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
    const moviePages = [1, 2];
    const tvPages = [1, 2];
    const settled = await Promise.allSettled([
      ...moviePages.map((page) => tmdbClient.discoverMovies(page, { releaseDateGte: from, releaseDateLte: to }, signal).then((response) => (response.results ?? []).map(mapTmdbMovie))),
      ...moviePages.map((page) => tmdbClient.discoverMovies(page, { language: 'hi', releaseDateGte: from, releaseDateLte: to }, signal).then((response) => (response.results ?? []).map(mapTmdbMovie))),
      tmdbClient.discoverMovies(1, { language: 'en', releaseDateGte: from, releaseDateLte: to }, signal).then((response) => (response.results ?? []).map(mapTmdbMovie)),
      ...tvPages.map((page) => tmdbClient.discoverTv(page, { firstAirDateGte: from, firstAirDateLte: to }, signal).then((response) => (response.results ?? []).map(mapTmdbTv))),
      ...tvPages.map((page) => tmdbClient.discoverTv(page, { language: 'hi', firstAirDateGte: from, firstAirDateLte: to, watchRegion: 'IN', watchProviders: '8|119|122' }, signal).then((response) => (response.results ?? []).map(mapTmdbTv))),
      tmdbClient.discoverTv(1, { language: 'en', firstAirDateGte: from, firstAirDateLte: to }, signal).then((response) => (response.results ?? []).map(mapTmdbTv)),
      anilistClient.recentAnimePage(1, 20, signal).then((response) => response.media.map(mapAniListAnime).filter((item) => item.releaseDate !== undefined && item.releaseDate >= from && item.releaseDate <= to)),
      anilistClient.recentAnimePage(2, 20, signal).then((response) => response.media.map(mapAniListAnime).filter((item) => item.releaseDate !== undefined && item.releaseDate >= from && item.releaseDate <= to)),
    ]);
    if (signal?.aborted) throw settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tmdb', 'network');
    }
    return orderByRecency(fulfilled.flat(), 90);
  }

  /**
   * The 100 most-loved released titles: top favorite counts across movies
   * and series, best first. TVDB publishes no 0–10 scores, so favorite
   * counts are the honest ranking available; unreleased entries never
   * qualify.
   */
  async getTopRated(signal?: AbortSignal): Promise<CatalogMedia[]> {
    const settled = await Promise.allSettled([
      tvdbClient.filterMovies({ page: 0 }, signal).then((response) => (response.data ?? []).map(mapTvdbFilterMovie).filter((item): item is CatalogMedia => item !== null)),
      tvdbClient.filterSeries({ page: 0 }, signal).then((response) => (response.data ?? []).map((item) => mapTvdbFilterSeries(item)).filter((item): item is CatalogMedia => item !== null)),
    ]);
    if (signal?.aborted) throw settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tvdb', 'network');
    }
    const seen = new Set<string>();
    return fulfilled
      .flat()
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return typeof item.popularity === 'number' && !isUpcomingMedia(item);
      })
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 100);
  }

  async getUpcoming(signal?: AbortSignal): Promise<CatalogMedia[]> {
    const year = new Date().getFullYear();
    const settled = await Promise.allSettled([
      Promise.all([tvdbClient.filterMovies({ page: 0, year }, signal), tvdbClient.filterMovies({ page: 0, year: year + 1 }, signal)])
        .then((pages) => pages.flatMap((response) => (response.data ?? []).map(mapTvdbFilterMovie).filter((item): item is CatalogMedia => item !== null))),
      Promise.all([tvdbClient.filterSeries({ page: 0, year }, signal), tvdbClient.filterSeries({ page: 0, year: year + 1 }, signal)])
        .then((pages) => pages.flatMap((response) => (response.data ?? []).map((item) => mapTvdbFilterSeries(item)).filter((item): item is CatalogMedia => item !== null))),
      Promise.all([tvdbClient.filterSeries({ page: 0, year, genre: TVDB_ANIME_GENRE_ID }, signal), tvdbClient.filterSeries({ page: 0, year: year + 1, genre: TVDB_ANIME_GENRE_ID }, signal)])
        .then((pages) => pages.flatMap((response) => (response.data ?? []).map((item) => mapTvdbFilterSeries(item, 'anime')).filter((item): item is CatalogMedia => item !== null))),
    ]);
    if (signal?.aborted) throw settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tvdb', 'network');
    }
    const upcoming = fulfilled.flat().filter((media) => isUpcomingMedia(media));
    // If providers return no future-dated items (e.g. mocked data), fall back to
    // the full pool so the section never looks broken while staying honest.
    const pool = upcoming.length ? upcoming : fulfilled.flat();
    return orderUpcomingByDate(pool);
  }

  /**
   * Lightweight TVDB metadata (trailer, directors, age rating) from a single
   * extended record — no episode pages, unlike the full detail payload.
   */
  private async getTvdbMeta(identity: MediaIdentity, signal?: AbortSignal): Promise<Pick<CatalogMedia, 'trailerKey' | 'directors' | 'contentRating'>> {
    numericId(identity);
    if (identity.mediaType === 'movie') {
      const media = mapTvdbMovie(await tvdbClient.getMovie(identity.providerId, signal));
      return { trailerKey: media.trailerKey, directors: media.directors, contentRating: media.contentRating };
    }
    const media = mapTvdbSeries(await tvdbClient.getSeries(identity.providerId, signal), identity.mediaType === 'anime' ? 'anime' : 'series');
    return { trailerKey: media.trailerKey, directors: media.directors, contentRating: media.contentRating };
  }

  async getTrailerKey(identity: MediaIdentity, signal?: AbortSignal): Promise<string | undefined> {
    if (identity.provider === 'tvdb' && identity.mediaType !== 'movie' && identity.mediaType !== 'series') return undefined;
    if (identity.provider === 'tvdb') {
      return (await this.getTvdbMeta(identity, signal)).trailerKey;
    }
    if (identity.provider !== 'tmdb' || (identity.mediaType !== 'movie' && identity.mediaType !== 'series')) return undefined;
    const { results } = await tmdbClient.videos(identity.mediaType, identity.providerId, signal);
    const videos = results ?? [];
    const pick = (type: string) => videos.find((video) => video.site === 'YouTube' && video.type === type && video.key);
    return pick('Trailer')?.key ?? pick('Teaser')?.key;
  }

  async getWatchProviders(identity: MediaIdentity, signal?: AbortSignal): Promise<WatchProviderGroup[]> {    if (identity.provider !== 'tmdb' || (identity.mediaType !== 'movie' && identity.mediaType !== 'series')) return [];
    const { results } = await tmdbClient.watchProviders(identity.mediaType, identity.providerId, signal);
    const region = results?.[deviceRegion()] ?? results?.US;
    if (!region) return [];
    const mapGroup = (category: WatchProviderGroup['category'], entries: { provider_id: number; provider_name: string; logo_path?: string | null }[] | undefined): WatchProviderGroup | null => {
      if (!entries?.length) return null;
      return { category, providers: entries.map((entry) => ({ id: entry.provider_id, name: entry.provider_name, logoUrl: imageUrl(entry.logo_path) })) };
    };
    return [mapGroup('stream', region.flatrate), mapGroup('rent', region.rent), mapGroup('buy', region.buy)].filter((group): group is WatchProviderGroup => group !== null);
  }

  async getWatchProvidersForRegion(identity: MediaIdentity, region: string, signal?: AbortSignal): Promise<WatchProviderGroup[]> {
    // Explicit-region lookup with NO fallback: a title streaming in another
    // country must never read as available here. TVDB-only titles (no TMDb
    // bridge) honestly report nothing.
    const code = region.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return [];
    if (identity.provider !== 'tmdb' || (identity.mediaType !== 'movie' && identity.mediaType !== 'series')) {
      // Non-TMDB providers have no region-scoped provider data here (TVDB
      // bridging happens in the OTT service via the stored TMDb ref id).
      return [];
    }
    const lookup: { provider: 'tmdb'; mediaType: 'movie' | 'series'; providerId: string } = {
      provider: 'tmdb',
      mediaType: identity.mediaType,
      providerId: identity.providerId,
    };
    const { results } = await tmdbClient.watchProviders(lookup.mediaType, lookup.providerId, signal);
    const scoped = results?.[code];
    if (!scoped) return [];
    const mapGroup = (category: WatchProviderGroup['category'], entries: { provider_id: number; provider_name: string; logo_path?: string | null }[] | undefined): WatchProviderGroup | null => {
      if (!entries?.length) return null;
      return { category, providers: entries.map((entry) => ({ id: entry.provider_id, name: entry.provider_name, logoUrl: imageUrl(entry.logo_path) })) };
    };
    return [mapGroup('stream', scoped.flatrate), mapGroup('rent', scoped.rent), mapGroup('buy', scoped.buy)].filter((group): group is WatchProviderGroup => group !== null);
  }

  async getDirectors(identity: MediaIdentity, signal?: AbortSignal): Promise<string[]> {
    if (identity.provider === 'tvdb' && identity.mediaType !== 'movie' && identity.mediaType !== 'series') return [];
    if (identity.provider === 'tvdb') {
      return (await this.getTvdbMeta(identity, signal)).directors ?? [];
    }
    if (identity.provider !== 'tmdb' || (identity.mediaType !== 'movie' && identity.mediaType !== 'series')) return [];
    const { crew } = await tmdbClient.credits(identity.mediaType, identity.providerId, signal);
    const directors = (crew ?? [])
      .filter((member) => member.job === 'Director' && Boolean(member.name))
      .map((member) => member.name);
    return [...new Set(directors)].slice(0, 2);
  }

  async getContentRating(identity: MediaIdentity, signal?: AbortSignal): Promise<string | undefined> {
    if (identity.provider === 'tvdb' && identity.mediaType !== 'movie' && identity.mediaType !== 'series') return undefined;
    if (identity.provider === 'tvdb') {
      return (await this.getTvdbMeta(identity, signal)).contentRating;
    }
    const region = deviceRegion();
    if (identity.mediaType === 'movie') {
      const { results } = await tmdbClient.releaseDates(identity.providerId, signal);
      const pick = (code: string) => results?.find((entry) => entry.iso_3166_1 === code)?.release_dates?.map((item) => item.certification?.trim()).find((cert) => cert);
      return pick(region) ?? pick('US') ?? results?.flatMap((entry) => entry.release_dates ?? []).map((item) => item.certification?.trim()).find((cert) => cert);
    }
    const { results } = await tmdbClient.contentRatings(identity.providerId, signal);
    return results?.find((entry) => entry.iso_3166_1 === region)?.rating
      ?? results?.find((entry) => entry.iso_3166_1 === 'US')?.rating
      ?? results?.map((entry) => entry.rating).find((rating) => rating);
  }

  /** Cap so runaway scrolling can never loop the provider. */
  private static maxPages(totalPages: number | undefined): number {
    return Math.max(1, Math.min(totalPages ?? 1, 20));
  }

  /** TVDB filter pages hold 500 rows; the app consumes them in shelf-sized slices. */
  private static tvdbTotalPages(totalItems: number | null | undefined, pageSize: number | null | undefined): number {
    if (!totalItems || !pageSize) return 1;
    return Math.max(1, Math.min(Math.ceil(totalItems / pageSize), 20));
  }

  private static readonly TVDB_PAGE_SIZE = 40;

  async getTrendingAllPage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // TMDB's own trending lists plus AniList's trending anime, interleaved
    // so the shelf mixes movies, shows, and anime. Bollywood joins explicitly
    // (Hindi discover) so Hindi titles are always represented alongside
    // Hollywood trending — TMDB trending alone skews English. Anime joins page
    // one only (AniList trending is a single ranked snapshot).
    const [movies, series, anime, bollywoodMovies, bollywoodSeries] = await Promise.all([
      tmdbClient.trendingMovies(signal, safePage),
      tmdbClient.trendingTv(signal, safePage),
      safePage === 1 ? anilistClient.trendingAnime(signal).catch(() => null) : Promise.resolve(null),
      tmdbClient.discoverMovies(safePage, { language: 'hi' }, signal).catch(() => null),
      tmdbClient.discoverTv(safePage, { language: 'hi', watchRegion: 'IN', watchProviders: '8|119|122', voteCountGte: 40 }, signal).catch(() => null),
    ]);
    const size = 20;
    const animeItems = (anime ?? []).slice(0, 10).map(mapAniListAnime);
    const groups = [
      (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
      (series.results ?? []).slice(0, size).map(mapTmdbTv),
      ((bollywoodMovies?.results ?? []).slice(0, size).map(mapTmdbMovie)),
      ((bollywoodSeries?.results ?? []).slice(0, size).map(mapTmdbTv)),
      animeItems,
    ];
    return {
      items: releasedOnly(interleaveRanked(groups, size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, series.total_pages ?? 1)),
    };
  }

  async getPopularMoviesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // Hollywood + Bollywood mixed: English and Hindi originals interleaved by
    // popularity so neither dominates the Movies shelf.
    void region;
    const [hollywood, bollywood] = await Promise.all([
      tmdbClient.discoverMovies(safePage, { language: 'en' }, signal),
      tmdbClient.discoverMovies(safePage, { language: 'hi' }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (hollywood.results ?? []).slice(0, size).map(mapTmdbMovie),
        (bollywood.results ?? []).slice(0, size).map(mapTmdbMovie),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(hollywood.total_pages ?? 1, bollywood.total_pages ?? 1)),
    };
  }

  async getPopularSeriesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // Hollywood (all English shows) + Bollywood OTT-only (Hindi + Indian OTT
    // providers with traction, keeping daily soaps out), interleaved.
    void region;
    const [hollywood, bollywood] = await Promise.all([
      tmdbClient.discoverTv(safePage, { language: 'en' }, signal),
      tmdbClient.discoverTv(safePage, { language: 'hi', watchRegion: 'IN', watchProviders: '8|119|122', voteCountGte: 40 }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (hollywood.results ?? []).slice(0, size).map(mapTmdbTv),
        (bollywood.results ?? []).slice(0, size).map(mapTmdbTv),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(hollywood.total_pages ?? 1, bollywood.total_pages ?? 1)),
    };
  }

  async getHollywoodPage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // English originals only: Hollywood movies and shows, mixed.
    const [movies, series] = await Promise.all([
      tmdbClient.discoverMovies(safePage, { language: 'en' }, signal),
      tmdbClient.discoverTv(safePage, { language: 'en' }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
        (series.results ?? []).slice(0, size).map(mapTmdbTv),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, series.total_pages ?? 1)),
    };
  }

  async getBollywoodPage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // Hindi originals, movies and shows mixed. Series are additionally
    // restricted to Indian OTT premieres with real audience traction, which
    // is what keeps daily TV soaps out of the shelf.
    const [movies, series] = await Promise.all([
      tmdbClient.discoverMovies(safePage, { language: 'hi' }, signal),
      tmdbClient.discoverTv(safePage, {
        language: 'hi',
        watchRegion: 'IN',
        watchProviders: '8|119|122',
        voteCountGte: 40,
      }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
        (series.results ?? []).slice(0, size).map(mapTmdbTv),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, series.total_pages ?? 1)),
    };
  }

  async getPopularAnimePage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    // TVDB list names come back in Japanese for anime (its filter endpoint
    // ignores language), so Browse uses AniList here — English-first titles
    // and the same source as the anime detail screen.
    const response = await anilistClient.popularAnime(safePage, RemoteCatalogRepository.TVDB_PAGE_SIZE, signal);
    return {
      items: releasedOnly(response.media.map(mapAniListAnime)),
      page: safePage,
      totalPages: response.lastPage ?? (response.hasNextPage ? safePage + 1 : safePage),
    };
  }

  /**
   * Global Hits live preview: TMDB Discover constrained to the period's exact
   * calendar bounds, ranked by TMDB popularity. Server-side sorting already
   * orders by popularity, so a bounded page walk covers rank shifts from
   * excluded dateless/out-of-range titles. Movies and series stay separate.
   */
  async getGlobalHitsLive(type: HitsPeriodType, key: string, media: HitsMediaType, signal?: AbortSignal): Promise<GlobalHitsLive> {
    const period = parseHitsPeriod(type, key);
    if (!period) throw new CatalogError('tmdb', 'not_found', 404);
    const pages: HitCandidate[][] = [];
    for (let page = 1; page <= HITS_MAX_PAGES; page += 1) {
      const response = media === 'movie'
        ? await tmdbClient.discoverMovies(page, { releaseDateGte: period.from, releaseDateLte: period.to }, signal)
        : await tmdbClient.discoverTv(page, { firstAirDateGte: period.from, firstAirDateLte: period.to }, signal);
      const candidates = (response.results ?? []).map((dto) => toHitCandidate(dto, media));
      pages.push(candidates);
      const totalPages = response.total_pages ?? page;
      if (page >= totalPages || candidates.length === 0) break;
    }
    return {
      periodType: type,
      periodKey: key,
      from: period.from,
      to: period.to,
      complete: isPeriodComplete(type, key),
      retrievedAt: new Date().toISOString(),
      items: buildHitsRanking(mergeHitPages(pages), { from: period.from, to: period.to }),
    };
  }

  /**
   * Upcoming movies: TMDB theatrical slates for the US and India merged and
   * deduped, so Hollywood and Bollywood share one oldest-first list. The
   * device region joins in when it is neither.
   */
  async getUpcomingMoviesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const regions = ['US', 'IN', ...(region && region !== 'US' && region !== 'IN' ? [region] : [])];
    const settled = await Promise.allSettled(
      regions.map((code) => tmdbClient.upcomingMovies(safePage, code, signal)),
    );
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tmdb', 'network');
    }
    const seen = new Set<string>();
    const items = fulfilled
      .flatMap((response) => response.results ?? [])
      .map(mapTmdbMovie)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return isUpcomingMedia(item);
      })
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
    return {
      items,
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(...fulfilled.map((response) => response.total_pages ?? 1))),
    };
  }

  /**
   * Upcoming series: TMDB titles starting today or later — Hollywood and
   * Bollywood premieres in one oldest-first list. The device region joins in
   * when it is neither US nor IN, mirroring the movies slate.
   */
  async getUpcomingSeriesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const regions = ['US', 'IN', ...(region && region !== 'US' && region !== 'IN' ? [region] : [])];
    const settled = await Promise.allSettled(
      regions.map((code) => tmdbClient.upcomingTvSeries(safePage, code, signal)),
    );
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!fulfilled.length) {
      const reason = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
      if (reason instanceof Error) throw reason;
      throw new CatalogError('tmdb', 'network');
    }
    const seen = new Set<string>();
    const items = fulfilled
      .flatMap((response) => response.results ?? [])
      .map(mapTmdbTv)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return isUpcomingMedia(item);
      })
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
    return {
      items,
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(...fulfilled.map((response) => response.total_pages ?? 1))),
    };
  }

  /** Upcoming anime: AniList's unreleased titles, English names included. */
  async getUpcomingAnimePage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const response = await anilistClient.upcomingAnimePage(safePage, 20, signal);
    const items = response.media
      .map(mapAniListAnime)
      .filter((item) => isUpcomingMedia(item))
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
    return {
      items,
      page: safePage,
      totalPages: response.lastPage ?? (response.hasNextPage ? safePage + 1 : safePage),
    };
  }

  /**
   * One genre shelf, scoped to what the user picked to see:
   * - `all` mixes Hollywood/Bollywood movies, Hollywood/Bollywood shows, and
   *   anime (series and films) in one ranked grid;
   * - `movies` is films — English, Hindi, and Japanese originals so anime
   *   movies always appear alongside Hollywood and Bollywood;
   * - `shows` is English and Hindi series (Hollywood + Bollywood); Hindi is
   *   restricted to Indian OTT platforms with a vote floor, so daily
   *   broadcast serials never fill the shelf;
   * - `anime` is AniList's own genre list (both TV anime and anime films);
   *   genres AniList never tags honestly return an empty page.
   * Every slice is ordered primary-genre-first, so a genre's purest titles
   * always lead no matter how multi-tagged the rest of the page is. Anime
   * joins page one of `all` only — its ranking is a single snapshot,
   * mirroring how trending-all merges feeds.
   */
  async getGenrePage(page: number, genreId: number, kind: GenrePageKind, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const size = 20;
    if (kind === 'anime') {
      const mapped = anilistGenreFor(genreId);
      if (mapped === null || mapped === undefined) return { items: [], page: safePage, totalPages: safePage };
      const response = mapped === 'all'
        ? await anilistClient.popularAnime(safePage, 40, signal)
        : await anilistClient.genreAnimePage(safePage, 40, mapped, signal);
      const media = typeof mapped === 'string' && mapped !== 'all'
        ? primaryFirst(response.media, 40, (dto) => dto.genres?.[0] === mapped)
        : response.media;
      return {
        items: releasedOnly(media.map(mapAniListAnime)),
        page: safePage,
        totalPages: response.lastPage ?? (response.hasNextPage ? safePage + 1 : safePage),
      };
    }
    const tvGenres = tvGenreIdsFor(genreId);
    // TV Movie has no TV counterpart — the Shows shelf reports empty honestly.
    if (kind === 'shows' && (tvGenres === null || tvGenres === undefined)) return { items: [], page: safePage, totalPages: safePage };
    const wantsMovies = kind === 'all' || kind === 'movies';
    const wantsShows = (kind === 'all' || kind === 'shows') && typeof tvGenres === 'string';
    const animeGenre = anilistGenreFor(genreId);
    const wantsAnime = kind === 'all' && animeGenre !== null && animeGenre !== undefined;
    const withGenres = String(genreId);
    const tvIdSet = new Set((tvGenres ?? '').split(','));
    const isPrimaryMovie = (dto: { genre_ids?: number[] }) => dto.genre_ids?.[0] === genreId;
    const isPrimaryShow = (dto: { genre_ids?: number[] }) => tvIdSet.has(String(dto.genre_ids?.[0]));
    // Primary sources fail loudly (the shelf is that source); the Japanese
    // and anime joins are optional extras, never a reason to blank the grid.
    const [movies, shows, moviesJa, anime] = await Promise.all([
      wantsMovies
        ? Promise.all([
            tmdbClient.discoverMovies(safePage, { language: 'en', withGenres }, signal),
            tmdbClient.discoverMovies(safePage, { language: 'hi', withGenres }, signal),
          ])
        : null,
      wantsShows
        ? Promise.all([
            tmdbClient.discoverTv(safePage, { language: 'en', withGenres: tvGenres ?? undefined }, signal),
            tmdbClient.discoverTv(safePage, {
              language: 'hi', withGenres: tvGenres ?? undefined,
              watchRegion: 'IN', watchProviders: IN_OTT_TV_PROVIDERS, voteCountGte: HINDI_SHOW_MIN_VOTES,
            }, signal),
          ])
        : null,
      wantsMovies
        ? tmdbClient.discoverMovies(safePage, { language: 'ja', withGenres }, signal).catch(() => null)
        : Promise.resolve(null),
      wantsAnime && safePage === 1
        ? (animeGenre === 'all'
            ? anilistClient.popularAnime(1, 20, signal)
            : anilistClient.genreAnimePage(1, 20, animeGenre, signal)).catch(() => null)
        : Promise.resolve(null),
    ]);
    const groups: CatalogMedia[][] = [];
    const totals: number[] = [];
    if (movies) {
      groups.push(
        primaryFirst(movies[0].results, size, isPrimaryMovie).map(mapTmdbMovie),
        primaryFirst(movies[1].results, size, isPrimaryMovie).map(mapTmdbMovie),
      );
      totals.push(movies[0].total_pages ?? 1, movies[1].total_pages ?? 1);
    }
    if (shows) {
      groups.push(
        primaryFirst(shows[0].results, size, isPrimaryShow).map(mapTmdbTv),
        primaryFirst(shows[1].results, size, isPrimaryShow).map(mapTmdbTv),
      );
      totals.push(shows[0].total_pages ?? 1, shows[1].total_pages ?? 1);
    }
    if (moviesJa?.results?.length) {
      groups.push(primaryFirst(moviesJa.results, size, isPrimaryMovie).map(mapTmdbMovie));
    }
    if (anime?.media?.length) {
      const media = typeof animeGenre === 'string' && animeGenre !== 'all'
        ? primaryFirst(anime.media, size, (dto) => dto.genres?.[0] === animeGenre)
        : anime.media.slice(0, size);
      groups.push(media.map(mapAniListAnime));
    }
    if (!groups.length) throw new CatalogError('tmdb', 'network');
    return {
      items: releasedOnly(interleaveRanked(groups, size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(totals.length ? Math.max(...totals) : 1),
    };
  }

  /**
   * All-time top-rated, mixed. TMDb's own `top_rated` lists are built from
   * average scores with real vote weight, so the ranking is honest — no local
   * re-sorting. Hollywood and Bollywood both join so the list never reads as
   * English-only.
   */
  async getTopRatedTitlesPage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const [movies, tv] = await Promise.all([
      tmdbClient.topRatedMovies(safePage, signal),
      tmdbClient.topRatedTv(safePage, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
        (tv.results ?? []).slice(0, size).map(mapTmdbTv),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, tv.total_pages ?? 1)),
    };
  }

  /**
   * Flops: the worst-rated released titles that still found an audience. The
   * vote floor (`FLOP_MIN_VOTES`) keeps no-name 0.0 entries out; what remains
   * is tried-and-missed — the "everyone watched, nobody loved" shelf.
   */
  async getFlopsPage(page: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const [movies, tv] = await Promise.all([
      tmdbClient.discoverMovies(safePage, { language: 'en', sortBy: 'vote_average.asc', voteCountGte: FLOP_MIN_VOTES }, signal),
      tmdbClient.discoverTv(safePage, { language: 'en', sortBy: 'vote_average.asc', voteCountGte: FLOP_MIN_VOTES }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
        (tv.results ?? []).slice(0, size).map(mapTmdbTv),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, tv.total_pages ?? 1)),
    };
  }

  /**
   * Best of one calendar year: average score first, with a vote floor so a
   * single 10/10 vote can never top the year. Hollywood, Bollywood, and TV
   * all join; unreleased titles are dropped like every other discovery feed.
   */
  async getYearPage(page: number, year: number, signal?: AbortSignal): Promise<PagedCatalog> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeYear = Number.isSafeInteger(year) ? year : new Date().getFullYear();
    const [movies, moviesHi, tv] = await Promise.all([
      tmdbClient.discoverMovies(safePage, { language: 'en', primaryReleaseYear: safeYear, sortBy: 'vote_average.desc', voteCountGte: YEAR_MIN_VOTES }, signal),
      tmdbClient.discoverMovies(safePage, { language: 'hi', primaryReleaseYear: safeYear, sortBy: 'vote_average.desc', voteCountGte: Math.round(YEAR_MIN_VOTES / 4) }, signal),
      tmdbClient.discoverTv(safePage, { language: 'en', firstAirDateYear: safeYear, sortBy: 'vote_average.desc', voteCountGte: YEAR_MIN_VOTES }, signal),
    ]);
    const size = 20;
    return {
      items: releasedOnly(interleaveRanked([
        (movies.results ?? []).slice(0, size).map(mapTmdbMovie),
        (tv.results ?? []).slice(0, size).map(mapTmdbTv),
        (moviesHi.results ?? []).slice(0, size).map(mapTmdbMovie),
      ], size * 2)),
      page: safePage,
      totalPages: RemoteCatalogRepository.maxPages(Math.max(movies.total_pages ?? 1, moviesHi.total_pages ?? 1, tv.total_pages ?? 1)),
    };
  }
}

export const catalogRepository: CatalogRepositoryContract = new RemoteCatalogRepository();
