import type { CatalogMedia, CatalogSeason, MediaEpisode, MediaIdentity, SeasonSummary } from '@/domain/models/media';
import { mediaId } from '@/features/catalog/mediaIdentity';
import type { AniListMediaDto, AniListRelationNode } from './types';

export function plainDescription(value?: string | null): string | undefined {
  if (!value) return undefined;
  const plain = value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&#x27;/gi, "'")
    // AniList appends a "(Source: …)" attribution that reads like body copy.
    .replace(/\s*\(Source:[^)]*\)\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain || undefined;
}

export interface AnimeSeasonInput {
  number: number;
  title: string;
  aired?: string;
  synopsis?: string;
  stillUrl?: string;
  runtimeMinutes?: number;
}

/**
 * True for entries that read as a main season: TV format with either an
 * unknown count (airing) or more than one episode. Single-episode TV entries
 * are recaps/specials and would render as misleading extra "seasons".
 */
export function isMainSeasonEntry(input: { format?: string | null; episodes?: number | null }): boolean {
  if ((input.format ?? '') !== 'TV') return false;
  const count = input.episodes ?? undefined;
  return count === undefined || count === null || count === 0 || count > 1;
}

export interface AnimeSeasonEntry {
  providerId: string;
  malId?: number;
  title: string;
  episodes?: number;
  airDate?: string;
  posterUrl?: string;
  year?: number;
  month?: number;
  day?: number;
  /** Exact future episode dates declared by AniList for this entry. */
  futureEpisodes?: { episodeNumber: number; airDate: string }[];
}

/** Unix airing timestamp → local calendar date, matching every other air date. */
export function airDateFromAiringAt(seconds?: number | null): string | undefined {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Future dates declared by AniList. `airingSchedule` is the full remaining
 * broadcast list; `nextAiringEpisode` is the cheap single-date fallback carried
 * by list queries and relation nodes.
 */
export function animeFutureEpisodes(dto: {
  nextAiringEpisode?: { episode?: number | null; airingAt?: number | null } | null;
  airingSchedule?: { nodes?: ({ episode?: number | null; airingAt?: number | null } | null)[] | null } | null;
}): { episodeNumber: number; airDate: string }[] {
  const dates = new Map<number, string>();
  for (const node of dto.airingSchedule?.nodes ?? []) {
    const episodeNumber = node?.episode;
    const airDate = airDateFromAiringAt(node?.airingAt);
    if (Number.isSafeInteger(episodeNumber) && (episodeNumber as number) > 0 && airDate) {
      dates.set(episodeNumber as number, airDate);
    }
  }
  const nextNumber = dto.nextAiringEpisode?.episode;
  const nextDate = airDateFromAiringAt(dto.nextAiringEpisode?.airingAt);
  if (Number.isSafeInteger(nextNumber) && (nextNumber as number) > 0 && nextDate && !dates.has(nextNumber as number)) {
    dates.set(nextNumber as number, nextDate);
  }
  return [...dates.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episodeNumber, airDate]) => ({ episodeNumber, airDate }));
}

function entryFromRelationNode(node: AniListRelationNode | null | undefined): AnimeSeasonEntry | null {
  if (!node || !Number.isSafeInteger(node.id)) return null;
  // Only main TV seasons join the chain; movies, shorts, and one-off
  // specials stay separate titles instead of fake "Season N" rows.
  if (!isMainSeasonEntry({ format: node.format, episodes: node.episodes })) return null;
  return {
    providerId: String(node.id),
    malId: node.idMal ?? undefined,
    title: node.title?.english || node.title?.romaji || node.title?.native || `Anime ${node.id}`,
    episodes: node.episodes ?? undefined,
    airDate: releaseDateFromParts(node.startDate),
    posterUrl: node.coverImage?.large || undefined,
    year: node.startDate?.year ?? undefined,
    month: node.startDate?.month ?? undefined,
    day: node.startDate?.day ?? undefined,
    futureEpisodes: node.nextAiringEpisode ? animeFutureEpisodes(node) : undefined,
  };
}

/**
 * One AniList entry plus its TV-like prequel/sequel relations, oldest first.
 * AniList splits cours into separate entries (e.g. Jujutsu Kaisen's three
 * seasons), so the chain — not the single entry — is the season list. Only
 * the already-fetched relation edges are used here; the repository walks the
 * full chain across entries.
 */
export function animeSeasonEntries(dto: AniListMediaDto): AnimeSeasonEntry[] {
  const self: AnimeSeasonEntry = {
    providerId: String(dto.id),
    malId: dto.idMal ?? undefined,
    title: dto.title?.english || dto.title?.romaji || dto.title?.native || `Anime ${dto.id}`,
    episodes: dto.episodes ?? undefined,
    airDate: releaseDateFromParts(dto.startDate),
    posterUrl: dto.coverImage?.extraLarge || dto.coverImage?.large || undefined,
    year: dto.startDate?.year ?? undefined,
    month: dto.startDate?.month ?? undefined,
    day: dto.startDate?.day ?? undefined,
    futureEpisodes: animeFutureEpisodes(dto),
  };
  const seen = new Set([self.providerId]);
  const related: AnimeSeasonEntry[] = [];
  for (const edge of dto.relations?.edges ?? []) {
    if (edge?.relationType !== 'PREQUEL' && edge?.relationType !== 'SEQUEL') continue;
    const entry = edge?.node ? entryFromRelationNode(edge.node) : null;
    if (!entry || seen.has(entry.providerId)) continue;
    seen.add(entry.providerId);
    related.push(entry);
  }
  return [...related, self].sort(compareSeasonEntries);
}

function compareSeasonEntries(a: AnimeSeasonEntry, b: AnimeSeasonEntry): number {
  // Undated entries sort last: a missing date means side content, and it must
  // never push the real Season 1 down the list.
  const yearA = a.year ?? Number.POSITIVE_INFINITY;
  const yearB = b.year ?? Number.POSITIVE_INFINITY;
  return yearA - yearB || (a.month ?? 0) - (b.month ?? 0) || (a.day ?? 0) - (b.day ?? 0) || Number(a.providerId) - Number(b.providerId);
}

export function animeEntriesToSummaries(entries: AnimeSeasonEntry[]): SeasonSummary[] {
  return [...entries].sort(compareSeasonEntries).map((entry, index) => ({
    seasonNumber: index + 1,
    name: `Season ${index + 1}`,
    episodeCount: entry.episodes,
    airDate: entry.airDate,
    posterUrl: entry.posterUrl,
    refProviderId: entry.providerId,
    refMalId: entry.malId,
    ...(entry.futureEpisodes?.length ? { futureEpisodes: entry.futureEpisodes } : {}),
  }));
}

/**
 * One AniList entry can be one of several seasons, so the season number is
 * explicit. Episode titles come from the Kitsu open API (stills included, so
 * anime rows read exactly like show rows); when it is unreachable the caller
 * passes a synthetic 1..N list so tracking still works — never an error.
 */
export function mapAnimeSeason(identity: MediaIdentity, seasonNumber: number, title: string, episodes: AnimeSeasonInput[]): CatalogSeason {
  const items: MediaEpisode[] = episodes.map((episode) => ({
    provider: 'anilist', mediaType: 'anime', providerId: `${identity.providerId}-s${seasonNumber}e${episode.number}`,
    seriesId: identity.providerId, seasonNumber, episodeNumber: episode.number,
    title: episode.title || `Episode ${episode.number}`,
    overview: episode.synopsis, airDate: episode.aired,
    stillUrl: episode.stillUrl, runtimeMinutes: episode.runtimeMinutes,
  }));
  return { series: identity, seasonNumber, name: title || `Season ${seasonNumber}`, episodes: items };
}

/** Synthetic 1..N episode list so tracking never depends on a third party. */
export function syntheticAnimeSeason(identity: MediaIdentity, seasonNumber: number, total: number): CatalogSeason {
  const count = Math.max(1, Math.min(Math.floor(total) || 0, 2000));
  return mapAnimeSeason(
    identity,
    seasonNumber,
    `Season ${seasonNumber}`,
    Array.from({ length: count }, (_, index) => ({ number: index + 1, title: `Episode ${index + 1}` })),
  );
}

export function releaseDateFromParts(value?: { year?: number | null; month?: number | null; day?: number | null } | null): string | undefined {
  const year = value?.year ?? undefined;
  if (!year) return undefined;
  const month = value?.month ?? undefined;
  const day = value?.day ?? undefined;
  if (!month || !day) return `${year}`;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function mapAniListAnime(dto: AniListMediaDto): CatalogMedia {
  const identity: MediaIdentity = { provider: 'anilist', mediaType: 'anime', providerId: String(dto.id) };
  const title = dto.title?.english || dto.title?.romaji || dto.title?.native || `Anime ${dto.id}`;
  const releaseDate = releaseDateFromParts(dto.startDate);
  const episodeCount = dto.episodes ?? undefined;
  // Seasons come from the prequel/sequel chain when the query fetched
  // relations (detail), otherwise the single entry is Season 1. Every summary
  // carries the entry backing it so episodes resolve per season.
  const entries = animeSeasonEntries(dto);
  const seasonSummaries: SeasonSummary[] | undefined = episodeCount && episodeCount > 0
    ? animeEntriesToSummaries(entries.length > 1 ? entries : [{ ...entries[0], episodes: episodeCount }])
    : undefined;
  return {
    ...identity, id: mediaId(identity), title, originalTitle: dto.title?.native || dto.title?.romaji || undefined,
    overview: plainDescription(dto.description), posterUrl: dto.coverImage?.extraLarge || dto.coverImage?.large || undefined,
    backdropUrl: dto.bannerImage || undefined, releaseDate,
    year: dto.startDate?.year ?? undefined, genres: (dto.genres ?? []).filter((genre): genre is string => Boolean(genre)).map((name) => ({ name })),
    rating: dto.averageScore == null ? undefined : dto.averageScore / 10, voteCount: dto.popularity ?? undefined,
    runtimeMinutes: dto.duration ?? undefined, status: dto.status ?? undefined, numberOfEpisodes: episodeCount,
    seasonSummaries, animeFormat: dto.format ?? undefined, animeSeason: dto.season ? `${dto.season}${dto.seasonYear ? ` ${dto.seasonYear}` : ''}` : undefined,
    popularity: dto.popularity ?? undefined, studios: (dto.studios?.nodes ?? []).map((studio) => studio?.name).filter((name): name is string => Boolean(name)),
    malId: dto.idMal ?? undefined,
    episodeMetadata: episodeCount && episodeCount > 0 ? 'available' : 'unavailable',
  };
}
