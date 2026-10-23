import type { SQLiteDatabase } from 'expo-sqlite';
import { AppError } from '@/domain/errors/AppError';
import type { CatalogMedia, CatalogSeason, MediaEpisode, MediaIdentity } from '@/domain/models/media';
import type { ContinueWatchingItem, CustomListDetail, CustomListSummary, FavoriteEntry, HistoryItem, InterestedEntry, LibraryStatus, ListFolder, PendingWatchStateChange, SeriesProgress, TrashItem, UpcomingEpisode, UserRating, WatchPriority, WatchStateRepository, WatchStateSyncRepository, WatchlistEntry, WatchedEpisodeSnapshot, WatchedLibraryItem } from '@/domain/models/watchState';
import { isWatchPriority } from '@/features/watchState/priority';
import { hasAired } from '@/features/catalog/upcoming';
import { getDatabase } from '@/data/local/database/database';
import { mediaId } from '@/features/catalog/mediaIdentity';

interface MediaRow {
  id: string; provider: CatalogMedia['provider']; provider_id: string; media_type: CatalogMedia['mediaType']; title: string;
  original_title: string | null; overview: string | null; poster_url: string | null; backdrop_url: string | null;
  release_date: string | null; year: number | null; genres: string; rating: number | null; vote_count?: number | null;
  runtime_minutes: number | null; status: string | null; language: string | null; origin_countries: string;
  number_of_seasons: number | null; number_of_episodes: number | null; season_summaries: string; anime_format: string | null;
  anime_season: string | null; popularity: number | null; studios: string; episode_metadata: CatalogMedia['episodeMetadata'];
}

interface EpisodeRow {
  id: string; provider: string; provider_id: string; series_id: string; season_number: number; episode_number: number; title: string;
  overview: string | null; air_date: string | null; still_url: string | null; runtime_minutes: number | null;
  watched_at: string | null; rewatch_count?: number | null; created_at?: string;
}

interface SeriesRow extends MediaRow {
  watched_count: number; cached_count: number; watched_at?: string | null; added_at?: string | null;
  completed?: number | null; completed_at?: string | null;
  /** Manual AniList counter; merged into progress because anime has no episode rows. */
  anime_watched_count?: number | null;
  anime_watched_at?: string | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapMedia(row: MediaRow): CatalogMedia {
  return {
    id: row.id, provider: row.provider, providerId: row.provider_id, mediaType: row.media_type,
    title: row.title, originalTitle: row.original_title ?? undefined, overview: row.overview ?? undefined,
    posterUrl: row.poster_url ?? undefined, backdropUrl: row.backdrop_url ?? undefined,
    releaseDate: row.release_date ?? undefined, year: row.year ?? undefined,
    genres: parseJson(row.genres, []), rating: row.rating ?? undefined, voteCount: row.vote_count ?? undefined,
    runtimeMinutes: row.runtime_minutes ?? undefined, status: row.status ?? undefined, language: row.language ?? undefined,
    originCountries: parseJson(row.origin_countries, []), numberOfSeasons: row.number_of_seasons ?? undefined,
    numberOfEpisodes: row.number_of_episodes ?? undefined, seasonSummaries: parseJson(row.season_summaries, []),
    animeFormat: row.anime_format ?? undefined, animeSeason: row.anime_season ?? undefined,
    popularity: row.popularity ?? undefined, studios: parseJson(row.studios, []), episodeMetadata: row.episode_metadata,
  };
}

function mapEpisode(row: EpisodeRow): MediaEpisode {
  const provider = row.provider === 'anilist' ? 'anilist' as const : row.provider === 'tvdb' ? 'tvdb' as const : 'tmdb' as const;
  // The series id is provider-qualified (`tvdb:anime:81797`), so the episode
  // media type follows the tracked parent — no parent lookup needed.
  const seriesKind = row.series_id.split(':')[1];
  const mediaType = provider === 'anilist' || seriesKind === 'anime' ? 'anime' as const : 'series' as const;
  return {
    provider, mediaType, providerId: row.provider_id, seriesId: row.series_id.replace(/^tmdb:series:|^anilist:anime:|^tvdb:(?:series|anime):/, ''),
    seasonNumber: row.season_number, episodeNumber: row.episode_number, title: row.title,
    overview: row.overview ?? undefined, airDate: row.air_date ?? undefined, stillUrl: row.still_url ?? undefined,
    runtimeMinutes: row.runtime_minutes ?? undefined,
  };
}

function episodeRowId(provider: string, providerId: string): string {
  const prefix = provider === 'anilist' ? 'anilist' : provider === 'tvdb' ? 'tvdb' : 'tmdb';
  return `${prefix}:episode:${encodeURIComponent(providerId)}`;
}

function optional(value: string | number | undefined): string | number | null { return value ?? null; }

async function trashSnapshot(
  db: SQLiteDatabase,
  kind: TrashItem['kind'],
  input: { media?: CatalogMedia; listSnapshot?: CustomListDetail | null; originListId?: string | null; watchedAt?: string | null; favoritedAt?: string | null },
): Promise<void> {
  await db.runAsync(
    'INSERT INTO deleted_items (kind, media_json, list_snapshot, origin_list_id, watched_at, favorited_at) VALUES (?, ?, ?, ?, ?, ?)',
    kind,
    input.media ? JSON.stringify(syncSnapshot(input.media)) : null,
    input.listSnapshot ? JSON.stringify(input.listSnapshot) : null,
    input.originListId ?? null,
    input.watchedAt ?? null,
    input.favoritedAt ?? null,
  );
}

export const TRASH_RETENTION_DAYS = 30;

async function purgeExpiredTrash(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(`DELETE FROM deleted_items WHERE deleted_at < datetime('now', '-${TRASH_RETENTION_DAYS} days')`);
}

function syncSnapshot(media: CatalogMedia): CatalogMedia {
  return {
    id: media.id, provider: media.provider, providerId: media.providerId, mediaType: media.mediaType,
    title: media.title, originalTitle: media.originalTitle, overview: media.overview, posterUrl: media.posterUrl,
    backdropUrl: media.backdropUrl, releaseDate: media.releaseDate, year: media.year, genres: media.genres,
    numberOfSeasons: media.numberOfSeasons, numberOfEpisodes: media.numberOfEpisodes,
    seasonSummaries: media.seasonSummaries, episodeMetadata: media.episodeMetadata,
  };
}

const SYNC_QUEUE_COLUMNS = '(entity_type, entity_key, provider, media_type, provider_id, season_number, episode_number, is_deleted, updated_at, payload, media_json, rewatch_count, position)';
const SYNC_QUEUE_UPDATE = `ON CONFLICT(entity_type, entity_key) DO UPDATE SET provider=excluded.provider, media_type=excluded.media_type, provider_id=excluded.provider_id,
  season_number=excluded.season_number, episode_number=excluded.episode_number, is_deleted=excluded.is_deleted, updated_at=excluded.updated_at, payload=excluded.payload, media_json=excluded.media_json, rewatch_count=excluded.rewatch_count, position=excluded.position, last_error=NULL`;

function syncChangeParams(change: Omit<PendingWatchStateChange, 'id' | 'retryCount'>): (string | number | null)[] {
  return [
    change.entityType, change.entityKey, change.provider, change.mediaType, change.providerId,
    optional(change.seasonNumber), optional(change.episodeNumber), change.deleted ? 1 : 0, change.updatedAt,
    JSON.stringify({ media: syncSnapshot(change.media), watchedAt: change.watchedAt, episode: change.episode, completed: change.completed, priority: change.priority }),
    JSON.stringify(syncSnapshot(change.media)),
    change.rewatchCount ?? 0,
    change.entityType === 'watchlist' ? change.position ?? 0 : 0,
  ];
}

async function enqueueSyncChange(db: SQLiteDatabase, change: Omit<PendingWatchStateChange, 'id' | 'retryCount'>): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue ${SYNC_QUEUE_COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${SYNC_QUEUE_UPDATE}`,
    ...syncChangeParams(change),
  );
}

/**
 * Bulk writes are what keep "Mark as Watched" instant on a 10-season show.
 * SQLite bridges every statement, so one multi-row upsert per 40 episodes
 * replaces hundreds of round trips without changing the queue's shape.
 */
async function enqueueSyncChanges(db: SQLiteDatabase, changes: Omit<PendingWatchStateChange, 'id' | 'retryCount'>[]): Promise<void> {
  const chunkSize = 40;
  for (let offset = 0; offset < changes.length; offset += chunkSize) {
    const chunk = changes.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((change) => syncChangeParams(change));
    await db.runAsync(`INSERT INTO sync_queue ${SYNC_QUEUE_COLUMNS} VALUES ${values} ${SYNC_QUEUE_UPDATE}`, ...params);
  }
}

/**
 * A restore replaces local data while the old sync queue may still describe
 * the pre-restore library. Rebuild the queue from the restored rows so the
 * cloud converges to the backup instead of resurrecting stale local state.
 */
async function rebuildSyncQueueAfterRestore(db: SQLiteDatabase, now: string): Promise<void> {
  await db.runAsync('DELETE FROM sync_queue');
  const changes: Omit<PendingWatchStateChange, 'id' | 'retryCount'>[] = [];

  const watchlist = await db.getAllAsync<MediaRow & { added_at: string; position: number | null; priority: string | null }>('SELECT m.*, w.added_at, w.position, w.priority FROM watchlist_entries w JOIN tracked_media m ON m.id = w.media_id');
  for (const row of watchlist) changes.push({ entityType: 'watchlist', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, watchedAt: row.added_at, media: mapMedia(row), position: row.position ?? 0, priority: isWatchPriority(row.priority) ? row.priority : undefined });

  const movies = await db.getAllAsync<MediaRow & { watched_at: string }>('SELECT m.*, w.watched_at FROM movie_watches w JOIN tracked_media m ON m.id = w.media_id');
  for (const row of movies) changes.push({ entityType: 'movie', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, watchedAt: row.watched_at, media: mapMedia(row) });

  const favorites = await db.getAllAsync<MediaRow & { favorited_at: string }>('SELECT m.*, f.favorited_at FROM favorite_entries f JOIN tracked_media m ON m.id = f.media_id');
  for (const row of favorites) changes.push({ entityType: 'favorite', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, watchedAt: row.favorited_at, media: mapMedia(row) });

  const interested = await db.getAllAsync<MediaRow & { marked_at: string }>('SELECT m.*, i.marked_at FROM interested_entries i JOIN tracked_media m ON m.id = i.media_id');
  for (const row of interested) changes.push({ entityType: 'interested', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, watchedAt: row.marked_at, media: mapMedia(row) });

  const ratings = await db.getAllAsync<MediaRow & { rating_value: number | null; thumbs: number; rated_at: string }>('SELECT m.*, r.rating AS rating_value, r.thumbs, r.updated_at AS rated_at FROM user_ratings r JOIN tracked_media m ON m.id = r.media_id');
  for (const row of ratings) changes.push({ entityType: 'rating', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, media: mapMedia(row), rating: row.rating_value, thumbs: row.thumbs === 1 ? 1 : row.thumbs === -1 ? -1 : 0 });

  const series = await db.getAllAsync<MediaRow & { completed?: number | null }>('SELECT m.*, s.completed FROM tracked_series s JOIN tracked_media m ON m.id = s.media_id');
  for (const row of series) changes.push({ entityType: 'series', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: now, media: mapMedia(row), completed: row.completed === 1 });

  const episodes = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE watched_at IS NOT NULL');
  const savedMedia = new Map((await db.getAllAsync<MediaRow>('SELECT * FROM tracked_media')).map((row) => [row.id, row]));
  for (const row of episodes) {
    const parent = savedMedia.get(row.series_id);
    if (!parent) continue;
    changes.push(episodeSyncChange(mapMedia(parent), mapEpisode(row), { deleted: false, updatedAt: now, watchedAt: row.watched_at ?? undefined, rewatchCount: row.rewatch_count ?? 0 }));
  }

  await enqueueSyncChanges(db, changes);
}

function episodeSyncChange(
  media: CatalogMedia,
  episode: MediaEpisode,
  input: { deleted: boolean; updatedAt: string; watchedAt?: string; rewatchCount?: number },
): Omit<PendingWatchStateChange, 'id' | 'retryCount'> {
  return {
    entityType: 'episode',
    entityKey: `${media.id}:${episode.seasonNumber}:${episode.episodeNumber}`,
    provider: media.provider,
    mediaType: media.mediaType,
    providerId: episode.providerId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    deleted: input.deleted,
    updatedAt: input.updatedAt,
    media,
    watchedAt: input.watchedAt,
    episode,
    rewatchCount: input.rewatchCount ?? 0,
  };
}

/** Marks only the rows that are not watched yet; rewatches are counted once. */
async function markEpisodeRowsWatched(db: SQLiteDatabase, ids: string[], now: string): Promise<void> {
  const chunkSize = 400;
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    await db.runAsync(
      `UPDATE tracked_episodes SET watched_at = COALESCE(watched_at, ?),
        rewatch_count = rewatch_count + CASE WHEN watched_at IS NOT NULL THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
      now, ...chunk,
    );
  }
}

async function clearEpisodeRowsWatched(db: SQLiteDatabase, ids: string[]): Promise<void> {
  const chunkSize = 400;
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    await db.runAsync(`UPDATE tracked_episodes SET watched_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ...chunk);
  }
}

async function saveMedia(db: SQLiteDatabase, media: CatalogMedia): Promise<void> {
  await db.runAsync(
    `INSERT INTO tracked_media (id, provider, provider_id, media_type, title, original_title, overview, poster_url, backdrop_url, release_date, year,
      genres, rating, vote_count, runtime_minutes, status, language, origin_countries, number_of_seasons, number_of_episodes, season_summaries, anime_format, anime_season, popularity, studios, episode_metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, provider_id=excluded.provider_id, media_type=excluded.media_type, title=excluded.title,
      original_title=excluded.original_title, overview=excluded.overview, poster_url=excluded.poster_url, backdrop_url=excluded.backdrop_url,
      release_date=excluded.release_date, year=excluded.year, genres=excluded.genres, rating=excluded.rating, vote_count=excluded.vote_count, runtime_minutes=excluded.runtime_minutes,
      status=excluded.status, language=excluded.language, origin_countries=excluded.origin_countries, number_of_seasons=excluded.number_of_seasons,
      number_of_episodes=excluded.number_of_episodes, season_summaries=excluded.season_summaries, anime_format=excluded.anime_format,
      anime_season=excluded.anime_season, popularity=excluded.popularity, studios=excluded.studios, episode_metadata=excluded.episode_metadata, updated_at=CURRENT_TIMESTAMP`,
    media.id, media.provider, media.providerId, media.mediaType, media.title, optional(media.originalTitle), optional(media.overview),
    optional(media.posterUrl), optional(media.backdropUrl), optional(media.releaseDate), optional(media.year), JSON.stringify(media.genres),
    optional(media.rating), optional(media.voteCount), optional(media.runtimeMinutes), optional(media.status), optional(media.language), JSON.stringify(media.originCountries ?? []),
    optional(media.numberOfSeasons), optional(media.numberOfEpisodes), JSON.stringify(media.seasonSummaries ?? []), optional(media.animeFormat),
    optional(media.animeSeason), optional(media.popularity), JSON.stringify(media.studios ?? []), media.episodeMetadata,
  );
}

function ensureTrackableSeries(media: CatalogMedia): void {
  if (media.mediaType === 'movie') throw new AppError('validation', 'Episode tracking is only available for series.');
  if (media.episodeMetadata === 'unavailable') throw new AppError('catalog', "Episode information isn't available for this title.");
  const isTmdbSeries = media.provider === 'tmdb' && media.mediaType === 'series';
  const isAnime = media.provider === 'anilist' && media.mediaType === 'anime';
  const isTvdbSeries = media.provider === 'tvdb' && (media.mediaType === 'series' || media.mediaType === 'anime');
  if (!isTmdbSeries && !isAnime && !isTvdbSeries) throw new AppError('catalog', "Episode information isn't available for this title.");
}

async function ensureSeries(db: SQLiteDatabase, media: CatalogMedia): Promise<void> {
  await saveMedia(db, media);
  await db.runAsync('INSERT INTO tracked_series (media_id) VALUES (?) ON CONFLICT(media_id) DO NOTHING', media.id);
}

async function saveEpisode(db: SQLiteDatabase, series: CatalogMedia, episode: MediaEpisode): Promise<void> {
  const episodeId = episodeRowId(episode.provider, episode.providerId);
  await db.runAsync(
    `INSERT INTO tracked_episodes (id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET series_id=excluded.series_id, season_number=excluded.season_number, episode_number=excluded.episode_number,
      title=excluded.title, overview=excluded.overview, air_date=excluded.air_date, still_url=excluded.still_url, runtime_minutes=excluded.runtime_minutes, updated_at=CURRENT_TIMESTAMP`,
    episodeId, episode.provider, episode.providerId, series.id, episode.seasonNumber, episode.episodeNumber, episode.title,
    optional(episode.overview), optional(episode.airDate), optional(episode.stillUrl), optional(episode.runtimeMinutes),
  );
}

async function saveEpisodes(db: SQLiteDatabase, media: CatalogMedia, episodes: MediaEpisode[]): Promise<void> {
  const chunkSize = 60;
  for (let offset = 0; offset < episodes.length; offset += chunkSize) {
    const chunk = episodes.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((episode) => [
      episodeRowId(episode.provider, episode.providerId), episode.provider, episode.providerId, media.id,
      episode.seasonNumber, episode.episodeNumber, episode.title,
      optional(episode.overview), optional(episode.airDate), optional(episode.stillUrl), optional(episode.runtimeMinutes),
    ]);
    await db.runAsync(
      `INSERT INTO tracked_episodes (id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes)
       VALUES ${values}
       ON CONFLICT(id) DO UPDATE SET series_id=excluded.series_id, season_number=excluded.season_number, episode_number=excluded.episode_number,
        title=excluded.title, overview=excluded.overview, air_date=excluded.air_date, still_url=excluded.still_url, runtime_minutes=excluded.runtime_minutes, updated_at=CURRENT_TIMESTAMP`,
      ...params,
    );
  }
}

async function saveSeason(db: SQLiteDatabase, media: CatalogMedia, season: { seasonNumber: number; name: string; episodeCount?: number; overview?: string; airDate?: string; posterUrl?: string; episodes: MediaEpisode[] }): Promise<void> {
  await db.runAsync(
    `INSERT INTO tracked_seasons (media_id, season_number, name, episode_count, overview, air_date, poster_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id, season_number) DO UPDATE SET name=excluded.name, episode_count=excluded.episode_count, overview=excluded.overview,
      air_date=excluded.air_date, poster_url=excluded.poster_url, updated_at=CURRENT_TIMESTAMP`,
    media.id, season.seasonNumber, season.name, optional(season.episodeCount), optional(season.overview), optional(season.airDate), optional(season.posterUrl),
  );
  await saveEpisodes(db, media, season.episodes);
}

function toProgress(row: SeriesRow, episodes: EpisodeRow[]): SeriesProgress {
  const media = mapMedia(row);
  const ordered = episodes.filter((episode) => !episode.watched_at).sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
  const nextEpisodes = ordered.map(mapEpisode);
  // Anime with no episode rows keeps its progress in `anime_progress`. Take
  // the larger count so a title that later gains real episodes keeps whatever
  // the user already recorded by hand.
  const watchedEpisodeCount = Math.max(row.watched_count, row.anime_watched_count ?? 0);
  const cachedEpisodeCount = row.cached_count;
  const summaryCounts = media.seasonSummaries?.map((season) => season.episodeCount);
  const totalEpisodeCount = media.numberOfEpisodes && media.numberOfEpisodes > 0 ? media.numberOfEpisodes
    : summaryCounts?.length && summaryCounts.every((count): count is number => typeof count === 'number') ? summaryCounts.reduce((sum, count) => sum + count, 0) : undefined;
  const denominator = totalEpisodeCount ?? cachedEpisodeCount;
  const nextEpisode = nextEpisodes[0];
  // A season that is still missing cached episodes is the next place to look —
  // including the current season when only its first few episodes have dropped.
  const nextSeasonNumber = !nextEpisode && totalEpisodeCount !== undefined && watchedEpisodeCount < totalEpisodeCount
    ? media.seasonSummaries?.find((season) => {
        const cachedInSeason = episodes.filter((episode) => episode.season_number === season.seasonNumber).length;
        if (cachedInSeason === 0) return true;
        return typeof season.episodeCount === 'number' ? cachedInSeason < season.episodeCount : false;
      })?.seasonNumber
    : undefined;
  return {
    identity: { provider: media.provider, mediaType: media.mediaType, providerId: media.providerId }, media,
    watchedEpisodeCount, cachedEpisodeCount, totalEpisodeCount,
    progress: denominator > 0 ? Math.min(1, watchedEpisodeCount / denominator) : 0,
    isComplete: row.completed === 1 || Boolean(totalEpisodeCount && watchedEpisodeCount >= totalEpisodeCount), lastWatchedAt: row.watched_at ?? row.anime_watched_at ?? row.completed_at ?? undefined, nextEpisode, nextEpisodes: nextEpisodes.slice(0, 40), nextSeasonNumber,
  };
}

function summariesTotal(summaries: { episodeCount?: number }[] | undefined): number | undefined {
  if (!summaries?.length) return undefined;
  const counts = summaries.map((season) => season.episodeCount);
  if (!counts.every((count): count is number => typeof count === 'number')) return undefined;
  const total = counts.reduce((sum, count) => sum + count, 0);
  return total > 0 ? total : undefined;
}

/** Episode total the catalog reported, mirroring `toProgress`'s denominator. */
function knownEpisodeTotal(media: { numberOfEpisodes?: number | null; seasonSummaries?: { episodeCount?: number }[] | null }): number | undefined {
  if (media.numberOfEpisodes && media.numberOfEpisodes > 0) return media.numberOfEpisodes;
  return summariesTotal(media.seasonSummaries ?? undefined);
}

/**
 * Signals selected next to a media row so every read path shares one definition
 * of "watched": a movie row, a completed series flag, or episode progress that
 * reached the known episode total — exactly what `toProgress().isComplete` and
 * the content page use.
 */
interface WatchedSignals {
  movie_watched?: number | null; watched_count?: number | null; completed?: number | null;
  number_of_episodes?: number | null; season_summaries?: string | null;
  numberOfEpisodes?: number | null; seasonSummaries?: { episodeCount?: number }[] | null;
}

const WATCHED_SIGNALS_SQL = `EXISTS (SELECT 1 FROM movie_watches mw WHERE mw.media_id = m.id) AS movie_watched,
  (SELECT COUNT(*) FROM tracked_episodes te WHERE te.series_id = m.id AND te.watched_at IS NOT NULL) AS watched_count,
  (SELECT ts.completed FROM tracked_series ts WHERE ts.media_id = m.id) AS completed,
  m.number_of_episodes, m.season_summaries`;

function isWatchedRow(row: WatchedSignals): boolean {
  if (row.movie_watched === 1) return true;
  if (row.completed === 1) return true;
  const summaries = row.seasonSummaries ?? (row.season_summaries ? parseJson<{ episodeCount?: number }[]>(row.season_summaries, []) : undefined);
  const total = knownEpisodeTotal({ numberOfEpisodes: row.number_of_episodes ?? row.numberOfEpisodes ?? undefined, seasonSummaries: summaries });
  const watched = row.watched_count ?? 0;
  return Boolean(total && watched > 0 && watched >= total);
}

/** True when the title currently reads as watched/finished anywhere in the app. */
async function isWatchedId(db: SQLiteDatabase, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<WatchedSignals>(`SELECT ${WATCHED_SIGNALS_SQL} FROM tracked_media m WHERE m.id = ?`, id);
  return Boolean(row && isWatchedRow(row));
}

/**
 * Removes the watchlist row as a state conversion (watched wins over the
 * watchlist), syncing a tombstone but never a trash snapshot — nothing the user
 * asked for was removed.
 */
async function dropWatchlistEntry(db: SQLiteDatabase, media: CatalogMedia, now: string): Promise<boolean> {
  const existing = await db.getFirstAsync<{ position: number | null }>('SELECT position FROM watchlist_entries WHERE media_id = ?', media.id);
  if (!existing) return false;
  await db.runAsync('DELETE FROM watchlist_entries WHERE media_id = ?', media.id);
  await enqueueSyncChange(db, { entityType: 'watchlist', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: true, updatedAt: now, media, position: existing.position ?? 0 });
  return true;
}

/**
 * Adding to the watchlist un-marks a watched title (last action wins). Only
 * titles that currently read as watched are cleared, so in-progress episode
 * progress is never destroyed by re-saving a watchlist entry.
 */
async function clearWatchedForWatchlist(db: SQLiteDatabase, media: CatalogMedia, now: string): Promise<void> {
  if (!await isWatchedId(db, media.id)) return;
  if (media.mediaType === 'movie') {
    await db.runAsync('DELETE FROM movie_watches WHERE media_id = ?', media.id);
    await enqueueSyncChange(db, { entityType: 'movie', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: true, updatedAt: now, media });
    return;
  }
  const watchedEpisodes = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND watched_at IS NOT NULL', media.id);
  if (watchedEpisodes.length) {
    await db.runAsync('UPDATE tracked_episodes SET watched_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE series_id = ? AND watched_at IS NOT NULL', media.id);
    await enqueueSyncChanges(db, watchedEpisodes.map((row) => episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: row.rewatch_count ?? 0 })));
  }
  const tracked = await db.getFirstAsync('SELECT 1 AS found FROM tracked_series WHERE media_id = ?', media.id);
  if (tracked) {
    await db.runAsync('UPDATE tracked_series SET completed = 0, completed_at = NULL, updated_at = ? WHERE media_id = ?', now, media.id);
    await enqueueSyncChange(db, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, completed: false });
  }
  await db.runAsync('DELETE FROM anime_progress WHERE media_id = ?', media.id);
}

/**
 * Clearing the last watched episode(s) un-finishes the series: a show with
 * unwatched episodes must never still read as watched/completed.
 */
async function clearSeriesCompletion(db: SQLiteDatabase, media: CatalogMedia, now: string): Promise<void> {
  const tracked = await db.getFirstAsync<{ completed: number | null }>('SELECT completed FROM tracked_series WHERE media_id = ?', media.id);
  if (tracked?.completed !== 1) return;
  await db.runAsync('UPDATE tracked_series SET completed = 0, completed_at = NULL, updated_at = ? WHERE media_id = ?', now, media.id);
  await enqueueSyncChange(db, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, completed: false });
}

/**
 * Completing the last known episode marks the series finished and drops it from
 * the watchlist, so episode-level writes can never leave a finished show in the
 * watchlist or still reading as in-progress.
 */
async function syncSeriesCompletion(db: SQLiteDatabase, media: CatalogMedia, now: string): Promise<void> {
  const counts = await db.getFirstAsync<{ watched: number }>('SELECT COUNT(*) AS watched FROM tracked_episodes WHERE series_id = ? AND watched_at IS NOT NULL', media.id);
  const watched = counts?.watched ?? 0;
  const total = knownEpisodeTotal(media);
  if (!total || watched <= 0) return;
  if (watched < total) {
    // A weekly title that still has future episodes must not stay completed
    // just because an older build had marked those future rows.
    await clearSeriesCompletion(db, media, now);
    return;
  }
  const tracked = await db.getFirstAsync<{ completed: number | null }>('SELECT completed FROM tracked_series WHERE media_id = ?', media.id);
  if (tracked?.completed !== 1) {
    await db.runAsync('UPDATE tracked_series SET completed = 1, completed_at = ?, updated_at = ? WHERE media_id = ?', now, now, media.id);
    await enqueueSyncChange(db, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, completed: true, watchedAt: now });
  }
  await dropWatchlistEntry(db, media, now);
}

/** Envelope marker so a random JSON file can never wipe the library on import. */
export const LIBRARY_BACKUP_FORMAT = 'watch-later-backup';
export const LIBRARY_BACKUP_VERSION = 1;

/** Every table holding user data. Infra (sync queue, bindings) and caches stay out. */
const BACKUP_TABLES = [
  'tracked_media',
  'watchlist_entries',
  'movie_watches',
  'tracked_series',
  'tracked_seasons',
  'tracked_episodes',
  'favorite_entries',
  'custom_lists',
  'custom_list_items',
  'user_ratings',
  'list_folders',
  'deleted_items',
  'interested_entries',
  'anime_progress',
] as const;

export interface LibraryBackup {
  format: string;
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export class SqliteWatchStateRepository implements WatchStateRepository, WatchStateSyncRepository {

  private binding?: { accountId: string; promise: Promise<void> };

  constructor(private readonly openDatabase: () => Promise<SQLiteDatabase> = getDatabase) {}

  private async run<T>(fallbackMessage: string, action: (database: SQLiteDatabase) => Promise<T>): Promise<T> {
    try { return await action(await this.openDatabase()); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('database', fallbackMessage, { cause: error });
    }
  }

  async getTrackedMedia(identity: MediaIdentity): Promise<CatalogMedia | undefined> {
    return this.run("Couldn't load this saved title.", async (db) => {
      const row = await db.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE provider = ? AND media_type = ? AND provider_id = ?', identity.provider, identity.mediaType, identity.providerId);
      return row ? mapMedia(row) : undefined;
    });
  }

  async getLibraryStatuses(identities: MediaIdentity[]): Promise<Record<string, LibraryStatus>> {
    const statuses: Record<string, LibraryStatus> = Object.fromEntries(identities.map((identity) => [mediaId(identity), { watchlisted: false, movieWatched: false, tracking: false, complete: false }]));
    if (!identities.length) return statuses;
    return this.run("Couldn't load saved states.", async (db) => {
      const ids = identities.map(mediaId);
      const placeholders = ids.map(() => '?').join(', ');
      const rows = await db.getAllAsync<{ id: string; on_watchlist: number; tracking: number } & WatchedSignals>(
        `SELECT m.id,
          EXISTS (SELECT 1 FROM watchlist_entries w WHERE w.media_id = m.id) AS on_watchlist,
          ${WATCHED_SIGNALS_SQL},
          EXISTS (SELECT 1 FROM tracked_series ts WHERE ts.media_id = m.id) AS tracking
         FROM tracked_media m WHERE m.id IN (${placeholders})`, ...ids,
      );
      for (const row of rows) {
        const complete = isWatchedRow(row);
        statuses[row.id] = { watchlisted: row.on_watchlist === 1 && !complete, movieWatched: row.movie_watched === 1, tracking: row.tracking === 1, complete };
      }
      return statuses;
    });
  }

  async getCachedSeason(identity: MediaIdentity, seasonNumber: number): Promise<CatalogSeason | undefined> {
    return this.run("Couldn't load saved episode information.", async (db) => {
      const seriesId = mediaId(identity);
      const season = await db.getFirstAsync<{ name: string; overview: string | null; air_date: string | null; poster_url: string | null }>(
        'SELECT name, overview, air_date, poster_url FROM tracked_seasons WHERE media_id = ? AND season_number = ?', seriesId, seasonNumber,
      );
      if (!season) return undefined;
      const rows = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND season_number = ? ORDER BY episode_number', seriesId, seasonNumber);
      return { series: identity, seasonNumber, name: season.name, overview: season.overview ?? undefined, airDate: season.air_date ?? undefined, posterUrl: season.poster_url ?? undefined, episodes: rows.map(mapEpisode) };
    });
  }

  async addToWatchlist(media: CatalogMedia): Promise<void> {
    await this.run("Couldn't update your watchlist. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        // Last action wins: saving to the watchlist un-marks a watched title.
        await clearWatchedForWatchlist(tx, media, now);
        const existing = await tx.getFirstAsync<{ position: number }>('SELECT position FROM watchlist_entries WHERE media_id = ?', media.id);
        const position = existing?.position ?? (await tx.getFirstAsync<{ position: number | null }>('SELECT COALESCE(MIN(position), 0) - 1 AS position FROM watchlist_entries'))?.position ?? -1;
        await tx.runAsync('INSERT INTO watchlist_entries (media_id, position) VALUES (?, ?) ON CONFLICT(media_id) DO NOTHING', media.id, position);
        await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, position });
      });
    });
  }

  async saveToWatchlist(media: CatalogMedia, priority: WatchPriority | null): Promise<void> {
    await this.run("Couldn't update your watchlist. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        // Last action wins: saving to the watchlist un-marks a watched title.
        await clearWatchedForWatchlist(tx, media, now);
        const existing = await tx.getFirstAsync<{ position: number; added_at: string }>('SELECT position, added_at FROM watchlist_entries WHERE media_id = ?', media.id);
        const position = existing?.position ?? (await tx.getFirstAsync<{ position: number | null }>('SELECT COALESCE(MIN(position), 0) - 1 AS position FROM watchlist_entries'))?.position ?? -1;
        await tx.runAsync(
          'INSERT INTO watchlist_entries (media_id, added_at, position, priority) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET priority=excluded.priority',
          media.id, existing?.added_at ?? now, position, priority,
        );
        await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: existing?.added_at ?? now, position, priority });
      });
    });
  }

  async moveWatchlistItem(identity: MediaIdentity, direction: -1 | 1): Promise<boolean> {
    return this.run("Couldn't reorder your watchlist. Try again.", async (db) => {
      const id = mediaId(identity);
      const rows = await db.getAllAsync<{ media_id: string; position: number }>('SELECT media_id, position FROM watchlist_entries ORDER BY position ASC, added_at DESC');
      const index = rows.findIndex((row) => row.media_id === id);
      const neighbor = rows[index + direction];
      if (index < 0 || !neighbor) return false;
      const current = rows[index];
      await db.withExclusiveTransactionAsync(async (tx) => {
        const now = new Date().toISOString();
        await tx.runAsync('UPDATE watchlist_entries SET position = ? WHERE media_id = ?', neighbor.position, current.media_id);
        await tx.runAsync('UPDATE watchlist_entries SET position = ? WHERE media_id = ?', current.position, neighbor.media_id);
        for (const [mediaIdValue, position] of [[current.media_id, neighbor.position], [neighbor.media_id, current.position]] as const) {
          const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', mediaIdValue);
          if (!mediaRow) continue;
          await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: mediaIdValue, provider: mediaRow.provider, mediaType: mediaRow.media_type, providerId: mediaRow.provider_id, deleted: false, updatedAt: now, media: mapMedia(mediaRow), position });
        }
      });
      return true;
    });
  }

  async removeFromWatchlist(identity: MediaIdentity): Promise<void> {
    await this.run("Couldn't update your watchlist. Try again.", async (db) => {
      const id = mediaId(identity);
      await db.withExclusiveTransactionAsync(async (tx) => {
        const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', id);
        if (mediaRow) {
          await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: id, provider: identity.provider, mediaType: identity.mediaType, providerId: identity.providerId, deleted: true, updatedAt: new Date().toISOString(), media: mapMedia(mediaRow) });
          await trashSnapshot(tx, 'watchlist', { media: mapMedia(mediaRow) });
        }
        await tx.runAsync('DELETE FROM watchlist_entries WHERE media_id = ?', id);
        await this.pruneMedia(tx, id);
      });
    });
  }

  async getWatchlist(): Promise<WatchlistEntry[]> {
    return this.run("Couldn't load your watchlist.", async (db) => {
      const rows = await db.getAllAsync<MediaRow & WatchedSignals & { added_at: string; position: number; priority: string | null }>(`SELECT m.*, ${WATCHED_SIGNALS_SQL}, w.added_at, w.position, w.priority FROM watchlist_entries w JOIN tracked_media m ON m.id = w.media_id ORDER BY w.position ASC, w.added_at DESC, m.title COLLATE NOCASE`);
      // Watchlist and Watched are mutually exclusive: hide rows that read as watched.
      return rows.filter((row) => !isWatchedRow(row)).map((row) => ({ media: mapMedia(row), addedAt: row.added_at, position: row.position ?? 0, priority: isWatchPriority(row.priority) ? row.priority : null }));
    });
  }

  async isInWatchlist(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't check your watchlist.", async (db) => {
      const row = await db.getFirstAsync<WatchedSignals>(`SELECT ${WATCHED_SIGNALS_SQL} FROM watchlist_entries w JOIN tracked_media m ON m.id = w.media_id WHERE w.media_id = ?`, mediaId(identity));
      return Boolean(row && !isWatchedRow(row));
    });
  }

  async markMovieWatched(media: CatalogMedia, watched: boolean): Promise<void> {
    if (media.mediaType !== 'movie') throw new AppError('validation', 'Only movies can be marked watched here.');
    await this.run("Couldn't update watched status. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        let rewatchCount = 0;
        if (watched) {
          await tx.runAsync(
            `INSERT INTO movie_watches (media_id, watched_at, rewatch_count) VALUES (?, ?, 0)
             ON CONFLICT(media_id) DO UPDATE SET watched_at=excluded.watched_at,
              rewatch_count = movie_watches.rewatch_count + CASE WHEN movie_watches.watched_at IS NOT NULL THEN 1 ELSE 0 END`,
            media.id, now,
          );
          rewatchCount = (await tx.getFirstAsync<{ rewatch_count: number }>('SELECT rewatch_count FROM movie_watches WHERE media_id = ?', media.id))?.rewatch_count ?? 0;
          // Watched wins over the watchlist: never both at once.
          await dropWatchlistEntry(tx, media, now);
        } else {
          const prior = await tx.getFirstAsync<{ watched_at: string }>('SELECT watched_at FROM movie_watches WHERE media_id = ?', media.id);
          if (prior) await trashSnapshot(tx, 'movie', { media, watchedAt: prior.watched_at });
          await tx.runAsync('DELETE FROM movie_watches WHERE media_id = ?', media.id);
        }
        await enqueueSyncChange(tx, { entityType: 'movie', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: !watched, updatedAt: now, media, watchedAt: watched ? now : undefined, rewatchCount });
        if (!watched) await this.pruneMedia(tx, media.id);
      });
    });
  }

  async isMovieWatched(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't load watched status.", async (db) => Boolean(await db.getFirstAsync('SELECT 1 AS found FROM movie_watches WHERE media_id = ?', mediaId(identity))));
  }

  async startTrackingSeries(media: CatalogMedia): Promise<void> {
    if (media.mediaType === 'movie') throw new AppError('validation', 'Only series can be tracked.');
    await this.run("Couldn't start tracking this series.", async (db) => { await db.withExclusiveTransactionAsync(async (tx) => { await ensureSeries(tx, media); await enqueueSyncChange(tx, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: new Date().toISOString(), media }); }); });
  }

  async stopTrackingSeries(identity: MediaIdentity): Promise<void> {
    await this.run("Couldn't stop tracking this series.", async (db) => {
      const id = mediaId(identity);
      await db.withExclusiveTransactionAsync(async (tx) => {
        const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', id);
        if (mediaRow) {
          await enqueueSyncChange(tx, { entityType: 'series', entityKey: id, provider: identity.provider, mediaType: identity.mediaType, providerId: identity.providerId, deleted: true, updatedAt: new Date().toISOString(), media: mapMedia(mediaRow) });
          await trashSnapshot(tx, 'series', { media: mapMedia(mediaRow) });
        }
        await tx.runAsync('DELETE FROM tracked_series WHERE media_id = ?', id);
        await this.pruneMedia(tx, id);
      });
    });
  }

  /**
   * Tracking means "currently watching": at least one season is part-watched
   * (or a manual anime count is mid-way). A finished show, a fully unwatched
   * show, or a show stalled between seasons (S1 done, S2 untouched) reads as
   * not tracking — until its next episode is watched. Seasons with no cached
   * episodes never decide.
   */
  async isSeriesTracked(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't load series tracking status.", async (db) => Boolean(await db.getFirstAsync(
      `SELECT 1 AS found FROM tracked_series t WHERE t.media_id = ?
        AND (t.completed IS NULL OR t.completed = 0)
        AND (
          EXISTS (
            SELECT 1 FROM tracked_episodes e WHERE e.series_id = t.media_id AND e.watched_at IS NULL
            AND EXISTS (
              SELECT 1 FROM tracked_episodes w
              WHERE w.series_id = e.series_id AND w.season_number = e.season_number AND w.watched_at IS NOT NULL
            )
          )
          OR EXISTS (
            SELECT 1 FROM anime_progress a JOIN tracked_media m ON m.id = a.media_id
            WHERE a.media_id = t.media_id AND a.watched_count > 0
              AND (m.number_of_episodes IS NULL OR m.number_of_episodes <= 0 OR a.watched_count < m.number_of_episodes)
          )
        )`,
      mediaId(identity),
    )));
  }

  async storeSeason(media: CatalogMedia, seasonNumber: number, name: string, episodeCount: number | undefined, overview: string | undefined, airDate: string | undefined, posterUrl: string | undefined, episodes: MediaEpisode[]): Promise<void> {
    ensureTrackableSeries(media);
    await this.run("Couldn't save this season's episode information.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        await saveSeason(tx, media, { seasonNumber, name, episodeCount, overview, airDate, posterUrl, episodes });
      });
    });
  }

  async setEpisodeWatched(media: CatalogMedia, season: CatalogSeason, episode: MediaEpisode, watched: boolean): Promise<void> {
    ensureTrackableSeries(media);
    if (watched && !hasAired(episode.airDate)) throw new AppError('catalog', 'This episode hasn’t aired yet.');
    await this.run("Couldn't update this episode. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await ensureSeries(tx, media);
        const summary = media.seasonSummaries?.find((item) => item.seasonNumber === season.seasonNumber);
        await saveSeason(tx, media, { ...season, episodeCount: summary?.episodeCount });
        const now = new Date().toISOString();
        const watchedAt = watched ? now : null;
        const episodeId = episodeRowId(episode.provider, episode.providerId);
        if (watched) {
          await tx.runAsync('UPDATE tracked_episodes SET watched_at = ?, rewatch_count = rewatch_count + CASE WHEN watched_at IS NOT NULL THEN 1 ELSE 0 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?', watchedAt, episodeId);
        } else {
          await tx.runAsync('UPDATE tracked_episodes SET watched_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', episodeId);
          await clearSeriesCompletion(tx, media, now);
        }
        const rewatchCount = (await tx.getFirstAsync<{ rewatch_count: number }>('SELECT rewatch_count FROM tracked_episodes WHERE id = ?', episodeId))?.rewatch_count ?? 0;
        await enqueueSyncChange(tx, { entityType: 'episode', entityKey: `${media.id}:${episode.seasonNumber}:${episode.episodeNumber}`, provider: media.provider, mediaType: media.mediaType, providerId: episode.providerId, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber, deleted: !watched, updatedAt: new Date().toISOString(), media, watchedAt: watchedAt ?? undefined, episode, rewatchCount });
        await tx.runAsync('UPDATE tracked_series SET updated_at = CURRENT_TIMESTAMP WHERE media_id = ?', media.id);
        // Finishing the last episode completes the series and clears the watchlist row.
        if (watched) await syncSeriesCompletion(tx, media, new Date().toISOString());
      });
    });
  }

  async setSeasonWatched(media: CatalogMedia, season: CatalogSeason, watched: boolean): Promise<void> {
    ensureTrackableSeries(media);
    if (!season.episodes.length) throw new AppError('catalog', "Episode information isn't available for this season.");
    // Weekly seasons mix episode data that has aired with future rows the
    // provider already knows about. Only the former can be watched.
    const aired = season.episodes.filter((episode) => hasAired(episode.airDate));
    if (watched && !aired.length) throw new AppError('catalog', 'No episodes of this season have aired yet.');
    await this.run("Couldn't update this season. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await ensureSeries(tx, media);
        const summary = media.seasonSummaries?.find((item) => item.seasonNumber === season.seasonNumber);
        await saveSeason(tx, media, { ...season, episodeCount: summary?.episodeCount });
        const now = new Date().toISOString();
        const before = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND season_number = ?', media.id, season.seasonNumber);
        const previouslyWatched = new Set(before.filter((row) => row.watched_at).map((row) => row.id));
        if (watched) {
          // Repair rows marked by older builds: an episode with a future air
          // date can never have been watched yet.
          const repairedIds = before.filter((row) => row.watched_at && !hasAired(row.air_date ?? undefined)).map((row) => row.id);
          await clearEpisodeRowsWatched(tx, repairedIds);
          const newlyWatchedIds = aired
            .map((episode) => episodeRowId(episode.provider, episode.providerId))
            .filter((id) => !previouslyWatched.has(id));
          await markEpisodeRowsWatched(tx, newlyWatchedIds, now);
        } else {
          await tx.runAsync('UPDATE tracked_episodes SET watched_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE series_id = ? AND season_number = ?', media.id, season.seasonNumber);
          await clearSeriesCompletion(tx, media, now);
        }
        const after = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND season_number = ?', media.id, season.seasonNumber);
        const changes: Omit<PendingWatchStateChange, 'id' | 'retryCount'>[] = [];
        for (const row of after) {
          const isAired = hasAired(row.air_date ?? undefined);
          const wasWatched = previouslyWatched.has(row.id);
          // Only rows whose watched state actually changed need a network
          // change; unchanged rows were already synced (or are still queued).
          if (watched) {
            if (!isAired) {
              if (wasWatched) changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: row.rewatch_count ?? 0 }));
              continue;
            }
            if (wasWatched) continue;
            changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: false, updatedAt: now, watchedAt: row.watched_at ?? now, rewatchCount: row.rewatch_count ?? 0 }));
          } else if (wasWatched) {
            changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: row.rewatch_count ?? 0 }));
          }
        }
        await enqueueSyncChanges(tx, changes);
        await tx.runAsync('UPDATE tracked_series SET updated_at = CURRENT_TIMESTAMP WHERE media_id = ?', media.id);
        // Finishing the last episode completes the series and clears the watchlist row.
        if (watched) await syncSeriesCompletion(tx, media, now);
      });
    });
  }

  async setSeriesWatched(media: CatalogMedia, seasons: { seasonNumber: number; name: string; episodeCount?: number; overview?: string; airDate?: string; posterUrl?: string; episodes: MediaEpisode[] }[], watched: boolean): Promise<void> {
    ensureTrackableSeries(media);
    if (watched && (!seasons.length || seasons.every((season) => !season.episodes.length))) throw new AppError('catalog', "Episode information isn't available for this series.");
    await this.run("Couldn't update this series. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        if (watched || seasons.length) await ensureSeries(tx, media);
        // Cache the provider's full season chain (including announced future
        // episodes) but only write a watch for episodes that have aired.
        for (const season of seasons) await saveSeason(tx, media, season);
        const now = new Date().toISOString();
        const before = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ?', media.id);
        const previouslyWatched = new Set(before.filter((row) => row.watched_at).map((row) => row.id));
        if (watched) {
          // Self-repair: older builds marked whole seasons, including future
          // rows whose release date has not arrived yet.
          const repairedIds = before.filter((row) => row.watched_at && !hasAired(row.air_date ?? undefined)).map((row) => row.id);
          await clearEpisodeRowsWatched(tx, repairedIds);
          const newlyWatchedIds = seasons
            .flatMap((season) => season.episodes)
            .filter((episode) => hasAired(episode.airDate))
            .map((episode) => episodeRowId(episode.provider, episode.providerId))
            .filter((id) => !previouslyWatched.has(id));
          await markEpisodeRowsWatched(tx, newlyWatchedIds, now);
        } else {
          await tx.runAsync('UPDATE tracked_episodes SET watched_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE series_id = ?', media.id);
          // Manual anime counts are a second progress store; clearing a series
          // must reset them too, otherwise "Mark as Watched" can bounce back to
          // Watching on the next read.
          await tx.runAsync('DELETE FROM anime_progress WHERE media_id = ?', media.id);
        }
        const after = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ?', media.id);
        const changes: Omit<PendingWatchStateChange, 'id' | 'retryCount'>[] = [];
        for (const row of after) {
          const isAired = hasAired(row.air_date ?? undefined);
          const wasWatched = previouslyWatched.has(row.id);
          // Only rows whose watched state actually changed need a network
          // change; unchanged rows were already synced (or are still queued).
          if (watched) {
            if (!isAired) {
              if (wasWatched) changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: row.rewatch_count ?? 0 }));
              continue;
            }
            if (wasWatched) continue;
            changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: false, updatedAt: now, watchedAt: row.watched_at ?? now, rewatchCount: row.rewatch_count ?? 0 }));
          } else if (wasWatched) {
            changes.push(episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: row.rewatch_count ?? 0 }));
          }
        }
        await enqueueSyncChanges(tx, changes);
        // Completion follows the same rule as progress reads: every known
        // episode is watched. A weekly show with future episodes stays in
        // Watching even when all currently aired episodes are done.
        const watchedCount = after.filter((row) => row.watched_at).length;
        const total = knownEpisodeTotal(media);
        const completed = Boolean(watched && total && watchedCount >= total);
        await tx.runAsync('UPDATE tracked_series SET updated_at = ?, completed = ?, completed_at = ? WHERE media_id = ?', now, completed ? 1 : 0, completed ? now : null, media.id);
        await enqueueSyncChange(tx, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: completed ? now : undefined, completed });
        // Finished wins over the watchlist: never both at once. A partially
        // watched weekly show legitimately remains on the watchlist too.
        if (completed) await dropWatchlistEntry(tx, media, now);
      });
    });
  }

  async setSeriesComplete(media: CatalogMedia, complete: boolean): Promise<void> {
    if (media.mediaType === 'movie') throw new AppError('validation', 'Series completion is only available for shows and anime.');
    await this.run("Couldn't update this series. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        await tx.runAsync('INSERT INTO tracked_series (media_id, tracking_started_at, updated_at, completed, completed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET updated_at=excluded.updated_at, completed=excluded.completed, completed_at=excluded.completed_at', media.id, now, now, complete ? 1 : 0, complete ? now : null);
        await enqueueSyncChange(tx, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: now, completed: complete });
        // Watched wins over the watchlist: never both at once.
        if (complete) await dropWatchlistEntry(tx, media, now);
      });
    });
  }

  async setAnimeWatchedCount(media: CatalogMedia, count: number): Promise<void> {
    if (media.mediaType !== 'anime') throw new AppError('validation', 'Manual episode counts are only available for anime.');
    const clamped = Math.max(0, Math.floor(count) || 0);
    await this.run("Couldn't update episode progress. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        const total = media.numberOfEpisodes && media.numberOfEpisodes > 0 ? media.numberOfEpisodes : 0;
        const complete = total > 0 && clamped >= total;
        // Keep the series row in step with the manual counter: reaching the
        // total finishes the show, so it leaves Watching and joins Completed.
        await tx.runAsync(
          `INSERT INTO tracked_series (media_id, tracking_started_at, updated_at, completed, completed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(media_id) DO UPDATE SET updated_at=excluded.updated_at, completed=excluded.completed, completed_at=excluded.completed_at`,
          media.id, now, now, complete ? 1 : 0, complete ? now : null,
        );
        await tx.runAsync(
          'INSERT INTO anime_progress (media_id, watched_count, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(media_id) DO UPDATE SET watched_count=excluded.watched_count, updated_at=CURRENT_TIMESTAMP',
          media.id, clamped,
        );
        if (complete) await dropWatchlistEntry(tx, media, now);
      });
    });
  }

  async getAnimeWatchedCount(identity: MediaIdentity): Promise<number> {
    return this.run("Couldn't load episode progress.", async (db) => {
      const row = await db.getFirstAsync<{ watched_count: number }>('SELECT watched_count FROM anime_progress WHERE media_id = ?', mediaId(identity));
      return row?.watched_count ?? 0;
    });
  }

  async getEpisodeWatched(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't load episode status.", async (db) => Boolean(await db.getFirstAsync('SELECT 1 AS found FROM tracked_episodes WHERE provider = ? AND provider_id = ? AND watched_at IS NOT NULL', identity.provider, identity.providerId)));
  }

  async getWatchedEpisodeIds(seriesIdentity: MediaIdentity, seasonNumber: number): Promise<string[]> {
    return this.run("Couldn't load episode status.", async (db) => {
      const rows = await db.getAllAsync<{ provider_id: string }>('SELECT provider_id FROM tracked_episodes WHERE series_id = ? AND season_number = ? AND watched_at IS NOT NULL', mediaId(seriesIdentity), seasonNumber);
      return rows.map((row) => row.provider_id);
    });
  }

  async getWatchedEpisodeSnapshot(identity: MediaIdentity): Promise<WatchedEpisodeSnapshot[]> {
    return this.run("Couldn't load episode progress.", async (db) => {
      const rows = await db.getAllAsync<{
        id: string;
        season_number: number;
        episode_number: number;
        provider_id: string;
        watched_at: string | null;
        rewatch_count: number | null;
      }>(
        `SELECT e.id, e.season_number, e.episode_number, e.provider_id, e.watched_at, e.rewatch_count
         FROM tracked_episodes e
         JOIN tracked_media m ON m.id = e.series_id
         WHERE m.provider = ? AND m.media_type = ? AND m.provider_id = ?
           AND e.watched_at IS NOT NULL
         ORDER BY e.season_number, e.episode_number`,
        identity.provider, identity.mediaType, identity.providerId,
      );
      return rows.filter((row) => typeof row.watched_at === 'string').map((row) => ({
        id: row.id,
        seasonNumber: row.season_number,
        episodeNumber: row.episode_number,
        providerId: row.provider_id,
        watchedAt: row.watched_at as string,
        rewatchCount: Math.max(0, row.rewatch_count ?? 0),
      }));
    });
  }

  async restoreWatchedEpisodes(media: CatalogMedia, snapshot: WatchedEpisodeSnapshot[]): Promise<void> {
    ensureTrackableSeries(media);
    if (!snapshot.length) return;
    await this.run("Couldn't restore episode progress.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await ensureSeries(tx, media);
        for (const episode of snapshot) {
          await tx.runAsync(
            'UPDATE tracked_episodes SET watched_at = ?, rewatch_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND series_id = ?',
            episode.watchedAt, episode.rewatchCount, episode.id, media.id,
          );
        }
        const now = new Date().toISOString();
        const rows = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND watched_at IS NOT NULL ORDER BY season_number, episode_number', media.id);
        await enqueueSyncChanges(tx, rows.map((row) => episodeSyncChange(media, mapEpisode(row), { deleted: false, updatedAt: now, watchedAt: row.watched_at ?? undefined, rewatchCount: row.rewatch_count ?? 0 })));
        // Recompute completion, but never remove a still-in-progress watchlist row.
        await syncSeriesCompletion(tx, media, now);
        await tx.runAsync('UPDATE tracked_series SET updated_at = CURRENT_TIMESTAMP WHERE media_id = ?', media.id);
      });
    });
  }

  /**
   * Startup repair for libraries written before weekly seasons were handled:
   * "mark whole season/series" used to tick future episodes too. Clears those
   * watches, refreshes the series completion flag, and queues tombstones so a
   * sync cannot bring them back. Idempotent — a clean library returns 0.
   */
  async repairUnairedEpisodeWatches(): Promise<number> {
    return this.run("Couldn't repair episode progress.", async (db) => {
      const watched = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE watched_at IS NOT NULL');
      const unaired = watched.filter((row) => !hasAired(row.air_date ?? undefined));
      if (!unaired.length) return 0;
      const groups = new Map<string, EpisodeRow[]>();
      for (const row of unaired) {
        const group = groups.get(row.series_id);
        if (group) group.push(row);
        else groups.set(row.series_id, [row]);
      }
      await db.withExclusiveTransactionAsync(async (tx) => {
        const now = new Date().toISOString();
        for (const [seriesId, episodes] of groups) {
          const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', seriesId);
          if (!mediaRow) continue;
          const media = mapMedia(mediaRow);
          await clearEpisodeRowsWatched(tx, episodes.map((row) => row.id));
          await enqueueSyncChanges(tx, episodes.map((row) => episodeSyncChange(media, mapEpisode(row), { deleted: true, updatedAt: now, rewatchCount: 0 })));
          const counts = await tx.getFirstAsync<{ watched: number }>('SELECT COUNT(*) AS watched FROM tracked_episodes WHERE series_id = ? AND watched_at IS NOT NULL', seriesId);
          const total = knownEpisodeTotal(media);
          const completed = Boolean(total && (counts?.watched ?? 0) >= total);
          const tracked = await tx.getFirstAsync<{ completed: number | null }>('SELECT completed FROM tracked_series WHERE media_id = ?', seriesId);
          if (tracked && (tracked.completed === 1) !== completed) {
            await tx.runAsync('UPDATE tracked_series SET updated_at = ?, completed = ?, completed_at = ? WHERE media_id = ?', now, completed ? 1 : 0, completed ? now : null, seriesId);
            await enqueueSyncChange(tx, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: completed ? now : undefined, completed });
            if (completed) await dropWatchlistEntry(tx, media, now);
          }
        }
      });
      return unaired.length;
    });
  }

  async getUpcomingEpisodes(horizonDays = 14): Promise<UpcomingEpisode[]> {
    return this.run("Couldn't load upcoming episodes.", async (db) => {
      const horizon = Math.max(1, Math.min(90, Math.floor(horizonDays)));
      const today = new Date();
      const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const endDate = new Date(today.getTime() + horizon * 24 * 60 * 60 * 1000);
      const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      const rows = await db.getAllAsync<EpisodeRow & { series_title: string }>(
        `SELECT e.*, m.title AS series_title FROM tracked_episodes e
         JOIN tracked_media m ON m.id = e.series_id
         JOIN tracked_series t ON t.media_id = e.series_id
         WHERE e.watched_at IS NULL AND e.air_date IS NOT NULL
           AND substr(e.air_date, 1, 10) >= ? AND substr(e.air_date, 1, 10) <= ?
         ORDER BY e.air_date ASC, e.season_number ASC, e.episode_number ASC LIMIT 100`,
        start, end,
      );
      const seriesIds = [...new Set(rows.map((row) => row.series_id))];
      const parents = new Map<string, MediaRow>();
      if (seriesIds.length) {
        const placeholders = seriesIds.map(() => '?').join(', ');
        for (const row of await db.getAllAsync<MediaRow>(`SELECT * FROM tracked_media WHERE id IN (${placeholders})`, ...seriesIds)) parents.set(row.id, row);
      }
      return rows.flatMap((row) => {
        const parent = parents.get(row.series_id);
        if (!parent || !row.air_date) return [];
        return [{ media: mapMedia(parent), episode: mapEpisode(row), airDate: row.air_date.slice(0, 10) }];
      });
    });
  }

  async getSeriesProgress(): Promise<SeriesProgress[]> {
    return this.run("Couldn't load series progress.", async (db) => {
      const series = await db.getAllAsync<SeriesRow>(
        `SELECT m.*, t.completed AS completed, t.completed_at AS completed_at, ap.watched_count AS anime_watched_count, ap.updated_at AS anime_watched_at,
          (SELECT MAX(e.watched_at) FROM tracked_episodes e WHERE e.series_id = m.id) AS watched_at,
          (SELECT COUNT(*) FROM tracked_episodes e WHERE e.series_id = m.id AND e.watched_at IS NOT NULL) AS watched_count,
          (SELECT COUNT(*) FROM tracked_episodes e WHERE e.series_id = m.id) AS cached_count
         FROM tracked_series t JOIN tracked_media m ON m.id = t.media_id
         LEFT JOIN anime_progress ap ON ap.media_id = m.id
         ORDER BY t.updated_at DESC, m.title COLLATE NOCASE`,
      );
      const episodes = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes ORDER BY season_number, episode_number');
      return series.map((row) => toProgress(row, episodes.filter((episode) => episode.series_id === row.id)));
    });
  }

  async getContinueWatching(): Promise<ContinueWatchingItem[]> {
    return (await this.getSeriesProgress()).filter((item) =>
      item.watchedEpisodeCount > 0
      && !item.isComplete
      && Boolean(item.nextEpisode || item.nextSeasonNumber || item.media.mediaType === 'anime'),
    );
  }

  async getWatchedLibrary(): Promise<WatchedLibraryItem[]> {
    return this.run("Couldn't load watched titles.", async (db) => {
      const movies = await db.getAllAsync<MediaRow & { watched_at: string }>('SELECT m.*, w.watched_at FROM movie_watches w JOIN tracked_media m ON m.id = w.media_id ORDER BY w.watched_at DESC, m.title COLLATE NOCASE');
      const seriesRows = await db.getAllAsync<SeriesRow>(
        `SELECT m.*, ap.watched_count AS anime_watched_count,
          (SELECT MAX(e.watched_at) FROM tracked_episodes e WHERE e.series_id = m.id) AS watched_at,
          t.completed AS completed, t.completed_at AS completed_at,
          (SELECT COUNT(*) FROM tracked_episodes e WHERE e.series_id = m.id AND e.watched_at IS NOT NULL) AS watched_count,
          (SELECT COUNT(*) FROM tracked_episodes e WHERE e.series_id = m.id) AS cached_count
         FROM tracked_media m
         JOIN tracked_series t ON t.media_id = m.id
         LEFT JOIN anime_progress ap ON ap.media_id = m.id
         WHERE t.completed = 1 OR EXISTS (SELECT 1 FROM tracked_episodes e WHERE e.series_id = m.id AND e.watched_at IS NOT NULL)
         ORDER BY m.updated_at DESC, m.title COLLATE NOCASE`,
      );
      const episodes = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes ORDER BY season_number, episode_number');
      // Only finished titles live here; in-progress shows stay in the watchlist
      // (or Continue Watching), so Watchlist and Watched never overlap.
      const series = seriesRows
        .map((row) => toProgress(row, episodes.filter((episode) => episode.series_id === row.id)))
        .filter((progress) => progress.isComplete);
      return [
        ...movies.map((row): WatchedLibraryItem => ({ kind: 'movie', media: mapMedia(row), watchedAt: row.watched_at })),
        ...series.map((progress): WatchedLibraryItem => ({ kind: 'series', progress })),
      ].sort((a, b) => {
        const dateA = a.kind === 'movie' ? a.watchedAt : a.progress.lastWatchedAt ?? '';
        const dateB = b.kind === 'movie' ? b.watchedAt : b.progress.lastWatchedAt ?? '';
        return dateB.localeCompare(dateA);
      });
    });
  }

  async setFavorite(media: CatalogMedia, favorite: boolean): Promise<void> {
    await this.run("Couldn't update your favorites. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        if (favorite) await tx.runAsync('INSERT INTO favorite_entries (media_id, favorited_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET favorited_at=COALESCE(favorited_at, excluded.favorited_at), updated_at=excluded.updated_at', media.id, now, now);
        else {
          const prior = await tx.getFirstAsync<{ favorited_at: string }>('SELECT favorited_at FROM favorite_entries WHERE media_id = ?', media.id);
          if (prior) await trashSnapshot(tx, 'favorite', { media, favoritedAt: prior.favorited_at });
          await tx.runAsync('DELETE FROM favorite_entries WHERE media_id = ?', media.id);
        }
        await enqueueSyncChange(tx, { entityType: 'favorite', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: !favorite, updatedAt: now, media, watchedAt: favorite ? now : undefined });
        if (!favorite) await this.pruneMedia(tx, media.id);
      });
    });
  }

  async isFavorite(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't load favorite status.", async (db) => Boolean(await db.getFirstAsync('SELECT 1 AS found FROM favorite_entries WHERE media_id = ?', mediaId(identity))));
  }

  async getFavorites(): Promise<FavoriteEntry[]> {
    return this.run("Couldn't load your favorites.", async (db) => {
      const rows = await db.getAllAsync<MediaRow & { favorited_at: string }>('SELECT m.*, f.favorited_at FROM favorite_entries f JOIN tracked_media m ON m.id = f.media_id ORDER BY f.favorited_at DESC, m.title COLLATE NOCASE');
      return rows.map((row) => ({ media: mapMedia(row), favoritedAt: row.favorited_at }));
    });
  }

  async setInterested(media: CatalogMedia, interested: boolean): Promise<void> {
    await this.run("Couldn't update your interested marks. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        if (interested) await tx.runAsync('INSERT INTO interested_entries (media_id, marked_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET marked_at=COALESCE(marked_at, excluded.marked_at), updated_at=excluded.updated_at', media.id, now, now);
        else await tx.runAsync('DELETE FROM interested_entries WHERE media_id = ?', media.id);
        await enqueueSyncChange(tx, { entityType: 'interested', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: !interested, updatedAt: now, media, watchedAt: interested ? now : undefined });
        if (!interested) await this.pruneMedia(tx, media.id);
      });
    });
  }

  async isInterested(identity: MediaIdentity): Promise<boolean> {
    return this.run("Couldn't load interested status.", async (db) => Boolean(await db.getFirstAsync('SELECT 1 AS found FROM interested_entries WHERE media_id = ?', mediaId(identity))));
  }

  async getInterested(): Promise<InterestedEntry[]> {
    return this.run("Couldn't load your interested titles.", async (db) => {
      const rows = await db.getAllAsync<MediaRow & { marked_at: string }>('SELECT m.*, i.marked_at FROM interested_entries i JOIN tracked_media m ON m.id = i.media_id ORDER BY i.marked_at DESC, m.title COLLATE NOCASE');
      return rows.map((row) => ({ media: mapMedia(row), markedAt: row.marked_at }));
    });
  }

  async createCustomList(name: string): Promise<CustomListSummary> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('validation', 'Give your list a name.');
    if (trimmed.length > 80) throw new AppError('validation', 'Keep list names under 80 characters.');
    return this.run("Couldn't create your list. Try again.", async (db) => {
      const id = `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const now = new Date().toISOString();
      await db.runAsync('INSERT INTO custom_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, trimmed, now, now);
      return { id, name: trimmed, icon: null, color: null, folderId: null, createdAt: now, updatedAt: now, itemCount: 0 };
    });
  }

  async updateCustomList(id: string, patch: { name?: string; icon?: string | null; color?: string | null; folderId?: string | null }): Promise<void> {
    const trimmed = patch.name?.trim();
    if (trimmed !== undefined && !trimmed) throw new AppError('validation', 'Give your list a name.');
    if (trimmed !== undefined && trimmed.length > 80) throw new AppError('validation', 'Keep list names under 80 characters.');
    await this.run("Couldn't update your list. Try again.", async (db) => {
      if (patch.folderId !== undefined && patch.folderId !== null) {
        const folder = await db.getFirstAsync('SELECT id FROM list_folders WHERE id = ?', patch.folderId);
        if (!folder) throw new AppError('validation', 'This folder no longer exists.');
      }
      const sets: string[] = [];
      const params: (string | null)[] = [];
      if (trimmed !== undefined) { sets.push('name = ?'); params.push(trimmed); }
      if (patch.icon !== undefined) { sets.push('icon = ?'); params.push(patch.icon); }
      if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
      if (patch.folderId !== undefined) { sets.push('folder_id = ?'); params.push(patch.folderId); }
      if (!sets.length) return;
      await db.runAsync(`UPDATE custom_lists SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...params, id);
    });
  }

  async deleteCustomList(id: string): Promise<void> {
    await this.run("Couldn't delete your list. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const detail = await this.readCustomList(tx, id);
        if (detail) await trashSnapshot(tx, 'list', { listSnapshot: detail });
        await tx.runAsync('DELETE FROM custom_lists WHERE id = ?', id);
      });
    });
  }

  private async readCustomList(db: SQLiteDatabase, id: string): Promise<CustomListDetail | undefined> {
    const list = await db.getFirstAsync<{ id: string; name: string; icon: string | null; color: string | null; folder_id: string | null; created_at: string; updated_at: string }>('SELECT * FROM custom_lists WHERE id = ?', id);
    if (!list) return undefined;
    const rows = await db.getAllAsync<MediaRow & { added_at: string; position: number | null }>('SELECT m.*, i.added_at, i.position FROM custom_list_items i JOIN tracked_media m ON m.id = i.media_id WHERE i.list_id = ? ORDER BY i.position ASC, i.added_at DESC, m.title COLLATE NOCASE', id);
    return { id: list.id, name: list.name, icon: list.icon, color: list.color, folderId: list.folder_id, createdAt: list.created_at, updatedAt: list.updated_at, items: rows.map((row) => ({ media: mapMedia(row), addedAt: row.added_at, position: row.position ?? 0 })) };
  }

  async getCustomLists(folderId?: string | null): Promise<CustomListSummary[]> {
    return this.run("Couldn't load your lists.", async (db) => {
      const where = folderId === undefined ? '' : folderId === null ? 'WHERE l.folder_id IS NULL' : 'WHERE l.folder_id = ?';
      const rows = await db.getAllAsync<{ id: string; name: string; icon: string | null; color: string | null; folder_id: string | null; created_at: string; updated_at: string; item_count: number }>(
        `SELECT l.id, l.name, l.icon, l.color, l.folder_id, l.created_at, l.updated_at, (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = l.id) AS item_count
         FROM custom_lists l ${where} ORDER BY l.updated_at DESC, l.name COLLATE NOCASE`,
        ...(folderId === undefined || folderId === null ? [] : [folderId]),
      );
      return rows.map((row) => ({ id: row.id, name: row.name, icon: row.icon, color: row.color, folderId: row.folder_id, createdAt: row.created_at, updatedAt: row.updated_at, itemCount: row.item_count }));
    });
  }

  async getCustomList(id: string): Promise<CustomListDetail | undefined> {
    return this.run("Couldn't load this list.", async (db) => this.readCustomList(db, id));
  }

  async addToCustomList(listId: string, media: CatalogMedia): Promise<boolean> {
    return this.run("Couldn't add to your list. Try again.", async (db) => {
      let inserted = false;
      await db.withExclusiveTransactionAsync(async (tx) => {
        const list = await tx.getFirstAsync('SELECT id FROM custom_lists WHERE id = ?', listId);
        if (!list) throw new AppError('validation', 'This list no longer exists.');
        await saveMedia(tx, media);
        const position = (await tx.getFirstAsync<{ position: number | null }>('SELECT COALESCE(MIN(position), 0) - 1 AS position FROM custom_list_items WHERE list_id = ?', listId))?.position ?? -1;
        const result = await tx.runAsync('INSERT INTO custom_list_items (list_id, media_id, position) VALUES (?, ?, ?) ON CONFLICT(list_id, media_id) DO NOTHING', listId, media.id, position);
        inserted = (result.changes ?? 0) > 0;
        await tx.runAsync('UPDATE custom_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', listId);
      });
      return inserted;
    });
  }

  async removeFromCustomList(listId: string, identity: MediaIdentity): Promise<void> {
    await this.run("Couldn't update your list. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const id = mediaId(identity);
        const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', id);
        if (mediaRow) await trashSnapshot(tx, 'list_item', { media: mapMedia(mediaRow), originListId: listId });
        await tx.runAsync('DELETE FROM custom_list_items WHERE list_id = ? AND media_id = ?', listId, id);
        await tx.runAsync('UPDATE custom_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', listId);
        await this.pruneMedia(tx, id);
      });
    });
  }

  async moveCustomListItem(listId: string, identity: MediaIdentity, direction: -1 | 1): Promise<boolean> {
    return this.run("Couldn't reorder your list. Try again.", async (db) => {
      const id = mediaId(identity);
      const rows = await db.getAllAsync<{ media_id: string; position: number }>('SELECT media_id, position FROM custom_list_items WHERE list_id = ? ORDER BY position ASC, added_at DESC', listId);
      const index = rows.findIndex((row) => row.media_id === id);
      const neighbor = rows[index + direction];
      if (index < 0 || !neighbor) return false;
      const current = rows[index];
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync('UPDATE custom_list_items SET position = ? WHERE list_id = ? AND media_id = ?', neighbor.position, listId, current.media_id);
        await tx.runAsync('UPDATE custom_list_items SET position = ? WHERE list_id = ? AND media_id = ?', current.position, listId, neighbor.media_id);
        await tx.runAsync('UPDATE custom_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', listId);
      });
      return true;
    });
  }

  async createFolder(name: string): Promise<ListFolder> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('validation', 'Give your folder a name.');
    if (trimmed.length > 40) throw new AppError('validation', 'Keep folder names under 40 characters.');
    return this.run("Couldn't create your folder. Try again.", async (db) => {
      const id = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const now = new Date().toISOString();
      await db.runAsync('INSERT INTO list_folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, trimmed, now, now);
      return { id, name: trimmed, createdAt: now, updatedAt: now };
    });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.run("Couldn't delete your folder. Try again.", async (db) => {
      await db.runAsync('DELETE FROM list_folders WHERE id = ?', id);
    });
  }

  async getFolders(): Promise<ListFolder[]> {
    return this.run("Couldn't load your folders.", async (db) => {
      const rows = await db.getAllAsync<{ id: string; name: string; created_at: string; updated_at: string }>('SELECT * FROM list_folders ORDER BY name COLLATE NOCASE');
      return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }));
    });
  }

  async getTrash(): Promise<TrashItem[]> {
    return this.run("Couldn't load removed items.", async (db) => {
      await purgeExpiredTrash(db);
      const rows = await db.getAllAsync<{ id: number; kind: TrashItem['kind']; media_json: string | null; list_snapshot: string | null; origin_list_id: string | null; watched_at: string | null; favorited_at: string | null; deleted_at: string }>('SELECT * FROM deleted_items ORDER BY deleted_at DESC');
      return rows.flatMap((row) => {
        try {
          const media = row.media_json ? (JSON.parse(row.media_json) as CatalogMedia) : null;
          const listSnapshot = row.list_snapshot ? (JSON.parse(row.list_snapshot) as CustomListDetail) : null;
          if (!media?.id && !listSnapshot) return [];
          return [{ id: row.id, kind: row.kind, label: listSnapshot?.name ?? media?.title ?? row.kind, media, listSnapshot, originListId: row.origin_list_id, watchedAt: row.watched_at, favoritedAt: row.favorited_at, deletedAt: row.deleted_at }];
        } catch { return []; }
      });
    });
  }

  async restoreTrashItem(id: number): Promise<void> {
    await this.run("Couldn't restore this item. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const row = await tx.getFirstAsync<{ kind: TrashItem['kind']; media_json: string | null; list_snapshot: string | null; origin_list_id: string | null; watched_at: string | null; favorited_at: string | null }>('SELECT * FROM deleted_items WHERE id = ?', id);
        if (!row) throw new AppError('validation', 'This item is no longer in Recently removed.');
        const now = new Date().toISOString();
        const media = row.media_json ? (JSON.parse(row.media_json) as CatalogMedia) : null;
        if (row.kind === 'list' && row.list_snapshot) {
          const snapshot = JSON.parse(row.list_snapshot) as CustomListDetail;
          await tx.runAsync('INSERT INTO custom_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at', snapshot.id, snapshot.name, snapshot.createdAt, now);
          for (const item of snapshot.items) {
            await saveMedia(tx, item.media);
            await tx.runAsync('INSERT INTO custom_list_items (list_id, media_id) VALUES (?, ?) ON CONFLICT(list_id, media_id) DO NOTHING', snapshot.id, item.media.id);
          }
        } else if (media) {
          await saveMedia(tx, media);
          if (row.kind === 'watchlist') {
            // Restoring to the watchlist wins over watched, same as saving.
            await clearWatchedForWatchlist(tx, media, now);
            const position = (await tx.getFirstAsync<{ position: number | null }>('SELECT COALESCE(MIN(position), 0) - 1 AS position FROM watchlist_entries'))?.position ?? -1;
            await tx.runAsync('INSERT INTO watchlist_entries (media_id, position) VALUES (?, ?) ON CONFLICT(media_id) DO NOTHING', media.id, position);
            await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, position });
          } else if (row.kind === 'movie') {
            await tx.runAsync('INSERT INTO movie_watches (media_id, watched_at, rewatch_count) VALUES (?, ?, 0) ON CONFLICT(media_id) DO UPDATE SET watched_at=excluded.watched_at', media.id, row.watched_at ?? now);
            await enqueueSyncChange(tx, { entityType: 'movie', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: row.watched_at ?? now });
          } else if (row.kind === 'series') {
            await tx.runAsync('INSERT INTO tracked_series (media_id) VALUES (?) ON CONFLICT(media_id) DO NOTHING', media.id);
            await enqueueSyncChange(tx, { entityType: 'series', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media });
          } else if (row.kind === 'favorite') {
            await tx.runAsync('INSERT INTO favorite_entries (media_id, favorited_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(media_id) DO NOTHING', media.id, row.favorited_at ?? now, now);
            await enqueueSyncChange(tx, { entityType: 'favorite', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, watchedAt: row.favorited_at ?? now });
          } else if (row.kind === 'list_item' && row.origin_list_id) {
            await tx.runAsync('INSERT INTO custom_list_items (list_id, media_id) VALUES (?, ?) ON CONFLICT(list_id, media_id) DO NOTHING', row.origin_list_id, media.id);
          }
        }
        await tx.runAsync('DELETE FROM deleted_items WHERE id = ?', id);
      });
    });
  }

  async clearTrash(): Promise<void> {
    await this.run("Couldn't empty Recently removed. Try again.", async (db) => {
      await db.runAsync('DELETE FROM deleted_items');
    });
  }

  async createCustomEntry(input: { title: string; year?: number; mediaType: CatalogMedia['mediaType']; notes?: string }): Promise<CatalogMedia> {
    const title = input.title.trim();
    if (!title) throw new AppError('validation', 'Give your entry a title.');
    if (title.length > 120) throw new AppError('validation', 'Keep titles under 120 characters.');
    return this.run("Couldn't create your entry. Try again.", async (db) => {
      const providerId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const identity = { provider: 'tmdb', mediaType: input.mediaType, providerId } as const;
      const releaseDate = input.year ? String(input.year) : undefined;
      const media: CatalogMedia = {
        ...identity, id: mediaId(identity), title, overview: input.notes?.trim() || undefined,
        releaseDate, year: input.year, genres: [], episodeMetadata: 'unavailable',
      };
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        await tx.runAsync('INSERT INTO watchlist_entries (media_id, position) VALUES (?, (SELECT COALESCE(MIN(position), 0) - 1 FROM watchlist_entries)) ON CONFLICT(media_id) DO NOTHING', media.id);
        const position = (await tx.getFirstAsync<{ position: number | null }>('SELECT position FROM watchlist_entries WHERE media_id = ?', media.id))?.position ?? 0;
        await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: new Date().toISOString(), media, position });
      });
      return media;
    });
  }

  async getViewingHistory(limit = 50): Promise<HistoryItem[]> {
    const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    return this.run("Couldn't load your history.", async (db) => {
      const movies = await db.getAllAsync<MediaRow & { watched_at: string }>('SELECT m.*, w.watched_at FROM movie_watches w JOIN tracked_media m ON m.id = w.media_id ORDER BY w.watched_at DESC LIMIT ?', bounded);
      const episodes = await db.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE watched_at IS NOT NULL ORDER BY watched_at DESC LIMIT ?', bounded);
      const seriesIds = [...new Set(episodes.map((episode) => episode.series_id))];
      const parents = new Map<string, MediaRow>();
      if (seriesIds.length) {
        const placeholders = seriesIds.map(() => '?').join(', ');
        for (const row of await db.getAllAsync<MediaRow>(`SELECT * FROM tracked_media WHERE id IN (${placeholders})`, ...seriesIds)) parents.set(row.id, row);
      }
      const items: HistoryItem[] = [
        ...movies.map((row): HistoryItem => ({ kind: 'movie', media: mapMedia(row), watchedAt: row.watched_at })),
        ...episodes.flatMap((row): HistoryItem[] => {
          const parent = parents.get(row.series_id);
          if (!parent) return [];
          return [{ kind: 'episode', media: mapMedia(parent), episode: mapEpisode(row), watchedAt: row.watched_at ?? '' }];
        }),
      ];
      return items.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt)).slice(0, bounded);
    });
  }

  /**
   * Marks every cached episode of a season at or before the given episode number
   * as watched. Episodes keep their first-watched timestamp; already-watched
   * ones count as rewatches.
   */
  async markEpisodesUpTo(media: CatalogMedia, season: CatalogSeason, episodeNumber: number): Promise<void> {
    ensureTrackableSeries(media);
    if (!Number.isSafeInteger(season.seasonNumber) || season.seasonNumber < 0 || !Number.isSafeInteger(episodeNumber) || episodeNumber < 1) {
      throw new AppError('validation', 'Enter a valid season and episode number.');
    }
    await this.run("Couldn't update these episodes. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await ensureSeries(tx, media);
        const summary = media.seasonSummaries?.find((item) => item.seasonNumber === season.seasonNumber);
        await saveSeason(tx, media, { ...season, episodeCount: summary?.episodeCount });
        const now = new Date().toISOString();
        const rows = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND season_number = ? AND episode_number <= ? ORDER BY episode_number', media.id, season.seasonNumber, episodeNumber);
        // Defense in depth: even a caller that passes a future position must
        // never write a watch onto an episode that has not aired.
        const airedRows = rows.filter((row) => hasAired(row.air_date ?? undefined));
        await markEpisodeRowsWatched(tx, airedRows.map((row) => row.id), now);
        const after = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE series_id = ? AND season_number = ? AND episode_number <= ? ORDER BY episode_number', media.id, season.seasonNumber, episodeNumber);
        await enqueueSyncChanges(tx, after.filter((row) => hasAired(row.air_date ?? undefined)).map((row) => episodeSyncChange(media, mapEpisode(row), { deleted: false, updatedAt: now, watchedAt: row.watched_at ?? undefined, rewatchCount: row.rewatch_count ?? 0 })));
        await tx.runAsync('UPDATE tracked_series SET updated_at = CURRENT_TIMESTAMP WHERE media_id = ?', media.id);
        // Finishing the last episode completes the series and clears the watchlist row.
        await syncSeriesCompletion(tx, media, now);
      });
    });
  }

  async setUserRating(media: CatalogMedia, rating: number | null, thumbs: -1 | 0 | 1): Promise<void> {
    if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 10)) throw new AppError('validation', 'Ratings use a 0 to 10 scale.');
    if (rating === null && thumbs === 0) return this.clearUserRating(media);
    await this.run("Couldn't save your rating. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await saveMedia(tx, media);
        const now = new Date().toISOString();
        await tx.runAsync(
          'INSERT INTO user_ratings (media_id, rating, thumbs, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating, thumbs=excluded.thumbs, updated_at=excluded.updated_at',
          media.id, rating, thumbs, now,
        );
        await enqueueSyncChange(tx, { entityType: 'rating', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: now, media, rating, thumbs });
      });
    });
  }

  async clearUserRating(media: CatalogMedia): Promise<void> {
    await this.run("Couldn't remove your rating. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', media.id);
        if (!mediaRow) return;
        await tx.runAsync('DELETE FROM user_ratings WHERE media_id = ?', media.id);
        await enqueueSyncChange(tx, { entityType: 'rating', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: true, updatedAt: new Date().toISOString(), media: mapMedia(mediaRow), rating: null, thumbs: 0 });
        await this.pruneMedia(tx, media.id);
      });
    });
  }

  async getUserRating(identity: MediaIdentity): Promise<UserRating | undefined> {
    return this.run("Couldn't load your rating.", async (db) => {
      const row = await db.getFirstAsync<MediaRow & { rating_value: number | null; thumbs: number; rated_at: string }>(
        'SELECT m.*, r.rating AS rating_value, r.thumbs, r.updated_at AS rated_at FROM user_ratings r JOIN tracked_media m ON m.id = r.media_id WHERE r.media_id = ?', mediaId(identity),
      );
      if (!row) return undefined;
      return { media: mapMedia(row), rating: row.rating_value, thumbs: row.thumbs === 1 ? 1 : row.thumbs === -1 ? -1 : 0, updatedAt: row.rated_at };
    });
  }

  async getUserRatings(): Promise<UserRating[]> {
    return this.run("Couldn't load your ratings.", async (db) => {
      const rows = await db.getAllAsync<MediaRow & { rating_value: number | null; thumbs: number; rated_at: string }>(
        'SELECT m.*, r.rating AS rating_value, r.thumbs, r.updated_at AS rated_at FROM user_ratings r JOIN tracked_media m ON m.id = r.media_id ORDER BY r.updated_at DESC',
      );
      return rows.map((row) => ({ media: mapMedia(row), rating: row.rating_value, thumbs: row.thumbs === 1 ? 1 : row.thumbs === -1 ? -1 : 0, updatedAt: row.rated_at }));
    });
  }

  async clearAllRatings(): Promise<void> {
    await this.run("Couldn't reset your ratings. Try again.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const rows = await tx.getAllAsync<MediaRow>('SELECT m.* FROM user_ratings r JOIN tracked_media m ON m.id = r.media_id');
        const now = new Date().toISOString();
        for (const row of rows) {
          const media = mapMedia(row);
          await enqueueSyncChange(tx, { entityType: 'rating', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: true, updatedAt: now, media, rating: null, thumbs: 0 });
        }
        await tx.runAsync('DELETE FROM user_ratings');
        for (const row of rows) await this.pruneMedia(tx, row.id);
      });
    });
  }

  async getPendingChanges(): Promise<PendingWatchStateChange[]> {
    return this.run("Couldn't load pending sync changes.", async (db) => {
      const rows = await db.getAllAsync<{ id: number; entity_type: PendingWatchStateChange['entityType']; entity_key: string; provider: PendingWatchStateChange['provider']; media_type: PendingWatchStateChange['mediaType']; provider_id: string; season_number: number | null; episode_number: number | null; is_deleted: number; updated_at: string; payload: string; retry_count: number; rewatch_count: number | null; position: number | null }>('SELECT * FROM sync_queue ORDER BY updated_at, id');
      return rows.flatMap((row) => {
        try {
          const payload = JSON.parse(row.payload) as { media: CatalogMedia; watchedAt?: string; episode?: MediaEpisode; completed?: boolean; priority?: WatchPriority | null };
          if (!payload.media?.id) return [];
          return [{ id: row.id, entityType: row.entity_type, entityKey: row.entity_key, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, seasonNumber: row.season_number ?? undefined, episodeNumber: row.episode_number ?? undefined, deleted: row.is_deleted === 1, updatedAt: row.updated_at, media: payload.media, watchedAt: payload.watchedAt, episode: payload.episode, completed: payload.completed, priority: isWatchPriority(payload.priority) ? payload.priority : undefined, rewatchCount: row.rewatch_count ?? 0, position: row.position ?? 0, retryCount: row.retry_count }];
        } catch { return []; }
      });
    });
  }

  async applyRemoteChanges(changes: PendingWatchStateChange[]): Promise<void> {
    await this.run("Couldn't merge your synced library.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const touchedSeries = new Set<string>();
        for (const change of changes) {
          await saveMedia(tx, change.media);
          if (change.entityType === 'watchlist') {
            if (change.deleted) await tx.runAsync('DELETE FROM watchlist_entries WHERE media_id = ?', change.media.id);
            else if (await isWatchedId(tx, change.media.id)) {
              // Watched wins: a finished title never re-enters the watchlist through sync.
              await tx.runAsync('DELETE FROM watchlist_entries WHERE media_id = ?', change.media.id);
            } else {
              await tx.runAsync('INSERT INTO watchlist_entries (media_id, added_at, position, priority) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO NOTHING', change.media.id, change.updatedAt, change.position ?? 0, change.priority ?? null);
              await tx.runAsync('UPDATE watchlist_entries SET added_at = ?, position = ?, priority = COALESCE(?, priority) WHERE media_id = ?', change.updatedAt, change.position ?? 0, change.priority ?? null, change.media.id);
            }
          } else if (change.entityType === 'movie') {
            if (change.deleted) await tx.runAsync('DELETE FROM movie_watches WHERE media_id = ?', change.media.id);
            else {
              await tx.runAsync('INSERT INTO movie_watches (media_id, watched_at, rewatch_count) VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET watched_at=excluded.watched_at, rewatch_count=excluded.rewatch_count', change.media.id, change.watchedAt ?? change.updatedAt, change.rewatchCount ?? 0);
              await dropWatchlistEntry(tx, change.media, change.updatedAt);
            }
          } else if (change.entityType === 'series') {
            if (change.deleted) await tx.runAsync('DELETE FROM tracked_series WHERE media_id = ?', change.media.id);
            else {
              await tx.runAsync('INSERT INTO tracked_series (media_id, tracking_started_at) VALUES (?, ?) ON CONFLICT(media_id) DO NOTHING', change.media.id, change.updatedAt);
              if (change.completed === undefined) await tx.runAsync('UPDATE tracked_series SET updated_at = ? WHERE media_id = ?', change.updatedAt, change.media.id);
              else {
                await tx.runAsync('UPDATE tracked_series SET updated_at = ?, completed = ?, completed_at = ? WHERE media_id = ?', change.updatedAt, change.completed ? 1 : 0, change.completed ? change.updatedAt : null, change.media.id);
                if (change.completed) await dropWatchlistEntry(tx, change.media, change.updatedAt);
              }
            }
          } else if (change.entityType === 'favorite') {
            if (change.deleted) await tx.runAsync('DELETE FROM favorite_entries WHERE media_id = ?', change.media.id);
            else await tx.runAsync('INSERT INTO favorite_entries (media_id, favorited_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET updated_at=excluded.updated_at', change.media.id, change.watchedAt ?? change.updatedAt, change.updatedAt);
          } else if (change.entityType === 'interested') {
            if (change.deleted) await tx.runAsync('DELETE FROM interested_entries WHERE media_id = ?', change.media.id);
            else await tx.runAsync('INSERT INTO interested_entries (media_id, marked_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET updated_at=excluded.updated_at', change.media.id, change.watchedAt ?? change.updatedAt, change.updatedAt);
          } else if (change.entityType === 'rating') {
            if (change.deleted) await tx.runAsync('DELETE FROM user_ratings WHERE media_id = ?', change.media.id);
            else await tx.runAsync('INSERT INTO user_ratings (media_id, rating, thumbs, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating, thumbs=excluded.thumbs, updated_at=excluded.updated_at', change.media.id, change.rating ?? null, change.thumbs ?? 0, change.updatedAt);
          } else if (change.episode) {
            await saveMedia(tx, change.media);
            await saveEpisode(tx, change.media, change.episode);
            await tx.runAsync('UPDATE tracked_episodes SET watched_at = ?, rewatch_count = ?, updated_at = ? WHERE id = ?', change.deleted ? null : change.watchedAt ?? change.updatedAt, change.rewatchCount ?? 0, change.updatedAt, episodeRowId(change.episode.provider, change.episode.providerId));
            if (!change.deleted) touchedSeries.add(change.media.id);
          }
        }
        // Incoming episodes can finish a series: keep the invariant locally too.
        for (const seriesId of touchedSeries) {
          if (!await isWatchedId(tx, seriesId)) continue;
          const mediaRow = await tx.getFirstAsync<MediaRow>('SELECT * FROM tracked_media WHERE id = ?', seriesId);
          if (mediaRow) await dropWatchlistEntry(tx, mapMedia(mediaRow), new Date().toISOString());
        }
      });
    });
  }

  async markSynced(changes: PendingWatchStateChange[]): Promise<void> {
    if (!changes.length) return;
    await this.run("Couldn't update sync status.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const conditions = changes.map(() => '(id = ? AND updated_at = ?)').join(' OR ');
        await tx.runAsync(`DELETE FROM sync_queue WHERE ${conditions}`, ...changes.flatMap(({ id, updatedAt }) => [id, updatedAt]));
      });
    });
  }

  async recordSyncFailure(changes: PendingWatchStateChange[], safeMessage: string): Promise<void> {
    if (!changes.length) return;
    await this.run("Couldn't save sync retry status.", async (db) => {
      const conditions = changes.map(() => '(id = ? AND updated_at = ?)').join(' OR ');
      await db.runAsync(`UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE ${conditions}`, safeMessage.slice(0, 160), ...changes.flatMap(({ id, updatedAt }) => [id, updatedAt]));
    });
  }

  async bindAccount(accountId: string): Promise<void> {
    if (this.binding) {
      if (this.binding.accountId === accountId) return this.binding.promise;
      await this.binding.promise;
      return this.bindAccount(accountId);
    }
    const promise = this.bindAccountOnce(accountId);
    this.binding = { accountId, promise };
    try { await promise; }
    finally { if (this.binding?.promise === promise) this.binding = undefined; }
  }

  private async bindAccountOnce(accountId: string): Promise<void> {
    await this.run("Couldn't prepare this account's local library.", async (db) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        const binding = await tx.getFirstAsync<{ account_id: string }>('SELECT account_id FROM account_binding WHERE id = 1');
        if (binding && binding.account_id !== accountId) throw new AppError('authentication', 'This device library is linked to another account. Sign back into that account before syncing.');
        if (binding) return;
        await tx.runAsync('INSERT INTO account_binding (id, account_id) VALUES (1, ?)', accountId);
        const watchlist = await tx.getAllAsync<MediaRow & { added_at: string; position: number | null; priority: string | null }>('SELECT m.*, w.added_at, w.position, w.priority FROM watchlist_entries w JOIN tracked_media m ON m.id = w.media_id');
        for (const row of watchlist) await enqueueSyncChange(tx, { entityType: 'watchlist', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.added_at, media: mapMedia(row), position: row.position ?? 0, priority: isWatchPriority(row.priority) ? row.priority : undefined });
        const movies = await tx.getAllAsync<MediaRow & { watched_at: string }>('SELECT m.*, w.watched_at FROM movie_watches w JOIN tracked_media m ON m.id = w.media_id');
        for (const row of movies) await enqueueSyncChange(tx, { entityType: 'movie', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.watched_at, watchedAt: row.watched_at, media: mapMedia(row) });
        const favorites = await tx.getAllAsync<MediaRow & { favorited_at: string }>('SELECT m.*, f.favorited_at FROM favorite_entries f JOIN tracked_media m ON m.id = f.media_id');
        for (const row of favorites) await enqueueSyncChange(tx, { entityType: 'favorite', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.favorited_at, watchedAt: row.favorited_at, media: mapMedia(row) });
        const interested = await tx.getAllAsync<MediaRow & { marked_at: string }>('SELECT m.*, i.marked_at FROM interested_entries i JOIN tracked_media m ON m.id = i.media_id');
        for (const row of interested) await enqueueSyncChange(tx, { entityType: 'interested', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.marked_at, watchedAt: row.marked_at, media: mapMedia(row) });
        const ratings = await tx.getAllAsync<MediaRow & { rating_value: number | null; thumbs: number; rated_at: string }>('SELECT m.*, r.rating AS rating_value, r.thumbs, r.updated_at AS rated_at FROM user_ratings r JOIN tracked_media m ON m.id = r.media_id');
        for (const row of ratings) await enqueueSyncChange(tx, { entityType: 'rating', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.rated_at, media: mapMedia(row), rating: row.rating_value, thumbs: row.thumbs === 1 ? 1 : row.thumbs === -1 ? -1 : 0 });
        const series = await tx.getAllAsync<MediaRow & { updated_at: string; completed?: number | null }>('SELECT m.*, s.updated_at, s.completed FROM tracked_series s JOIN tracked_media m ON m.id = s.media_id');
        for (const row of series) await enqueueSyncChange(tx, { entityType: 'series', entityKey: row.id, provider: row.provider, mediaType: row.media_type, providerId: row.provider_id, deleted: false, updatedAt: row.updated_at, media: mapMedia(row), completed: row.completed === 1 });
        const episodes = await tx.getAllAsync<EpisodeRow>('SELECT * FROM tracked_episodes WHERE watched_at IS NOT NULL');
        const savedMedia = new Map((await tx.getAllAsync<MediaRow>('SELECT * FROM tracked_media')).map((row) => [row.id, row]));
        for (const row of episodes) {
          const parent = savedMedia.get(row.series_id);
          if (!parent) continue;
          const episode = mapEpisode(row);
          await enqueueSyncChange(tx, { entityType: 'episode', entityKey: `${row.series_id}:${row.season_number}:${row.episode_number}`, provider: episode.provider, mediaType: episode.mediaType, providerId: row.provider_id, seasonNumber: row.season_number, episodeNumber: row.episode_number, deleted: false, updatedAt: row.watched_at ?? new Date().toISOString(), watchedAt: row.watched_at ?? undefined, media: mapMedia(parent), episode });
        }
      });
    });
  }

  async getBoundAccount(): Promise<string | undefined> {
    return this.run("Couldn't read account ownership.", async (db) => (await db.getFirstAsync<{ account_id: string }>('SELECT account_id FROM account_binding WHERE id = 1'))?.account_id);
  }

  /**
   * Full-fidelity local backup: every user-data table as plain rows. Infra
   * tables (sync queue, bindings, caches) are intentionally excluded — the
   * queue still references restored rows by their preserved ids.
   */
  async exportLibrary(): Promise<LibraryBackup> {
    return this.run("Couldn't read your library for backup.", async (db) => {
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const table of BACKUP_TABLES) {
        try {
          tables[table] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`);
        } catch {
          tables[table] = [];
        }
      }
      return { format: LIBRARY_BACKUP_FORMAT, version: LIBRARY_BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
    });
  }

  /**
   * Replaces every local user row with the backup's. Validates the envelope
   * first so a random JSON file can never wipe the library.
   */
  async importLibrary(backup: LibraryBackup): Promise<{ titles: number }> {
    const rows = backup?.tables;
    if (!backup || backup.format !== LIBRARY_BACKUP_FORMAT || backup.version !== LIBRARY_BACKUP_VERSION || !rows || typeof rows !== 'object') {
      throw new AppError('validation', 'This file is not a Watch Later backup.');
    }
    const titles = Array.isArray(rows.tracked_media) ? rows.tracked_media.length : 0;
    await this.run("Couldn't restore your backup.", async (db) => {
      // Validate every table/column/value before the first DELETE. Column
      // names reach SQL as identifiers, so a hand-edited backup must never be
      // able to inject SQL or wipe the library with a half-valid file.
      const allowedColumns = new Map<string, Set<string>>();
      for (const table of BACKUP_TABLES) {
        const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        allowedColumns.set(table, new Set(info.map((column) => column.name)));
      }
      for (const table of BACKUP_TABLES) {
        const tableRows = rows[table];
        if (tableRows === undefined) continue;
        if (!Array.isArray(tableRows)) throw new AppError('validation', `This backup has an invalid ${table} section.`);
        for (const row of tableRows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError('validation', `This backup has an invalid row in ${table}.`);
          for (const [column, value] of Object.entries(row)) {
            if (!allowedColumns.get(table)?.has(column)) {
              throw new AppError('validation', `This backup contains an unknown column (${column}) in ${table}.`);
            }
            if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
              throw new AppError('validation', `This backup has an unsupported value in ${table}.${column}.`);
            }
          }
        }
      }
      await db.withExclusiveTransactionAsync(async (tx) => {
        for (const table of [...BACKUP_TABLES].reverse()) await tx.runAsync(`DELETE FROM ${table}`);
        for (const table of BACKUP_TABLES) {
          const tableRows = Array.isArray(rows[table]) ? rows[table] : [];
          for (const row of tableRows) {
            const columns = Object.keys(row);
            if (!columns.length) continue;
            const placeholders = columns.map(() => '?').join(', ');
            await tx.runAsync(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
              ...(columns.map((column) => {
                const value = row[column];
                if (typeof value === 'boolean') return value ? 1 : 0;
                return value as string | number | null;
              })),
            );
          }
        }
        // The restored library is now the local truth. Queue it with a fresh
        // timestamp so a previous queue entry or older cloud row cannot undo it.
        await rebuildSyncQueueAfterRestore(tx, new Date().toISOString());
      });
    });
    return { titles };
  }

  private async pruneMedia(db: SQLiteDatabase, id: string): Promise<void> {
    await db.runAsync(
      `DELETE FROM tracked_media WHERE id = ? AND NOT EXISTS (SELECT 1 FROM watchlist_entries WHERE media_id = ?)
       AND NOT EXISTS (SELECT 1 FROM movie_watches WHERE media_id = ?) AND NOT EXISTS (SELECT 1 FROM tracked_series WHERE media_id = ?)
       AND NOT EXISTS (SELECT 1 FROM favorite_entries WHERE media_id = ?) AND NOT EXISTS (SELECT 1 FROM custom_list_items WHERE media_id = ?)
       AND NOT EXISTS (SELECT 1 FROM interested_entries WHERE media_id = ?)
       AND NOT EXISTS (SELECT 1 FROM anime_progress WHERE media_id = ?)
       AND NOT EXISTS (SELECT 1 FROM user_ratings WHERE media_id = ?)`, id, id, id, id, id, id, id, id, id,
    );
  }
}

const sqliteWatchStateRepository = new SqliteWatchStateRepository();
export const watchStateRepository: SqliteWatchStateRepository = sqliteWatchStateRepository;
export const watchStateSyncRepository: WatchStateSyncRepository = sqliteWatchStateRepository;
