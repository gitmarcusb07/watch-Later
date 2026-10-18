import { CatalogError } from '@/domain/errors/CatalogError';
import { catalogConfig, getTmdbApiKey } from '@/data/remote/catalog/config';
import { requestJson, withQuery } from '@/data/remote/catalog/request';
import type { TmdbContentRatingsDto, TmdbCreditsDto, TmdbListDto, TmdbMovieDto, TmdbReleaseDatesDto, TmdbSeasonDto, TmdbTrendingAllDto, TmdbTvDto, TmdbVideosDto, TmdbWatchProvidersDto } from './types';

export function buildTmdbUrl(path: string, values: Record<string, string | number | undefined> = {}, apiKey = getTmdbApiKey()): string {
  if (!apiKey) throw new CatalogError('tmdb', 'configuration');
  return withQuery(`${catalogConfig.tmdbBase.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, { ...values, api_key: apiKey });
}

export const tmdbClient = {
  async searchMovies(query: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('search/movie', { query, include_adult: 'false' }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async searchTv(query: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('search/tv', { query }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async getMovie(id: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbMovieDto>('tmdb', buildTmdbUrl(`movie/${encodeURIComponent(id)}`), {}, signal);
    if (!response || !Number.isSafeInteger(response.id) || typeof response.title !== 'string') throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async getTv(id: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbTvDto>('tmdb', buildTmdbUrl(`tv/${encodeURIComponent(id)}`), {}, signal);
    if (!response || !Number.isSafeInteger(response.id) || typeof response.name !== 'string') throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async getSeason(id: string, seasonNumber: number, signal?: AbortSignal) {
    const response = await requestJson<TmdbSeasonDto>('tmdb', buildTmdbUrl(`tv/${encodeURIComponent(id)}/season/${seasonNumber}`), {}, signal);
    if (!response || !Number.isSafeInteger(response.id) || !Number.isSafeInteger(response.season_number) || typeof response.name !== 'string') throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async trendingMovies(signal?: AbortSignal, page = 1) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('trending/movie/week', { page }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async trendingTv(signal?: AbortSignal, page = 1) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('trending/tv/week', { page }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async trendingAll(page = 1, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTrendingAllDto>>('tmdb', buildTmdbUrl('trending/all/week', { page }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async popularMovies(page = 1, region?: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('movie/popular', { page, region }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async popularTv(page = 1, region?: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('tv/popular', { page, region }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async topRatedMovies(page = 1, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('movie/top_rated', { page: Math.max(1, page) }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async topRatedTv(page = 1, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('tv/top_rated', { page: Math.max(1, page) }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async discoverMovies(page = 1, options: { language?: string; region?: string; releaseDateGte?: string; releaseDateLte?: string; withGenres?: string; sortBy?: string; voteCountGte?: number; primaryReleaseYear?: number } = {}, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('discover/movie', {
      page, sort_by: options.sortBy ?? 'popularity.desc', include_adult: 'false', include_video: 'false',
      with_original_language: options.language, region: options.region,
      'primary_release_date.gte': options.releaseDateGte, 'primary_release_date.lte': options.releaseDateLte,
      with_genres: options.withGenres, 'vote_count.gte': options.voteCountGte,
      primary_release_year: options.primaryReleaseYear,
    }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async discoverTv(page = 1, options: { language?: string; region?: string; firstAirDateGte?: string; firstAirDateLte?: string; watchRegion?: string; watchProviders?: string; voteCountGte?: number; withGenres?: string; sortBy?: string; firstAirDateYear?: number } = {}, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('discover/tv', {
      page, sort_by: options.sortBy ?? 'popularity.desc', include_adult: 'false',
      with_original_language: options.language, region: options.region,
      'first_air_date.gte': options.firstAirDateGte, 'first_air_date.lte': options.firstAirDateLte,
      include_null_first_air_dates: 'false',
      watch_region: options.watchRegion, with_watch_providers: options.watchProviders, 'vote_count.gte': options.voteCountGte,
      with_genres: options.withGenres, first_air_date_year: options.firstAirDateYear,
    }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async nowPlayingMovies(signal?: AbortSignal, page = 1) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('movie/now_playing', { page: Math.max(1, page) }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async onTheAirTv(signal?: AbortSignal, page = 1) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('tv/on_the_air', { page: Math.max(1, page) }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async upcomingMovies(page = 1, region?: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbMovieDto>>('tmdb', buildTmdbUrl('movie/upcoming', { page: Math.max(1, page), region }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  /** Future premieres, oldest first — TMDb has no "upcoming TV" list, so this is discover with an air-date floor. */
  async upcomingTvSeries(page = 1, region?: string, signal?: AbortSignal) {
    const today = new Date();
    const floor = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('discover/tv', {
      page: Math.max(1, page), sort_by: 'first_air_date.asc', 'first_air_date.gte': floor,
      include_adult: 'false', include_null_first_air_dates: 'false', region,
    }), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async airingTodayTv(signal?: AbortSignal) {
    const response = await requestJson<TmdbListDto<TmdbTvDto>>('tmdb', buildTmdbUrl('tv/airing_today'), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async videos(mediaType: 'movie' | 'series', id: string, signal?: AbortSignal) {
    const path = mediaType === 'movie' ? `movie/${encodeURIComponent(id)}/videos` : `tv/${encodeURIComponent(id)}/videos`;
    const response = await requestJson<TmdbVideosDto>('tmdb', buildTmdbUrl(path), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async watchProviders(mediaType: 'movie' | 'series', id: string, signal?: AbortSignal) {
    const path = mediaType === 'movie' ? `movie/${encodeURIComponent(id)}/watch/providers` : `tv/${encodeURIComponent(id)}/watch/providers`;
    const response = await requestJson<TmdbWatchProvidersDto>('tmdb', buildTmdbUrl(path), {}, signal);
    if (!response || typeof response.results !== 'object') throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async credits(mediaType: 'movie' | 'series', id: string, signal?: AbortSignal) {
    const path = mediaType === 'movie' ? `movie/${encodeURIComponent(id)}/credits` : `tv/${encodeURIComponent(id)}/credits`;
    const response = await requestJson<TmdbCreditsDto>('tmdb', buildTmdbUrl(path), {}, signal);
    if (!response || (!Array.isArray(response.cast) && !Array.isArray(response.crew))) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async releaseDates(id: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbReleaseDatesDto>('tmdb', buildTmdbUrl(`movie/${encodeURIComponent(id)}/release_dates`), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
  async contentRatings(id: string, signal?: AbortSignal) {
    const response = await requestJson<TmdbContentRatingsDto>('tmdb', buildTmdbUrl(`tv/${encodeURIComponent(id)}/content_ratings`), {}, signal);
    if (!response || !Array.isArray(response.results)) throw new CatalogError('tmdb', 'invalid_response');
    return response;
  },
};
