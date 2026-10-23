import { AppError } from '@/domain/errors/AppError';
import { CatalogError } from '@/domain/errors/CatalogError';
import type { CatalogMedia, CatalogSeason, MediaIdentity } from '@/domain/models/media';
import type { WatchStateRepository } from '@/domain/models/watchState';
import { catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { hasAired } from '@/features/catalog/upcoming';

export type TitleStatus = 'none' | 'plan' | 'watching' | 'finished';

export function getMovieStatus(input: { watchlisted: boolean; movieWatched: boolean }): TitleStatus {
  if (input.movieWatched) return 'finished';
  if (input.watchlisted) return 'plan';
  return 'none';
}

export function getSeriesStatus(input: { watchlisted: boolean; tracking: boolean; complete: boolean }): TitleStatus {
  if (input.complete) return 'finished';
  if (input.tracking) return 'watching';
  if (input.watchlisted) return 'plan';
  return 'none';
}

export const STATUS_LABELS: Record<TitleStatus, string> = {
  none: 'Not tracked',
  plan: 'Plan to Watch',
  watching: 'Watching',
  finished: 'Finished',
};

interface ProgressContext {
  getFullMedia: (identity: MediaIdentity) => Promise<CatalogMedia>;
  getSeason: (identity: MediaIdentity, seasonNumber: number) => Promise<CatalogSeason>;
  repo?: Pick<WatchStateRepository, 'markMovieWatched' | 'startTrackingSeries' | 'storeSeason' | 'setSeriesWatched' | 'setSeriesComplete' | 'getCachedSeason' | 'markEpisodesUpTo'>;
}

const defaultContext = (): ProgressContext => ({
  getFullMedia: (identity) => catalogRepository.getMedia(identity),
  getSeason: (identity, seasonNumber) => catalogRepository.getSeason(identity, seasonNumber),
  repo: watchStateRepository,
});

/**
 * One-tap "Already seen": movies finish instantly; series and anime fetch
 * their real season metadata first and then mark every episode that has
 * aired. Future weekly episodes are cached for the schedule but stay
 * unwatched, so an in-progress show never reads as completed. Anime without
 * any episode data falls back to a completion flag (never invented).
 */
export async function finishTitle(media: CatalogMedia, context: ProgressContext = defaultContext()): Promise<void> {
  const repo = context.repo ?? watchStateRepository;
  if (media.mediaType === 'movie') {
    await repo.markMovieWatched(media, true);
    return;
  }

  const finishWithoutEpisodes = async () => {
    await repo.startTrackingSeries(media);
    await repo.setSeriesComplete(media, true);
  };

  if (media.provider === 'anilist' && media.mediaType === 'anime') {
    try {
      const full = media.seasonSummaries?.length ? media : await context.getFullMedia(media);
      const summaries = full.seasonSummaries ?? [];
      if (!summaries.length) throw new AppError('catalog', "Episode information isn't available for this title.");
      const seasons = await collectSeasons(full, summaries, context, repo);
      if (!seasons.length) throw new AppError('catalog', "Episode information isn't available for this title.");
      await repo.setSeriesWatched(full, seasons, true);
    } catch {
      // No episode data anywhere: track + flag complete instead of failing.
      await finishWithoutEpisodes();
    }
    return;
  }

  if (media.provider === 'tvdb' || (media.provider === 'tmdb' && media.mediaType === 'series')) {
    // Prefer the season summaries the content page already has: re-fetching
    // the parent title on every finish is what used to hit TMDb rate limits
    // after a title was moved to the watchlist and marked again.
    const full = media.seasonSummaries?.length ? media : await context.getFullMedia(media);
    const summaries = full.seasonSummaries ?? [];
    if (!summaries.length) throw new AppError('catalog', "Episode information isn't available for this title.");
    const seasons = await collectSeasons(full, summaries, context, repo);
    // Every season request can fail (offline, rate limit) while cached episode
    // rows still exist. Marking the series complete is better than showing the
    // user an error after a deliberate "Mark as Watched" tap.
    if (!seasons.length) {
      await finishWithoutEpisodes();
      return;
    }
    await repo.setSeriesWatched(full, seasons, true);
    return;
  }

  await finishWithoutEpisodes();
}

interface FinishSeason {
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  overview?: string;
  airDate?: string;
  posterUrl?: string;
  episodes: CatalogSeason['episodes'];
}

/** Stay below provider burst limits while still finishing a long show quickly. */
const SEASON_FETCH_CONCURRENCY = 4;
const SEASON_RETRY_DELAYS_MS = [400, 1200];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSeasonError(error: unknown): boolean {
  return error instanceof CatalogError
    && (error.code === 'rate_limited' || error.code === 'server' || error.code === 'timeout' || error.code === 'network');
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Cached seasons first, network only for the gaps. A burst of 20+ season
 * requests can be rate-limited, which used to leave a long show silently
 * half-finished, so missing seasons retry with backoff and run in a small pool.
 */
async function collectSeasons(
  full: CatalogMedia,
  summaries: { seasonNumber: number; episodeCount?: number }[],
  context: ProgressContext,
  repo: NonNullable<ProgressContext['repo']>,
): Promise<FinishSeason[]> {
  const identity: MediaIdentity = { provider: full.provider, mediaType: full.mediaType, providerId: full.providerId };
  const seasons: FinishSeason[] = [];
  const missing: typeof summaries = [];

  // Read every cached season in one parallel pass. A 20-season show used to
  // do 20 sequential SQLite round trips before the first network request.
  const cachedSeasons = await Promise.all(summaries.map(async (summary): Promise<{ summary: typeof summary; season?: CatalogSeason }> => {
    if (!repo.getCachedSeason) return { summary };
    try { return { summary, season: await repo.getCachedSeason(identity, summary.seasonNumber) }; }
    catch { return { summary }; }
  }));
  for (const { summary, season } of cachedSeasons) {
    if (season?.episodes.length) seasons.push({ ...season, episodeCount: summary.episodeCount });
    else missing.push(summary);
  }

  const fetched = await mapWithConcurrency(missing, SEASON_FETCH_CONCURRENCY, async (summary) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const season = await context.getSeason(full, summary.seasonNumber);
        return season.episodes.length ? { ...season, episodeCount: summary.episodeCount } : undefined;
      } catch (error) {
        if (attempt >= SEASON_RETRY_DELAYS_MS.length || !isRetryableSeasonError(error)) return undefined;
        await delay(SEASON_RETRY_DELAYS_MS[attempt]);
      }
    }
  });
  for (const season of fetched) if (season) seasons.push(season);
  return seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * "I'm up to here": marks every cached episode at or before the position as
 * watched, fetching and caching the season first when it is missing.
 *
 * Weekly shows publish one episode at a time, so the position is clamped to
 * the last episode that has actually aired — asking for a future episode marks
 * what exists and returns that position.
 */
export async function markUpToHere(media: CatalogMedia, seasonNumber: number, episodeNumber: number, context: ProgressContext = defaultContext()): Promise<number> {
  const repo = context.repo ?? watchStateRepository;
  const isTmdbSeries = media.provider === 'tmdb' && media.mediaType === 'series';
  const isAnime = media.provider === 'anilist' && media.mediaType === 'anime';
  const isTvdbSeries = media.provider === 'tvdb' && media.mediaType !== 'movie';
  if (!isTmdbSeries && !isAnime && !isTvdbSeries) throw new AppError('catalog', "Episode information isn't available for this title.");
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || !Number.isSafeInteger(episodeNumber) || episodeNumber < 1) {
    throw new AppError('validation', 'Enter a valid season and episode number.');
  }
  const identity: MediaIdentity = { provider: media.provider, mediaType: media.mediaType, providerId: media.providerId };
  let season = await repo.getCachedSeason(identity, seasonNumber);
  if (!season || season.episodes.length < episodeNumber) {
    const full = await context.getFullMedia(identity);
    const fetched = await context.getSeason(identity, seasonNumber);
    await repo.storeSeason(full, fetched.seasonNumber, fetched.name, fetched.episodes.length, fetched.overview, fetched.airDate, fetched.posterUrl, fetched.episodes);
    season = (await repo.getCachedSeason(identity, seasonNumber)) ?? fetched;
  }
  const lastAired = season.episodes.reduce((latest, episode) => (hasAired(episode.airDate) ? Math.max(latest, episode.episodeNumber) : latest), 0);
  if (lastAired < 1) throw new AppError('catalog', 'No episodes of this season have aired yet.');
  const target = Math.min(episodeNumber, lastAired);
  await repo.markEpisodesUpTo(media, season, target);
  return target;
}
