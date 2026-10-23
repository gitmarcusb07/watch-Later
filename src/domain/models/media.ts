export type MediaProvider = 'tmdb' | 'anilist' | 'tvdb';
export type CatalogMediaType = 'movie' | 'series' | 'anime';

export interface MediaIdentity {
  provider: MediaProvider;
  mediaType: CatalogMediaType;
  providerId: string;
}

export interface MediaGenre {
  id?: number;
  name: string;
}

export interface MediaCastMember {
  /** Real name of the performer. */
  name: string;
  /** Character played, when known. */
  character?: string;
  /** Headshot URL, when known. */
  imageUrl?: string;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  airDate?: string;
  posterUrl?: string;
  /**
   * Anime-only: AniList entries split cours/seasons into separate nodes, so a
   * season can point at a different provider entry (and MAL id) than the
   * title that was opened. TMDb seasons never set these.
   */
  refProviderId?: string;
  refMalId?: number;
  /**
   * Anime-only: TMDB series backing this season when the title resolved to
   * TMDB (titles/posters/seasons from TMDB). Episode fetching tries TMDB
   * first via this id, then falls back to the AniList refs above.
   */
  refTmdbSeriesId?: string;
  /**
   * Anime-only: exact future broadcast dates AniList already knows about
   * (`airingSchedule` / `nextAiringEpisode`). Providers like Kitsu and Jikan
   * stop at aired episodes, so these keep episode 3+ dated while a season is
   * still airing.
   */
  futureEpisodes?: { episodeNumber: number; airDate: string }[];
}

export interface CatalogMedia extends MediaIdentity {
  /** Provider-qualified stable ID; never use a provider's numeric ID alone. */
  id: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  year?: number;
  genres: MediaGenre[];
  rating?: number;
  voteCount?: number;
  runtimeMinutes?: number;
  status?: string;
  language?: string;
  originCountries?: string[];
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  seasonSummaries?: SeasonSummary[];
  animeFormat?: string;
  animeSeason?: string;
  popularity?: number;
  studios?: string[];
  /** MyAnimeList ID for anime (from AniList). Used to fetch episode lists. */
  malId?: number;
  /** TMDb numeric id bridged from TVDB remote IDs. Unlocks TMDb ratings and watch providers for TVDB titles. */
  tmdbRefId?: string;
  episodeMetadata: 'available' | 'unavailable';
  imdbId?: string;
  trailerKey?: string;
  watchProviders?: WatchProviderGroup[];
  /** Top-billed cast with headshots (TVDB titles). Empty when unknown. */
  cast?: MediaCastMember[];
  /** Director names (TVDB titles). Empty when unknown. */
  directors?: string[];
  /** Age-rating certification (TVDB titles, e.g. "TV-MA"). Undefined when unknown. */
  contentRating?: string;
}

export interface WatchProvider {
  id: number;
  name: string;
  logoUrl?: string;
}

export interface WatchProviderGroup {
  category: 'stream' | 'rent' | 'buy';
  providers: WatchProvider[];
}

export interface MediaEpisode extends MediaIdentity {
  /** Identity of the parent series/anime. */
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  airDate?: string;
  stillUrl?: string;
  runtimeMinutes?: number;
  episodeType?: string;
}

export interface CatalogSeason {
  series: MediaIdentity;
  seasonNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  posterUrl?: string;
  episodes: MediaEpisode[];
}

/**
 * Search facets: a media type, everything, or content state ("upcoming" cuts
 * the merged results to future releases — it is not a media type).
 */
export type CatalogFilter = 'all' | 'movies' | 'series' | 'anime' | 'upcoming';

export interface CatalogSearchResult {
  items: CatalogMedia[];
  unavailableProviders: MediaProvider[];
}
