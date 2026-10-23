import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CatalogMedia, CatalogSeason, MediaIdentity, SeasonSummary } from '@/domain/models/media';
import type { InterestedCount, SeriesProgress, WatchPriority } from '@/domain/models/watchState';
import { AppError } from '@/domain/errors/AppError';
import { catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { cloudWatchStateRepository } from '@/data/remote/supabase/SupabaseWatchStateRepository';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { fetchCatalogSeason } from '@/features/catalog/hooks';
import { formatReleaseDate, hasAired } from '@/features/catalog/upcoming';
import { scheduleAutoSync } from '@/features/sync/autoSync';

function maybePromptRating(_media: CatalogMedia): void {
  // Ratings UI was removed; marking watched no longer prompts. Kept as a
  // no-op so watch mutations stay untouched.
}

export const watchKeys = {
  all: ['watch'] as const,
  watchlist: ['watch', 'watchlist'] as const,
  watched: ['watch', 'watched'] as const,
  progress: ['watch', 'series-progress'] as const,
  continue: ['watch', 'continue'] as const,
  favorites: ['watch', 'favorites'] as const,
  interested: ['watch', 'interested'] as const,
  interestedCounts: ['watch', 'interested-counts'] as const,
  lists: ['watch', 'lists'] as const,
  history: ['watch', 'history'] as const,
  media: (identity: MediaIdentity) => ['watch', 'media', identity.provider, identity.mediaType, identity.providerId] as const,
  episodes: (identity: MediaIdentity, season: number) => ['watch', 'episodes', identity.provider, identity.providerId, season] as const,
};

function useInvalidateWatchState() {
  const queryClient = useQueryClient();
  return (sync = false) => {
    void queryClient.invalidateQueries({ queryKey: watchKeys.all });
    if (sync) scheduleAutoSync('mutation');
  };
}

export function useWatchlist(enabled = true) {
  return useQuery({ queryKey: watchKeys.watchlist, queryFn: () => watchStateRepository.getWatchlist(), enabled });
}

export function useWatchedLibrary() {
  return useQuery({ queryKey: watchKeys.watched, queryFn: () => watchStateRepository.getWatchedLibrary() });
}

export function useSeriesProgress() {
  return useQuery({ queryKey: watchKeys.progress, queryFn: () => watchStateRepository.getSeriesProgress() });
}

export function useContinueWatching() {
  return useQuery({ queryKey: watchKeys.continue, queryFn: () => watchStateRepository.getContinueWatching() });
}

/**
 * Provider season payloads often stop at the episodes that have already
 * dropped. This warms the local schedule in the background so the Watching
 * screen can show the date for episode 3 (and everything after it) even when
 * only the first two episodes exist in the catalog.
 *
 * Attempts are throttled per season so a provider that genuinely exposes only
 * aired episodes cannot turn into a request loop.
 */
const SCHEDULE_BACKFILL_TTL_MS = 60 * 60_000;
const scheduleBackfillAttempts = new Map<string, number>();

/** Lets pull-to-refresh ask for a fresh schedule without waiting out the TTL. */
export function resetEpisodeScheduleBackfill(): void {
  scheduleBackfillAttempts.clear();
}

export function useEpisodeScheduleBackfill(enabled = true) {
  const queryClient = useQueryClient();
  const progressQuery = useSeriesProgress();
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || running.current || !progressQuery.data?.length) return;
    const candidates = progressQuery.data.filter((item) => {
      if (item.isComplete || item.media.episodeMetadata !== 'available') return false;
      if (!item.media.seasonSummaries?.length) return false;
      // A complete cache already holds every release date we could show.
      return item.totalEpisodeCount === undefined
        || item.cachedEpisodeCount < item.totalEpisodeCount
        || (item.nextEpisodes ?? []).some((episode) => !episode.airDate);
    });
    if (!candidates.length) return;

    running.current = true;
    let cancelled = false;

    void (async () => {
      let changed = false;
      const jobs: { item: SeriesProgress; summary: SeasonSummary }[] = [];

      for (const item of candidates.slice(0, 10)) {
        if (jobs.length >= 12) break;
        const ordered = [...(item.media.seasonSummaries ?? [])].sort((a, b) => a.seasonNumber - b.seasonNumber);
        const focusNumber = item.nextSeasonNumber ?? item.nextEpisode?.seasonNumber;
        const focusIndex = Math.max(0, ordered.findIndex((season) => season.seasonNumber === focusNumber));
        const targets = [ordered[focusIndex], ordered[focusIndex + 1]].filter((season): season is SeasonSummary => Boolean(season));

        for (const summary of targets) {
          if (!summary.episodeCount || summary.episodeCount <= 0) continue;
          const attemptKey = `${item.media.id}:${summary.seasonNumber}`;
          if (Date.now() - (scheduleBackfillAttempts.get(attemptKey) ?? 0) < SCHEDULE_BACKFILL_TTL_MS) continue;

          const cached = await watchStateRepository.getCachedSeason(item.identity, summary.seasonNumber);
          const cachedEpisodes = cached?.episodes ?? [];
          // Only refetch when dates can actually improve: incomplete seasons,
          // or dated rows that stop before undated rows. Synthetic lists have
          // no anchor at all and must not cause a request loop.
          const lastDated = cachedEpisodes.reduce((latest, episode) => episode.airDate ? Math.max(latest, episode.episodeNumber) : latest, 0);
          const missingDates = lastDated > 0 && cachedEpisodes.some((episode) => !episode.airDate && episode.episodeNumber > lastDated);
          if (cachedEpisodes.length >= summary.episodeCount && !missingDates) continue;

          scheduleBackfillAttempts.set(attemptKey, Date.now());
          jobs.push({ item, summary });
          if (jobs.length >= 12) break;
        }
      }

      // Two seasons at a time keeps SQLite and the providers comfortable.
      for (let index = 0; index < jobs.length; index += 2) {
        if (cancelled) return;
        await Promise.all(jobs.slice(index, index + 2).map(async ({ item, summary }) => {
          try {
            const fetched = await fetchCatalogSeason(item.identity, summary.seasonNumber, summary);
            if (cancelled || !fetched.episodes.length) return;
            await watchStateRepository.storeSeason(
              item.media,
              fetched.seasonNumber,
              fetched.name,
              fetched.episodes.length,
              fetched.overview,
              fetched.airDate,
              fetched.posterUrl,
              fetched.episodes,
            );
            changed = true;
          } catch {
            // Offline or a provider gap: keep whatever schedule is cached.
          }
        }));
      }

      if (!cancelled && changed) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: watchKeys.progress }),
          queryClient.invalidateQueries({ queryKey: watchKeys.continue }),
        ]);
      }
    })().finally(() => { running.current = false; });

    return () => { cancelled = true; };
  }, [enabled, progressQuery.data, queryClient]);
}

export function useTrackedMedia(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? watchKeys.media(identity) : ['watch', 'media', 'none'],
    queryFn: async () => identity ? (await watchStateRepository.getTrackedMedia(identity)) ?? null : null,
    enabled: Boolean(identity),
    // Serve cached status instantly so action buttons never sit disabled on a slow disk.
    staleTime: 30_000,
  });
}

export function useCachedSeason(identity: MediaIdentity | undefined, seasonNumber: number | undefined) {
  return useQuery({
    queryKey: identity && seasonNumber !== undefined ? ['watch', 'cached-season', identity.provider, identity.providerId, seasonNumber] : ['watch', 'cached-season', 'none'],
    queryFn: async () => identity && seasonNumber !== undefined ? (await watchStateRepository.getCachedSeason(identity, seasonNumber)) ?? null : null,
    enabled: Boolean(identity && seasonNumber !== undefined),
    staleTime: 30_000,
  });
}

export function useLibraryStatuses(items: CatalogMedia[]) {
  const identities = items.map(({ provider, mediaType, providerId }) => ({ provider, mediaType, providerId }));
  const key = identities.map((identity) => `${identity.provider}:${identity.mediaType}:${identity.providerId}`).sort();
  return useQuery({
    queryKey: ['watch', 'statuses', key],
    queryFn: () => watchStateRepository.getLibraryStatuses(identities),
    enabled: identities.length > 0,
    staleTime: 30_000,
  });
}

export function useWatchlistStatus(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'watchlist'] : ['watch', 'watchlist', 'none'],
    queryFn: () => identity ? watchStateRepository.isInWatchlist(identity) : Promise.resolve(false),
    enabled: Boolean(identity),
    staleTime: 30_000,
  });
}

export function useMovieWatchedStatus(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'movie-watched'] : ['watch', 'movie-watched', 'none'],
    queryFn: () => identity ? watchStateRepository.isMovieWatched(identity) : Promise.resolve(false),
    enabled: Boolean(identity?.mediaType === 'movie'),
    staleTime: 30_000,
  });
}

export function useSeriesTrackingStatus(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'tracking'] : ['watch', 'tracking', 'none'],
    queryFn: () => identity ? watchStateRepository.isSeriesTracked(identity) : Promise.resolve(false),
    enabled: Boolean(identity && identity.mediaType !== 'movie'),
    staleTime: 30_000,
  });
}

export function useWatchedEpisodeIds(identity: MediaIdentity | undefined, seasonNumber: number | undefined) {
  return useQuery({
    queryKey: identity && seasonNumber !== undefined ? watchKeys.episodes(identity, seasonNumber) : ['watch', 'episodes', 'none'],
    queryFn: () => identity && seasonNumber !== undefined ? watchStateRepository.getWatchedEpisodeIds(identity, seasonNumber) : Promise.resolve([]),
    enabled: Boolean(identity && seasonNumber !== undefined),
    staleTime: 30_000,
  });
}

export function useToggleWatchlist(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  const state = useWatchlistStatus(media);
  const mutation = useMutation({
    mutationFn: () => state.data ? watchStateRepository.removeFromWatchlist(media) : watchStateRepository.addToWatchlist(media),
    onSuccess: () => invalidate(true),
  });
  return { ...state, toggle: mutation.mutate, toggleAsync: mutation.mutateAsync, isMutating: mutation.isPending };
}

export function useWatchlistMutation(media: CatalogMedia, currentlySaved: boolean) {
  const invalidate = useInvalidateWatchState();
  const mutation = useMutation({
    mutationFn: () => currentlySaved ? watchStateRepository.removeFromWatchlist(media) : watchStateRepository.addToWatchlist(media),
    onSuccess: () => invalidate(true),
  });
  return mutation;
}

export function useSaveToWatchlist(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: (priority: WatchPriority | null) => watchStateRepository.saveToWatchlist(media, priority),
    onSuccess: () => invalidate(true),
  });
}

export interface MovieWatchedOptimism {
  key: readonly unknown[];
  apply: () => Promise<{ previous: boolean | undefined }>;
  rollback: (context?: { previous: boolean | undefined }) => void;
  settle: () => void;
}

/**
 * Instant watched-button flip for movies: applies the new value to the
 * status query before the SQLite write, rolls back on failure, and refetches
 * after settling. Extracted pure (no React) so the flip/rollback/settle
 * sequence is unit-testable without a renderer.
 */
export function movieWatchedOptimism(queryClient: QueryClient, media: CatalogMedia, next: boolean): MovieWatchedOptimism {
  const key = [...watchKeys.media({ provider: media.provider, mediaType: media.mediaType, providerId: media.providerId }), 'movie-watched'] as const;
  return {
    key,
    apply: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData<boolean>(key, next);
      return { previous };
    },
    rollback: (context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    settle: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  };
}

export function useMovieWatchedMutation(media: CatalogMedia, currentlyWatched: boolean) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWatchState();
  const next = !currentlyWatched;
  return useMutation({
    // Flip the button instantly; the SQLite write lands right after.
    // Rolls back on failure.
    onMutate: () => movieWatchedOptimism(queryClient, media, next).apply(),
    onError: (_error, _variables, context) => movieWatchedOptimism(queryClient, media, next).rollback(context),
    mutationFn: () => watchStateRepository.markMovieWatched(media, next),
    onSuccess: () => { invalidate(true); if (!currentlyWatched) maybePromptRating(media); },
    onSettled: () => movieWatchedOptimism(queryClient, media, next).settle(),
  });
}

export function useSeriesTrackingMutation(media: CatalogMedia, currentlyTracked: boolean) {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: () => currentlyTracked ? watchStateRepository.stopTrackingSeries(media) : watchStateRepository.startTrackingSeries(media),
    onSuccess: () => invalidate(true),
  });
}

export function useSeriesCompleteMutation(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  const state = useSeriesProgress();
  const complete = state.data?.find((item) => item.media.id === media.id)?.isComplete ?? false;
  const mutation = useMutation({
    mutationFn: () => watchStateRepository.setSeriesComplete(media, !complete),
    onSuccess: () => invalidate(true),
  });
  return { ...mutation, complete, toggle: mutation.mutate, toggleAsync: mutation.mutateAsync, isMutating: mutation.isPending };
}

export function useAnimeWatchedCount(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'anime-progress'] : ['watch', 'anime-progress', 'none'],
    queryFn: () => identity ? watchStateRepository.getAnimeWatchedCount(identity) : Promise.resolve(0),
    enabled: Boolean(identity && identity.mediaType === 'anime'),
    staleTime: 30_000,
  });
}

export function useToggleMovieWatched(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  const state = useMovieWatchedStatus(media);
  const mutation = useMutation({
    mutationFn: () => watchStateRepository.markMovieWatched(media, !state.data),
    onSuccess: () => { invalidate(true); if (!state.data) maybePromptRating(media); },
  });
  return { ...state, toggle: mutation.mutate, toggleAsync: mutation.mutateAsync, isMutating: mutation.isPending };
}

export function useStartTrackingSeries(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  const state = useSeriesTrackingStatus(media);
  const mutation = useMutation({
    mutationFn: () => state.data ? watchStateRepository.stopTrackingSeries(media) : watchStateRepository.startTrackingSeries(media),
    onSuccess: () => invalidate(true),
  });
  return { ...state, toggle: mutation.mutate, toggleAsync: mutation.mutateAsync, isMutating: mutation.isPending };
}

export function useStoreSeason(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: (season: CatalogSeason) => watchStateRepository.storeSeason(media, season.seasonNumber, season.name, season.episodes.length, season.overview, season.airDate, season.posterUrl, season.episodes),
    onSuccess: () => invalidate(false),
  });
}

export function useToggleEpisode(media: CatalogMedia, season: CatalogSeason) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWatchState();
  const episodes = useWatchedEpisodeIds(media, season.seasonNumber);
  const key = watchKeys.episodes(media, season.seasonNumber);
  const mutation = useMutation({
    // Flip the checkmark instantly; the SQLite write lands right after and
    // the progress lists refresh from it. Rolls back on failure.
    onMutate: async ({ episode, watched }: { episode: CatalogSeason['episodes'][number]; watched: boolean }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key) ?? [];
      queryClient.setQueryData<string[]>(
        key,
        watched ? [...new Set([...previous, episode.providerId])] : previous.filter((id) => id !== episode.providerId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    mutationFn: ({ episode, watched }: { episode: CatalogSeason['episodes'][number]; watched: boolean }) => watchStateRepository.setEpisodeWatched(media, season, episode, watched),
    onSuccess: (_data, variables) => { invalidate(true); if (variables.watched) maybePromptRating(media); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
  return { ...mutation, watchedIds: episodes.data ?? [], toggle: mutation.mutate, isMutating: mutation.isPending };
}

export function useAdvanceEpisode() {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: async (progress: SeriesProgress) => {
      const { media, nextEpisode } = progress;
      const identity: MediaIdentity = { provider: media.provider, mediaType: media.mediaType, providerId: media.providerId };
      const isAnime = media.mediaType === 'anime';
      const total = progress.totalEpisodeCount ?? (media.numberOfEpisodes && media.numberOfEpisodes > 0 ? media.numberOfEpisodes : undefined);
      // Manual anime counters are the only source of truth when no episode
      // rows exist. If the counter is ahead of the cached episode rows, keep
      // using it instead of re-marking episode 1.
      const cachedWatched = Math.max(0, progress.cachedEpisodeCount - (progress.nextEpisodes?.length ?? 0));
      const manualAnime = isAnime && (progress.cachedEpisodeCount === 0 || progress.watchedEpisodeCount > cachedWatched);

      const advanceAnimeCount = async () => {
        const stored = await watchStateRepository.getAnimeWatchedCount(identity);
        const current = Math.max(stored, progress.watchedEpisodeCount);
        if (total && current >= total) throw new AppError('catalog', 'Every episode is already watched.');
        await watchStateRepository.setAnimeWatchedCount(media, total ? Math.min(current + 1, total) : current + 1);
      };

      if (manualAnime) {
        await advanceAnimeCount();
        return;
      }

      const seasonNumber = progress.nextSeasonNumber ?? nextEpisode?.seasonNumber;
      if (seasonNumber === undefined) {
        if (isAnime) { await advanceAnimeCount(); return; }
        throw new AppError('catalog', 'The next episode is not available yet.');
      }

      const summary = media.seasonSummaries?.find((season) => season.seasonNumber === seasonNumber);
      let season = await watchStateRepository.getCachedSeason(identity, seasonNumber);
      const cachedHasTarget = nextEpisode
        ? Boolean(season?.episodes.some((episode) => episode.providerId === nextEpisode.providerId || episode.episodeNumber === nextEpisode.episodeNumber))
        : false;
      // No network for the common case (the next episode is already cached).
      // Without a next episode we must refresh: the cached season may only
      // hold the episodes that had dropped when it was stored.
      if (!season || !nextEpisode || !cachedHasTarget) {
        try {
          const fetched = await fetchCatalogSeason(identity, seasonNumber, summary);
          await watchStateRepository.storeSeason(media, fetched.seasonNumber, fetched.name, fetched.episodes.length, fetched.overview, fetched.airDate, fetched.posterUrl, fetched.episodes);
          season = (await watchStateRepository.getCachedSeason(identity, seasonNumber)) ?? fetched;
        } catch (error) {
          // Anime without any usable episode list still advances by count.
          if (isAnime) { await advanceAnimeCount(); return; }
          throw error;
        }
      }

      if (!season) throw new AppError('catalog', 'The next episode is not available yet.');
      let target = nextEpisode;
      if (target) {
        target = season.episodes.find((episode) => episode.providerId === target!.providerId)
          ?? season.episodes.find((episode) => episode.episodeNumber === target!.episodeNumber)
          ?? target;
      } else {
        // The first episode of the new season that has actually aired.
        target = [...season.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber).find((episode) => hasAired(episode.airDate));
      }

      if (!target) {
        if (isAnime) { await advanceAnimeCount(); return; }
        throw new AppError('catalog', 'No episode of this season has aired yet.');
      }
      if (!hasAired(target.airDate)) {
        const date = formatReleaseDate(target.airDate);
        throw new AppError('catalog', date
          ? `Episode ${target.episodeNumber} airs ${date}.`
          : `Episode ${target.episodeNumber} hasn't aired yet.`);
      }
      await watchStateRepository.setEpisodeWatched(media, season, target, true);
    },
    onSuccess: () => invalidate(true),
  });
}

export function useToggleSeason(media: CatalogMedia, seasonNumber: number) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWatchState();
  return useMutation({
    // Flip the whole season instantly; the batched SQLite write (one row per
    // episode plus sync queue entries) lands right after.
    onMutate: async ({ watched, season }: { watched: boolean; season: CatalogSeason }) => {
      const key = watchKeys.episodes(media, season.seasonNumber);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key) ?? [];
      // Repository marks only aired episodes; the optimistic checkmarks must
      // match so weekly shows never flash future episodes as watched.
      queryClient.setQueryData<string[]>(key, watched
        ? season.episodes.filter((episode) => hasAired(episode.airDate)).map((episode) => episode.providerId)
        : []);
      return { previous, key };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
    mutationFn: ({ watched, season }: { watched: boolean; season: CatalogSeason }) => watchStateRepository.setSeasonWatched(media, season, watched),
    onSuccess: (_data, variables) => { invalidate(true); if (variables.watched) maybePromptRating(media); },
    onSettled: (_data, _error, variables) => { void queryClient.invalidateQueries({ queryKey: watchKeys.episodes(media, variables.season.seasonNumber) }); },
  });
}

export function useSetSeriesWatched(media: CatalogMedia) {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: async (watched: boolean) => {
      if (!watched) return watchStateRepository.setSeriesWatched(media, [], false);
      const summaries = media.seasonSummaries ?? [];
      if (!summaries.length) throw new Error('Season metadata is not available for this series.');
      const seasons = await Promise.all(summaries.map(async (summary) => {
        const season = await catalogRepository.getSeason(media, summary.seasonNumber);
        return { ...season, episodeCount: summary.episodeCount };
      }));
      return watchStateRepository.setSeriesWatched(media, seasons, watched);
    },
    onSuccess: (_data, watched) => { invalidate(true); if (watched) maybePromptRating(media); },
  });
}

export function useWatchStateActions() {
  const invalidate = useInvalidateWatchState();
  return { invalidate };
}

export function useFavorites() {
  return useQuery({ queryKey: watchKeys.favorites, queryFn: () => watchStateRepository.getFavorites() });
}

export function useFavoriteStatus(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'favorite'] : ['watch', 'favorite', 'none'],
    queryFn: () => identity ? watchStateRepository.isFavorite(identity) : Promise.resolve(false),
    enabled: Boolean(identity),
    staleTime: 30_000,
  });
}

export function useFavoriteMutation(media: CatalogMedia, currentlyFavorite: boolean) {
  const invalidate = useInvalidateWatchState();
  const mutation = useMutation({
    mutationFn: () => watchStateRepository.setFavorite(media, !currentlyFavorite),
    onSuccess: () => invalidate(true),
  });
  return mutation;
}

export function useInterested() {
  return useQuery({ queryKey: watchKeys.interested, queryFn: () => watchStateRepository.getInterested() });
}

export function useInterestedStatus(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'interested'] : ['watch', 'interested', 'none'],
    queryFn: () => identity ? watchStateRepository.isInterested(identity) : Promise.resolve(false),
    enabled: Boolean(identity),
    staleTime: 30_000,
  });
}

export function useInterestedMutation(media: CatalogMedia, currentlyInterested: boolean) {
  const invalidate = useInvalidateWatchState();
  const queryClient = useQueryClient();
  const key = [...watchKeys.media({ provider: media.provider, mediaType: media.mediaType, providerId: media.providerId }), 'interested'] as const;
  return useMutation({
    // Flip the bell instantly; the SQLite write lands right after.
    // Rolls back on failure.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData<boolean>(key, !currentlyInterested);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    mutationFn: () => watchStateRepository.setInterested(media, !currentlyInterested),
    onSuccess: () => {
      invalidate(true);
      void queryClient.invalidateQueries({ queryKey: watchKeys.interestedCounts });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useInterestedCounts(): { data: Map<string, number>; isLoading: boolean; isError: boolean; refetch: () => void } {
  const query = useQuery({
    queryKey: watchKeys.interestedCounts,
    queryFn: (): Promise<InterestedCount[]> => cloudWatchStateRepository.getInterestedCounts(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const counts = new Map<string, number>();
  for (const row of query.data ?? []) {
    counts.set(`${row.provider}:${row.mediaType}:${row.providerId}`, row.count);
  }
  return { data: counts, isLoading: query.isLoading, isError: query.isError, refetch: () => void query.refetch() };
}

export function useCustomLists(enabled = true) {
  return useQuery({ queryKey: watchKeys.lists, queryFn: () => watchStateRepository.getCustomLists(), enabled });
}

export function useFolders() {
  return useQuery({ queryKey: [...watchKeys.lists, 'folders'], queryFn: () => watchStateRepository.getFolders() });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => watchStateRepository.createFolder(name),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => watchStateRepository.deleteFolder(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useUpdateCustomList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; icon?: string | null; color?: string | null; folderId?: string | null } }) => watchStateRepository.updateCustomList(id, patch),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useMoveWatchlistItem() {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: ({ identity, direction }: { identity: MediaIdentity; direction: -1 | 1 }) => watchStateRepository.moveWatchlistItem(identity, direction),
    onSuccess: () => invalidate(true),
  });
}

export function useMoveCustomListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, identity, direction }: { listId: string; identity: MediaIdentity; direction: -1 | 1 }) => watchStateRepository.moveCustomListItem(listId, identity, direction),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useTrash() {
  return useQuery({ queryKey: [...watchKeys.lists, 'trash'], queryFn: () => watchStateRepository.getTrash() });
}

export function useRestoreTrashItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => watchStateRepository.restoreTrashItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      void queryClient.invalidateQueries({ queryKey: [...watchKeys.lists, 'trash'] });
      scheduleAutoSync('mutation');
    },
  });
}

export function useClearTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => watchStateRepository.clearTrash(),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [...watchKeys.lists, 'trash'] }); },
  });
}

export function useCreateCustomEntry() {
  const invalidate = useInvalidateWatchState();
  return useMutation({
    mutationFn: (input: { title: string; year?: number; mediaType: CatalogMedia['mediaType']; notes?: string }) => watchStateRepository.createCustomEntry(input),
    onSuccess: () => invalidate(true),
  });
}

export function useCustomList(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? [...watchKeys.lists, id] : ['watch', 'lists', 'none'],
    queryFn: async () => id ? (await watchStateRepository.getCustomList(id)) ?? null : null,
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateCustomList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => watchStateRepository.createCustomList(name),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useDeleteCustomList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => watchStateRepository.deleteCustomList(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useAddToCustomList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, media }: { listId: string; media: CatalogMedia }) => watchStateRepository.addToCustomList(listId, media),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useRemoveFromCustomList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, identity }: { listId: string; identity: MediaIdentity }) => watchStateRepository.removeFromCustomList(listId, identity),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: watchKeys.lists }); },
  });
}

export function useViewingHistory(limit = 50) {
  return useQuery({ queryKey: [...watchKeys.history, limit], queryFn: () => watchStateRepository.getViewingHistory(limit) });
}

export function useUpcomingEpisodes() {
  return useQuery({ queryKey: [...watchKeys.all, 'upcoming'], queryFn: () => watchStateRepository.getUpcomingEpisodes() });
}

export function useUserRating(identity: MediaIdentity | undefined) {  return useQuery({
    queryKey: identity ? [...watchKeys.media(identity), 'rating'] : ['watch', 'rating', 'none'],
    queryFn: async () => identity ? (await watchStateRepository.getUserRating(identity)) ?? null : null,
    enabled: Boolean(identity),
  });
}

export function useUserRatings() {
  return useQuery({ queryKey: [...watchKeys.all, 'ratings'], queryFn: () => watchStateRepository.getUserRatings() });
}

export function useSetUserRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ media, rating, thumbs }: { media: CatalogMedia; rating: number | null; thumbs: -1 | 0 | 1 }) =>
      watchStateRepository.setUserRating(media, rating, thumbs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      scheduleAutoSync('mutation');
    },
  });
}

export function useClearAllRatings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => watchStateRepository.clearAllRatings(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      scheduleAutoSync('mutation');
    },
  });
}
