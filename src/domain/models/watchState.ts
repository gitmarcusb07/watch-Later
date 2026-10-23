import type { CatalogMedia, CatalogSeason, MediaEpisode, MediaIdentity } from './media';

export interface WatchlistEntry {
  media: CatalogMedia;
  watchedAt?: string;
  addedAt: string;
  position: number;
  priority: WatchPriority | null;
}

export type WatchPriority = 'asap' | 'weekend' | 'someday';

export interface FavoriteEntry {
  media: CatalogMedia;
  favoritedAt: string;
}

export interface InterestedEntry {
  media: CatalogMedia;
  markedAt: string;
}

export interface InterestedCount {
  provider: CatalogMedia['provider'];
  mediaType: CatalogMedia['mediaType'];
  providerId: string;
  count: number;
}

export interface UserRating {
  media: CatalogMedia;
  /** 0–10 scale, null when only a thumbs signal exists. Independent from watched state. */
  rating: number | null;
  thumbs: -1 | 0 | 1;
  updatedAt: string;
}

export interface ListFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomListSummary {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface CustomListItem {
  media: CatalogMedia;
  addedAt: string;
  position: number;
}

export interface CustomListDetail {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  items: CustomListItem[];
}

export interface TrashItem {
  id: number;
  kind: 'watchlist' | 'movie' | 'series' | 'favorite' | 'list' | 'list_item';
  label: string;
  media: CatalogMedia | null;
  listSnapshot: CustomListDetail | null;
  originListId: string | null;
  watchedAt: string | null;
  favoritedAt: string | null;
  deletedAt: string;
}

export type HistoryItem =
  | { kind: 'movie'; media: CatalogMedia; watchedAt: string }
  | { kind: 'episode'; media: CatalogMedia; episode: MediaEpisode; watchedAt: string };

export interface UpcomingEpisode {
  media: CatalogMedia;
  episode: MediaEpisode;
  airDate: string;
}

export interface LibraryStatus {
  /** Saved for later — never true for a title that is already watched. */
  watchlisted: boolean;
  movieWatched: boolean;
  tracking: boolean;
  /** Finished: a watched movie or a series with every known episode done. */
  complete: boolean;
}

export interface MovieWatchState {
  media: CatalogMedia;
  watchedAt: string;
}

export interface SeriesProgress {
  identity: MediaIdentity;
  media: CatalogMedia;
  watchedEpisodeCount: number;
  cachedEpisodeCount: number;
  totalEpisodeCount?: number;
  progress: number;
  isComplete: boolean;
  lastWatchedAt?: string;
  nextEpisode?: MediaEpisode;
  /**
   * The next unwatched cached episodes in air order. Includes episodes that
   * have not aired yet, so the Watching screen can show real release dates for
   * episode 3 onward even when only the first two have dropped.
   */
  nextEpisodes?: MediaEpisode[];
  nextSeasonNumber?: number;
}

export type ContinueWatchingItem = SeriesProgress;

/** Exact episode watch state captured before a destructive progress reset. */
export interface WatchedEpisodeSnapshot {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  providerId: string;
  watchedAt: string;
  rewatchCount: number;
}

export type WatchedLibraryItem =
  | { kind: 'movie'; watchedAt: string; media: CatalogMedia }
  | { kind: 'series'; progress: SeriesProgress };

export interface WatchStateRepository {
  getTrackedMedia(identity: MediaIdentity): Promise<CatalogMedia | undefined>;
  getLibraryStatuses(identities: MediaIdentity[]): Promise<Record<string, LibraryStatus>>;
  getCachedSeason(identity: MediaIdentity, seasonNumber: number): Promise<CatalogSeason | undefined>;
  addToWatchlist(media: CatalogMedia): Promise<void>;
  removeFromWatchlist(identity: MediaIdentity): Promise<void>;
  /** Save (or re-prioritize) a watchlist entry without touching its position. */
  saveToWatchlist(media: CatalogMedia, priority: WatchPriority | null): Promise<void>;
  getWatchlist(): Promise<WatchlistEntry[]>;
  isInWatchlist(identity: MediaIdentity): Promise<boolean>;
  moveWatchlistItem(identity: MediaIdentity, direction: -1 | 1): Promise<boolean>;
  markMovieWatched(media: CatalogMedia, watched: boolean): Promise<void>;
  isMovieWatched(identity: MediaIdentity): Promise<boolean>;
  startTrackingSeries(media: CatalogMedia): Promise<void>;
  stopTrackingSeries(identity: MediaIdentity): Promise<void>;
  isSeriesTracked(identity: MediaIdentity): Promise<boolean>;
  storeSeason(media: CatalogMedia, seasonNumber: number, name: string, episodeCount: number | undefined, overview: string | undefined, airDate: string | undefined, posterUrl: string | undefined, episodes: MediaEpisode[]): Promise<void>;  setEpisodeWatched(media: CatalogMedia, season: CatalogSeason, episode: MediaEpisode, watched: boolean): Promise<void>;
  setSeasonWatched(media: CatalogMedia, season: import('./media').CatalogSeason, watched: boolean): Promise<void>;
  setSeriesWatched(media: CatalogMedia, seasons: { seasonNumber: number; name: string; episodeCount?: number; overview?: string; airDate?: string; posterUrl?: string; episodes: MediaEpisode[] }[], watched: boolean): Promise<void>;
  /** Explicit whole-series completion flag. This is the only completion path for anime (no per-episode metadata). */
  setSeriesComplete(media: CatalogMedia, complete: boolean): Promise<void>;
  /**
   * Manual episode counter for anime (AniList exposes a total but no episode
   * list). Local-only like custom lists and history: never synced.
   */
  setAnimeWatchedCount(media: CatalogMedia, count: number): Promise<void>;
  getAnimeWatchedCount(identity: MediaIdentity): Promise<number>;
  /** Used by the 5-second Undo after clearing series progress. */
  getWatchedEpisodeSnapshot(identity: MediaIdentity): Promise<WatchedEpisodeSnapshot[]>;
  restoreWatchedEpisodes(media: CatalogMedia, snapshot: WatchedEpisodeSnapshot[]): Promise<void>;
  getEpisodeWatched(identity: MediaIdentity): Promise<boolean>;
  getWatchedEpisodeIds(seriesIdentity: MediaIdentity, seasonNumber: number): Promise<string[]>;
  getSeriesProgress(): Promise<SeriesProgress[]>;
  getContinueWatching(): Promise<ContinueWatchingItem[]>;
  getWatchedLibrary(): Promise<WatchedLibraryItem[]>;
  setFavorite(media: CatalogMedia, favorite: boolean): Promise<void>;
  isFavorite(identity: MediaIdentity): Promise<boolean>;
  getFavorites(): Promise<FavoriteEntry[]>;
  setInterested(media: CatalogMedia, interested: boolean): Promise<void>;
  isInterested(identity: MediaIdentity): Promise<boolean>;
  getInterested(): Promise<InterestedEntry[]>;
  setUserRating(media: CatalogMedia, rating: number | null, thumbs: -1 | 0 | 1): Promise<void>;
  clearUserRating(media: CatalogMedia): Promise<void>;
  getUserRating(identity: MediaIdentity): Promise<UserRating | undefined>;
  getUserRatings(): Promise<UserRating[]>;
  clearAllRatings(): Promise<void>;
  markEpisodesUpTo(media: CatalogMedia, season: CatalogSeason, episodeNumber: number): Promise<void>;
  createCustomList(name: string): Promise<CustomListSummary>;
  updateCustomList(id: string, patch: { name?: string; icon?: string | null; color?: string | null; folderId?: string | null }): Promise<void>;
  deleteCustomList(id: string): Promise<void>;
  getCustomLists(folderId?: string | null): Promise<CustomListSummary[]>;
  getCustomList(id: string): Promise<CustomListDetail | undefined>;
  addToCustomList(listId: string, media: CatalogMedia): Promise<boolean>;
  removeFromCustomList(listId: string, identity: MediaIdentity): Promise<void>;
  moveCustomListItem(listId: string, identity: MediaIdentity, direction: -1 | 1): Promise<boolean>;
  createFolder(name: string): Promise<ListFolder>;
  deleteFolder(id: string): Promise<void>;
  getFolders(): Promise<ListFolder[]>;
  getTrash(): Promise<TrashItem[]>;
  restoreTrashItem(id: number): Promise<void>;
  clearTrash(): Promise<void>;
  createCustomEntry(input: { title: string; year?: number; mediaType: CatalogMedia['mediaType']; notes?: string }): Promise<CatalogMedia>;
  getViewingHistory(limit?: number): Promise<HistoryItem[]>;
  getUpcomingEpisodes(horizonDays?: number): Promise<UpcomingEpisode[]>;
}

export type SyncEntityType = 'watchlist' | 'movie' | 'series' | 'episode' | 'favorite' | 'rating' | 'interested';

export interface PendingWatchStateChange {
  id: number;
  entityType: SyncEntityType;
  entityKey: string;
  provider: MediaIdentity['provider'];
  mediaType: MediaIdentity['mediaType'];
  providerId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  deleted: boolean;
  updatedAt: string;
  media: CatalogMedia;
  watchedAt?: string;
  episode?: MediaEpisode;
  /** Explicit whole-series completion for the 'series' entity (anime path). */
  completed?: boolean;
  /** Watch-later priority for the 'watchlist' entity. Absent on legacy rows. */
  priority?: WatchPriority | null;
  /** Rating payload for the 'rating' entity; never implies watched state. */
  rating?: number | null;
  thumbs?: -1 | 0 | 1;
  /** Rewatch counter snapshot for movie/episode entities. */
  rewatchCount?: number;
  /** Manual order snapshot for watchlist entities. */
  position?: number;
  retryCount: number;
}

export interface CloudWatchStateRepository {
  getAuthenticatedUserId(): Promise<string | undefined>;
  fetch(userId: string): Promise<PendingWatchStateChange[]>;
  upsert(userId: string, changes: PendingWatchStateChange[]): Promise<void>;
  getInterestedCounts(): Promise<InterestedCount[]>;
}

export interface WatchStateSyncRepository {
  getPendingChanges(): Promise<PendingWatchStateChange[]>;
  applyRemoteChanges(changes: PendingWatchStateChange[]): Promise<void>;
  markSynced(changes: PendingWatchStateChange[]): Promise<void>;
  recordSyncFailure(changes: PendingWatchStateChange[], safeMessage: string): Promise<void>;
  bindAccount(accountId: string): Promise<void>;
  getBoundAccount(): Promise<string | undefined>;
}
