import type { CatalogFilter, CatalogMedia, CatalogSeason, CatalogSearchResult, MediaIdentity, SeasonSummary, WatchProviderGroup } from '@/domain/models/media';
import type { GlobalHitsLive, HitsMediaType } from '@/features/hits/types';
import type { HitsPeriodType } from '@/features/hits/period';

export interface CatalogRepository {
  search(query: string, filter: CatalogFilter, signal?: AbortSignal): Promise<CatalogSearchResult>;
  getMedia(identity: MediaIdentity, signal?: AbortSignal): Promise<CatalogMedia>;
  getSeason(identity: MediaIdentity, seasonNumber: number, signal?: AbortSignal): Promise<CatalogSeason>;
  /** Anime season resolved from its own summary refs (entry + MAL id) without walking the chain. */
  getAnimeSeasonByRef(identity: MediaIdentity, summary: SeasonSummary, signal?: AbortSignal): Promise<CatalogSeason>;
  /** Live ranked discovery: current trending movies, series, and anime. */
  getTrending(signal?: AbortSignal): Promise<CatalogMedia[]>;
  /** Live discovery: recently released movies and currently airing series. */
  getRecentlyReleased(signal?: AbortSignal): Promise<CatalogMedia[]>;
  /** The 100 most-loved released titles (favorite counts), best first. */
  getTopRated(signal?: AbortSignal): Promise<CatalogMedia[]>;
  /** Live discovery: upcoming movies, series, and anime (future releases only). */
  getUpcoming(signal?: AbortSignal): Promise<CatalogMedia[]>;
  /** Global Hits live preview: TMDB popularity ranking for one period (movies or series). */
  getGlobalHitsLive(type: HitsPeriodType, key: string, media: HitsMediaType, signal?: AbortSignal): Promise<GlobalHitsLive>;
  /** YouTube trailer key for TMDb titles, if the provider has one. */
  getTrailerKey(identity: MediaIdentity, signal?: AbortSignal): Promise<string | undefined>;
  /** Region-aware watch providers for TMDb titles. */
  getWatchProviders(identity: MediaIdentity, signal?: AbortSignal): Promise<WatchProviderGroup[]>;
  /**
   * Watch providers for an explicit region (e.g. `IN`). No fallback to
   * another region: availability elsewhere never implies availability here.
   * This reports CURRENT availability only — never a future premiere.
   */
  getWatchProvidersForRegion(identity: MediaIdentity, region: string, signal?: AbortSignal): Promise<WatchProviderGroup[]>;
  /** Director names for TMDb titles (first-billed first). Empty when unknown. */
  getDirectors(identity: MediaIdentity, signal?: AbortSignal): Promise<string[]>;
  /** Age-rating certification for TMDb titles (e.g. "16+", "PG-13"). Undefined when unknown. */
  getContentRating(identity: MediaIdentity, signal?: AbortSignal): Promise<string | undefined>;
  /** Paged mixed trending feed (movies + series), newest pages first. */
  getTrendingAllPage(page: number, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged popular movies, optionally biased to a region (e.g. device region for local content). */
  getPopularMoviesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged popular series, optionally biased to a region. */
  getPopularSeriesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged Hindi movies + shows (Bollywood), most popular first. */
  getBollywoodPage(page: number, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged English-language movies + shows (Hollywood), most popular first. */
  getHollywoodPage(page: number, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged popular anime, most popular first. */
  getPopularAnimePage(page: number, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged upcoming movies (TMDb), oldest release date first. */
  getUpcomingMoviesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged upcoming series (TMDb discover with an air-date floor), oldest first. */
  getUpcomingSeriesPage(page: number, region?: string, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged not-yet-released anime (AniList open API), most popular first. */
  getUpcomingAnimePage(page: number, signal?: AbortSignal): Promise<PagedCatalog>;
  /** Paged titles for one genre, scoped to a shelf (`all`, `movies`, `shows`, `anime`). */
  getGenrePage(page: number, genreId: number, kind: GenrePageKind, signal?: AbortSignal): Promise<PagedCatalog>;
  /**
   * One page of combined creator-picker suggestions: a ranking source
   * narrowed by any mix of kind, industry, year, and genre. Every slice is
   * built from the same provider queries the browse shelves use, so a
   * suggestion rail can never invent a title or a score.
   */
  getSuggestionPage(page: number, filters: SuggestionFilters, signal?: AbortSignal): Promise<PagedCatalog>;
}

/** Which shelf of a genre screen is showing. */
export type GenrePageKind = 'all' | 'movies' | 'shows' | 'anime';

/** Which ranking a picker suggestion rail shows. */
export type SuggestionSource = 'popular' | 'top-rated' | 'flops' | 'new' | 'upcoming';

/** Which media kinds a rail includes. `all` mixes movies + shows (+ anime on page one). */
export type SuggestionKind = 'all' | 'movies' | 'shows' | 'anime';

/** Language scope: Hollywood = English originals, Bollywood = Hindi originals. */
export type SuggestionIndustry = 'all' | 'hollywood' | 'bollywood';

export interface SuggestionFilters {
  source: SuggestionSource;
  kind: SuggestionKind;
  industry: SuggestionIndustry;
  /** Release year (movies) / first-air year (shows) / season year (anime). */
  year?: number;
  /** TMDb genre id from the app's genre grid. */
  genreId?: number;
}

export interface PagedCatalog {
  items: CatalogMedia[];
  page: number;
  totalPages: number;
}
