import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CatalogFilter, CatalogMedia, CatalogSeason, MediaIdentity, SeasonSummary } from '@/domain/models/media';
import type { PagedCatalog, SuggestionFilters } from '@/domain/repositories/CatalogRepository';
import { catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { deviceRegion } from '@/data/remote/catalog/region';
import { parseMediaRouteId } from '@/features/catalog/mediaIdentity';
import { fetchImdbTop } from '@/data/remote/supabase/imdbRatings';
import { fetchImdbRatingsFor, type ImdbRating } from '@/data/remote/supabase/imdbRatings';
import { queryClient } from '@/lib/query/queryClient';

export function useCatalogSearch(query: string, filter: CatalogFilter, enabled: boolean) {
  const normalized = query.trim();
  return useQuery({
    queryKey: ['catalog', 'search', normalized, filter] as const,
    queryFn: ({ signal }) => catalogRepository.search(normalized, filter, signal),
    enabled: enabled && normalized.length > 0,
    // Keep the last good results on screen across query changes and failures
    // so a flaky network shows stale results with a retry affordance.
    placeholderData: keepPreviousData,
    // Keep recent searches warm; the screen-level 320ms debounce plus
    // `enabled` gating already prevents request storms and stale replacement.
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function catalogMediaOptions(identity: MediaIdentity | undefined) {
  return {
    queryKey: identity ? ['catalog', identity.provider, identity.mediaType, identity.providerId] as const : ['catalog', 'invalid'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => identity ? catalogRepository.getMedia(identity, signal) : Promise.reject(new Error('Invalid media identity')),
    enabled: Boolean(identity),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  };
}

export function useCatalogMedia(identity: MediaIdentity | undefined) {
  return useQuery(catalogMediaOptions(identity));
}

/**
 * Starts the detail fetch the moment a poster is tapped, so the next screen
 * opens onto data that has been travelling during the transition instead of a
 * blank skeleton. Same cache entry `useCatalogMedia` reads — a hit is free.
 */
export function prefetchMedia(routeId: string): void {
  const identity = parseMediaRouteId(routeId);
  if (!identity) return;
  const { queryKey, queryFn, staleTime, gcTime } = catalogMediaOptions(identity);
  void queryClient.prefetchQuery({ queryKey, queryFn, staleTime, gcTime });
}

/**
 * The season payload query, shared by `useCatalogSeason` and by callers that
 * need the same cached entry on demand — the collapsed season checkbox pulls
 * it so it can toggle without first expanding the card.
 */
export function catalogSeasonOptions(identity: MediaIdentity | undefined, seasonNumber: number | undefined, summary?: SeasonSummary) {
  const enabled = Boolean(
    identity && seasonNumber !== undefined
    && ((identity.provider === 'tmdb' && identity.mediaType === 'series')
      || (identity.provider === 'anilist' && identity.mediaType === 'anime')
      || (identity.provider === 'tvdb' && identity.mediaType !== 'movie')),
  );
  const refKey = identity?.provider === 'anilist' ? (summary?.refProviderId ?? '') : '';
  const queryKey = identity && seasonNumber !== undefined
    ? ['catalog', identity.provider, identity.mediaType, identity.providerId, 'season', seasonNumber, refKey] as const
    : ['catalog', 'season', 'disabled'] as const;
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    if (!identity || seasonNumber === undefined) return Promise.reject(new Error('Invalid season identity'));
    // Anime seasons resolve from their own summary refs without re-walking
    // the AniList chain, so expanding stays to a single cheap request.
    if (identity.provider === 'anilist' && identity.mediaType === 'anime' && summary) {
      return catalogRepository.getAnimeSeasonByRef(identity, summary, signal);
    }
    return catalogRepository.getSeason(identity, seasonNumber, signal);
  };
  return { queryKey, queryFn, enabled, staleTime: 10 * 60_000, gcTime: 30 * 60_000 };
}

export function useCatalogSeason(identity: MediaIdentity | undefined, seasonNumber: number | undefined, summary?: SeasonSummary) {
  return useQuery(catalogSeasonOptions(identity, seasonNumber, summary));
}

/**
 * Awaits a season payload, reusing the `useCatalogSeason` cache entry so an
 * on-demand load and an expanded card never fetch the same season twice.
 */
export async function fetchCatalogSeason(identity: MediaIdentity, seasonNumber: number, summary?: SeasonSummary): Promise<CatalogSeason> {
  return queryClient.fetchQuery(catalogSeasonOptions(identity, seasonNumber, summary));
}

export function useTrending(enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'trending'] as const,
    queryFn: ({ signal }) => catalogRepository.getTrending(signal),
    enabled,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useRecentlyReleased(enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'recently-released'] as const,
    queryFn: ({ signal }) => catalogRepository.getRecentlyReleased(signal),
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useTopRated() {
  return useQuery({
    queryKey: ['catalog', 'top-rated'] as const,
    queryFn: ({ signal }) => catalogRepository.getTopRated(signal),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useUpcomingCatalog(enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'upcoming'] as const,
    queryFn: ({ signal }) => catalogRepository.getUpcoming(signal),
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useTrailerKey(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? ['catalog', 'trailer', identity.provider, identity.mediaType, identity.providerId] as const : ['catalog', 'trailer', 'none'],
    // TanStack Query v5 rejects `undefined` results — normalize "no trailer"
    // to null so unrated/trailerless titles render instead of red-boxing.
    queryFn: ({ signal }) => identity ? catalogRepository.getTrailerKey(identity, signal).then((key) => key ?? null) : Promise.resolve(null),
    enabled: Boolean(identity && identity.provider === 'tmdb' && identity.mediaType !== 'anime'),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useWatchProviders(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? ['catalog', 'providers', identity.provider, identity.mediaType, identity.providerId] as const : ['catalog', 'providers', 'none'],
    queryFn: ({ signal }) => identity ? catalogRepository.getWatchProviders(identity, signal) : Promise.resolve([]),
    enabled: Boolean(identity && identity.provider === 'tmdb' && identity.mediaType !== 'anime'),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useMediaCredits(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? ['catalog', 'credits', identity.provider, identity.mediaType, identity.providerId] as const : ['catalog', 'credits', 'none'],
    queryFn: ({ signal }) => identity ? catalogRepository.getDirectors(identity, signal) : Promise.resolve([]),
    enabled: Boolean(identity && identity.provider === 'tmdb' && identity.mediaType !== 'anime'),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useContentRating(identity: MediaIdentity | undefined) {
  return useQuery({
    queryKey: identity ? ['catalog', 'content-rating', identity.provider, identity.mediaType, identity.providerId] as const : ['catalog', 'content-rating', 'none'],
    // Same undefined-guard as trailers: titles without a certification
    // resolve null and simply hide the rating row.
    queryFn: ({ signal }) => identity ? catalogRepository.getContentRating(identity, signal).then((rating) => rating ?? null) : Promise.resolve(null),
    enabled: Boolean(identity && identity.provider === 'tmdb' && identity.mediaType !== 'anime'),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

/**
 * Best-of-breed enrichment for TVDB titles: TMDb score/votes and watch
 * providers, bridged through the TMDb id TVDB itself records. Anime tries
 * the series record first, then the movie record (anime films live there).
 * Never throws — callers fall back to whatever the base payload has.
 */
export function useTmdbEnrichment(media: CatalogMedia | null | undefined) {
  const tmdbId = media?.tmdbRefId;
  const kinds = media?.mediaType === 'movie' ? (['movie'] as const) : (['series', 'movie'] as const);
  return useQuery({
    queryKey: tmdbId ? ['catalog', 'tmdb-enrichment', tmdbId] as const : ['catalog', 'tmdb-enrichment', 'none'],
    queryFn: async ({ signal }) => {
      if (!tmdbId) return { rating: undefined as number | undefined, voteCount: undefined as number | undefined, providers: [] as Awaited<ReturnType<typeof catalogRepository.getWatchProviders>> };
      for (const kind of kinds) {
        const identity: MediaIdentity = { provider: 'tmdb', mediaType: kind, providerId: tmdbId };
        try {
          const [details, providers] = await Promise.all([
            catalogRepository.getMedia(identity, signal),
            catalogRepository.getWatchProviders(identity, signal).catch(() => [] as Awaited<ReturnType<typeof catalogRepository.getWatchProviders>>),
          ]);
          return { rating: details.rating, voteCount: details.voteCount, providers };
        } catch {
          // Wrong TMDb kind (anime film vs series) — try the next one.
        }
      }
      return { rating: undefined as number | undefined, voteCount: undefined as number | undefined, providers: [] as Awaited<ReturnType<typeof catalogRepository.getWatchProviders>> };
    },
    enabled: Boolean(tmdbId),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
}

export function useInfiniteCatalog(key: readonly (string | number)[], fetchPage: (page: number, signal?: AbortSignal) => Promise<PagedCatalog>, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
    // Changing scope/tab keeps the last good grid on screen instead of
    // flashing an empty skeleton while the new pages load.
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    enabled,
  });
}

export function useTrendingAllPages(enabled = true) {
  return useInfiniteCatalog(['catalog', 'browse', 'trending', 'tmdb'], (page, signal) => catalogRepository.getTrendingAllPage(page, signal), enabled);
}

export function usePopularMoviesPages(enabled = true) {
  const region = deviceRegion();
  return useInfiniteCatalog(['catalog', 'browse', 'movies', region, 'tmdb'], (page, signal) => catalogRepository.getPopularMoviesPage(page, region, signal), enabled);
}

export function usePopularSeriesPages(enabled = true) {
  const region = deviceRegion();
  return useInfiniteCatalog(['catalog', 'browse', 'shows', region, 'tmdb'], (page, signal) => catalogRepository.getPopularSeriesPage(page, region, signal), enabled);
}

export function useBollywoodPages(enabled = true) {
  return useInfiniteCatalog(['catalog', 'browse', 'bollywood', 'tmdb'], (page, signal) => catalogRepository.getBollywoodPage(page, signal), enabled);
}

export function useHollywoodPages(enabled = true) {
  return useInfiniteCatalog(['catalog', 'browse', 'hollywood'], (page, signal) => catalogRepository.getHollywoodPage(page, signal), enabled);
}

export function usePopularAnimePages(enabled = true) {
  // Key revision: the anime browse source moved from TVDB to AniList, so old
  // cached TVDB pages (Japanese names) must never render again.
  return useInfiniteCatalog(['catalog', 'browse', 'anime', 'anilist'], (page, signal) => catalogRepository.getPopularAnimePage(page, signal), enabled);
}

export function useUpcomingMoviesPages(enabled = true) {
  const region = deviceRegion();
  return useInfiniteCatalog(['catalog', 'upcoming', 'movies', region], (page, signal) => catalogRepository.getUpcomingMoviesPage(page, region, signal), enabled);
}

/**
 * Creator picker suggestions: one paged query carrying the full filter set
 * (source × kind × industry × year × genre). The key carries every filter,
 * so each combination stays cached and instantly restorable when the user
 * flips back to it. Keys live under `catalog/picker` so they never collide
 * with browse shelves.
 */
export function useSuggestionPages(filters: SuggestionFilters, enabled = true) {
  return useInfiniteCatalog(
    ['catalog', 'picker', filters.source, filters.kind, filters.industry, filters.year ?? 'all', filters.genreId ?? 'all'],
    (page, signal) => catalogRepository.getSuggestionPage(page, filters, signal),
    enabled,
  );
}

export function useUpcomingSeriesPages(enabled = true) {
  const region = deviceRegion();
  return useInfiniteCatalog(['catalog', 'upcoming', 'series', region], (page, signal) => catalogRepository.getUpcomingSeriesPage(page, region, signal), enabled);
}

export function useUpcomingAnimePages(enabled = true) {
  return useInfiniteCatalog(['catalog', 'upcoming', 'anime'], (page, signal) => catalogRepository.getUpcomingAnimePage(page, signal), enabled);
}

/** Weekly IMDb Top 250 snapshot from Supabase. Empty when offline or not yet published. */
export function useImdbTop(media: 'movie' | 'series', enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'imdb-top', media] as const,
    queryFn: () => fetchImdbTop(media),
    enabled,
    // Weekly snapshot: a day of staleness keeps repeat visits free.
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: 1,
  });
}

/** IMDb scores for visible titles, keyed `mediaType:tmdbId`. Decoration only — never blocks lists. */
export function useImdbRatingsFor(items: { tmdbId: number; mediaType: 'movie' | 'series' }[], enabled = true) {
  const key = items.map((item) => `${item.mediaType}:${item.tmdbId}`).sort().join(',');
  return useQuery({
    queryKey: ['catalog', 'imdb-ratings', key] as const,
    queryFn: (): Promise<Map<string, ImdbRating>> => fetchImdbRatingsFor(items),
    enabled: enabled && items.length > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: 1,
  });
}
