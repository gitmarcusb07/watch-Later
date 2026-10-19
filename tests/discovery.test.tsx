import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query/queryClient';
import { CatalogError } from '@/domain/errors/CatalogError';
import { mapTmdbMovie, mapTmdbTv } from '@/data/remote/tmdb/mappers';
import { mapAniListAnime } from '@/data/remote/anilist/mappers';
import { tmdbClient } from '@/data/remote/tmdb/client';
import { anilistClient } from '@/data/remote/anilist/client';
import { tvdbClient } from '@/data/remote/tvdb/client';
import { interleaveRanked, RemoteCatalogRepository, catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { languageName, countryName } from '@/features/catalog/metaNames';
import { useRecentlyReleased, useTrending } from '@/features/catalog/hooks';
import { pendingUpcomingItems, sortUpcomingBatch } from '@/features/catalog/upcomingStream';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const movieDto = (id: number, title: string, releaseDate: string) => ({
  id, title, overview: 'Story', poster_path: '/p.jpg', release_date: releaseDate, genres: [], vote_average: 7, vote_count: 10,
});
const tvDto = (id: number, name: string, airDate: string) => ({
  id, name, overview: 'Story', poster_path: '/p.jpg', first_air_date: airDate, genres: [], vote_average: 7, vote_count: 10,
});
const animeDto = (id: number, title: string, status?: string, year?: number) => ({
  id, title: { english: title }, coverImage: { large: 'https://img.example/c.jpg' }, genres: [],
  ...(status ? { status } : {}),
  ...(year ? { startDate: { year, month: 12, day: 1 } } : {}),
});

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

describe('live discovery endpoints', () => {
  beforeEach(() => { jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by discovery test')); });
  afterEach(() => jest.restoreAllMocks());

  it('requests real TMDb trending and release list endpoints', async () => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ results: [movieDto(1, 'A', '2026-01-01')] }));
    await tmdbClient.trendingMovies();
    expect(fetchSpy.mock.calls[0][0] as string).toContain('trending/movie/week');

    fetchSpy.mockResolvedValueOnce(response({ results: [tvDto(2, 'B', '2026-02-01')] }));
    await tmdbClient.trendingTv();
    expect(fetchSpy.mock.calls[1][0] as string).toContain('trending/tv/week');

    fetchSpy.mockResolvedValueOnce(response({ results: [movieDto(3, 'C', '2026-03-01')] }));
    await tmdbClient.nowPlayingMovies();
    expect(fetchSpy.mock.calls[2][0] as string).toContain('movie/now_playing');

    fetchSpy.mockResolvedValueOnce(response({ results: [tvDto(4, 'D', '2026-04-01')] }));
    await tmdbClient.onTheAirTv();
    expect(fetchSpy.mock.calls[3][0] as string).toContain('tv/on_the_air');

    fetchSpy.mockResolvedValueOnce(response({ results: [movieDto(5, 'E', '2026-12-01')] }));
    await tmdbClient.upcomingMovies();
    expect(fetchSpy.mock.calls[4][0] as string).toContain('movie/upcoming');

    fetchSpy.mockResolvedValueOnce(response({ results: [tvDto(6, 'F', '2026-12-01')] }));
    await tmdbClient.upcomingTvSeries();
    const upcomingTvUrl = fetchSpy.mock.calls[5][0] as string;
    expect(upcomingTvUrl).toContain('discover/tv');
    expect(upcomingTvUrl).toContain('first_air_date.gte');

    fetchSpy.mockResolvedValueOnce(response({ results: [tvDto(7, 'G', '2026-12-01')] }));
    await tmdbClient.airingTodayTv();
    expect(fetchSpy.mock.calls[6][0] as string).toContain('tv/airing_today');
  });

  it('requests AniList trending anime through the existing GraphQL client', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ data: { Page: { media: [animeDto(11, 'Anime A')] } } }));
    const media = await anilistClient.trendingAnime();
    expect(media).toMatchObject([{ id: 11 }]);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain('TRENDING_DESC');
  });

  it('requests upcoming anime with a not-yet-released status filter', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ data: { Page: { media: [animeDto(12, 'Anime B')] } } }));
    const media = await anilistClient.upcomingAnime();
    expect(media).toMatchObject([{ id: 12 }]);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain('NOT_YET_RELEASED');
  });

  it('requests paged trending, popular, discover, and bollywood endpoints', async () => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ results: [movieDto(20, 'T', '2026-01-01')], page: 2, total_pages: 10 }));
    await tmdbClient.trendingAll(2);
    expect(fetchSpy.mock.calls[0][0] as string).toContain('trending/all/week');
    expect(fetchSpy.mock.calls[0][0] as string).toContain('page=2');

    fetchSpy.mockResolvedValueOnce(response({ results: [], page: 1, total_pages: 1 }));
    await tmdbClient.popularMovies(1, 'IN');
    expect(fetchSpy.mock.calls[1][0] as string).toContain('movie/popular');
    expect(fetchSpy.mock.calls[1][0] as string).toContain('region=IN');

    fetchSpy.mockResolvedValueOnce(response({ results: [], page: 1, total_pages: 1 }));
    await tmdbClient.discoverMovies(1, { language: 'hi', region: 'IN' });
    const discoverUrl = fetchSpy.mock.calls[2][0] as string;
    expect(discoverUrl).toContain('discover/movie');
    expect(discoverUrl).toContain('with_original_language=hi');

    fetchSpy.mockResolvedValueOnce(response({ results: [], page: 1, total_pages: 1 }));
    await tmdbClient.discoverTv(3, { language: 'hi' });
    expect(fetchSpy.mock.calls[3][0] as string).toContain('page=3');
  });

  it('requests paged popular anime with page variables', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ data: { Page: { media: [animeDto(13, 'Anime C')], pageInfo: { hasNextPage: true, lastPage: 40 } } } }));
    const result = await anilistClient.popularAnime(2, 24);
    expect(result.media).toMatchObject([{ id: 13 }]);
    expect(result.hasNextPage).toBe(true);
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain('POPULARITY_DESC');
    expect(body).toContain('"page":2');
  });
});

describe('discovery repository', () => {
  afterEach(() => jest.restoreAllMocks());

  const tvdbMovie = (id: number, name: string, year: string, score: number, status = 'Released') => ({
    id, name, year, score, status: { name }, image: `/banners/v4/movie/${id}/posters/x.jpg`,
  });
  const tvdbSeries = (id: number, name: string, firstAired: string, year: string, score: number, status = 'Continuing') => ({
    id, name, firstAired, year, score, status: { name }, image: `/banners/posters/${id}-1.jpg`, originalLanguage: 'eng',
  });
  const tvdbLinks = (total: number, size = 500) => ({ total_items: total, page_size: size });

  function mockTvdbTrending() {
    jest.spyOn(tvdbClient, 'filterMovies').mockResolvedValue({ data: [tvdbMovie(1, 'Film A', '2026', 900), tvdbMovie(2, 'Film B', '2025', 100)], links: tvdbLinks(1000) } as never);
    jest.spyOn(tvdbClient, 'filterSeries').mockResolvedValue({ data: [tvdbSeries(3, 'Show C', '2026-02-01', '2026', 800)], links: tvdbLinks(1000) } as never);
  }

  it('interleaves ranked provider lists without fabricating identities', async () => {
    mockTvdbTrending();
    const trending = await new RemoteCatalogRepository().getTrending();
    expect(trending.map((item) => item.id)).toEqual(['tvdb:movie:1', 'tvdb:series:3', 'tvdb:movie:2']);
    expect(trending).toHaveLength(3);
    for (const item of trending) expect(item.posterUrl ?? item.title).toBeTruthy();
  });

  it('orders recent releases newest first and caps home sections', async () => {
    // Last-3-month window: global + Hindi + English discover plus AniList recent.
    jest.spyOn(tmdbClient, 'discoverMovies').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language === 'hi'
        ? [movieDto(5, 'New Film', '2026-09-18')]
        : (options as { language?: string })?.language === 'en' ? [] : [movieDto(5, 'New Film', '2026-09-18')],
    }));
    jest.spyOn(tmdbClient, 'discoverTv').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language
        ? []
        : [tvDto(7, 'New Show', '2026-08-15'), tvDto(6, 'Old Show', '2020-01-01')],
    }));
    jest.spyOn(anilistClient, 'recentAnimePage').mockResolvedValue({ media: [], hasNextPage: false });
    const recent = await new RemoteCatalogRepository().getRecentlyReleased();
    expect(recent.map((item) => item.id)).toEqual(['tmdb:movie:5', 'tmdb:series:7', 'tmdb:series:6']);
  });

  it('walks several now-playing pages so the full screen fills past fifteen', async () => {
    const movies = jest.spyOn(tmdbClient, 'discoverMovies').mockImplementation(async (page = 1) => ({
      results: page <= 2 ? [movieDto(100 + page, `Film P${page}`, `2026-09-0${page}`)] : [],
      total_pages: 5,
    }));
    jest.spyOn(tmdbClient, 'discoverTv').mockResolvedValue({ results: [], total_pages: 1 });
    jest.spyOn(anilistClient, 'recentAnimePage').mockResolvedValue({ media: [], hasNextPage: false });
    const recent = await new RemoteCatalogRepository().getRecentlyReleased();
    expect(movies.mock.calls.filter(([page = 1]) => page <= 2).length).toBeGreaterThanOrEqual(2);
    expect(recent.map((item) => item.id)).toEqual(['tmdb:movie:102', 'tmdb:movie:101']);
  });

  it('returns future-dated upcoming titles ordered oldest first', async () => {
    jest.spyOn(tmdbClient, 'upcomingMovies').mockImplementation(async (_page, region) => ({
      results: region === 'IN'
        ? [movieDto(8, 'Future Hindi Film', '2099-02-10')]
        : [movieDto(7, 'Future Hollywood Film', '2099-01-05')],
      total_pages: 3,
    }));
    jest.spyOn(tmdbClient, 'upcomingTvSeries').mockResolvedValue({
      results: [tvDto(9, 'Future Show', '2099-03-01')],
      total_pages: 2,
    });
    jest.spyOn(anilistClient, 'upcomingAnimePage').mockResolvedValue({
      media: [{ id: 10, title: { english: 'Future Anime' }, startDate: { year: 2099, month: 1, day: 20 }, format: 'TV', status: 'NOT_YET_RELEASED' }],
      hasNextPage: false,
      lastPage: 1,
    } as never);
    const upcoming = await new RemoteCatalogRepository().getUpcoming();
    // Hollywood + Bollywood + shows + anime, oldest first — every row carries
    // a full date from an English-title provider (TMDb / AniList).
    expect(upcoming.map((item) => item.id)).toEqual(['tmdb:movie:7', 'anilist:anime:10', 'tmdb:movie:8', 'tmdb:series:9']);
    const dates = upcoming.map((item) => item.releaseDate ?? '');
    expect([...dates].sort()).toEqual(dates);
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
  });

  it('pages upcoming feeds with real provider totals', async () => {
    jest.spyOn(tmdbClient, 'upcomingMovies').mockImplementation(async (page, region) => ({
      results: region === 'IN' ? [movieDto(40, 'Future Hindi Film', '2099-02-01')] : [movieDto(41, 'Future Hollywood Film', '2099-01-05')],
      page,
      total_pages: 4,
    }));
    jest.spyOn(tmdbClient, 'upcomingTvSeries').mockResolvedValue({
      results: [tvDto(42, 'Future Show', '2099-04-01')],
      page: 1,
      total_pages: 2,
    });
    jest.spyOn(anilistClient, 'upcomingAnimePage').mockResolvedValue({
      media: [{ id: 43, title: { english: 'Future Anime' }, startDate: { year: 2099, month: 7, day: 1 }, format: 'TV', status: 'NOT_YET_RELEASED' }],
      hasNextPage: false,
      lastPage: 1,
    } as never);
    const repo = new RemoteCatalogRepository();
    // Hollywood + Bollywood theatrical merged, oldest first.
    await expect(repo.getUpcomingMoviesPage(1)).resolves.toMatchObject({ page: 1, totalPages: 4, items: [{ id: 'tmdb:movie:41' }, { id: 'tmdb:movie:40' }] });
    await expect(repo.getUpcomingSeriesPage(1)).resolves.toMatchObject({ page: 1, totalPages: 2, items: [{ id: 'tmdb:series:42' }] });
    await expect(repo.getUpcomingAnimePage(1)).resolves.toMatchObject({ page: 1, totalPages: 1, items: [{ id: 'anilist:anime:43' }] });
    await expect(repo.getUpcomingMoviesPage(2)).resolves.toMatchObject({ page: 2, items: [{ id: 'tmdb:movie:41' }, { id: 'tmdb:movie:40' }] });
  });

  it('combines picker filters into one suggestion query', async () => {
    const discoverMovies = jest.spyOn(tmdbClient, 'discoverMovies').mockResolvedValue({
      results: [movieDto(50, 'Filtered Film', '2021-05-01')],
      total_pages: 3,
    });
    const page = await new RemoteCatalogRepository().getSuggestionPage(1, { source: 'flops', kind: 'movies', industry: 'bollywood', year: 2021, genreId: 18 });
    // One request carries the whole filter set: worst-rated, Hindi, 2021,
    // Drama — with the vote floor and score ceiling that keep flops honest.
    expect(discoverMovies).toHaveBeenCalledWith(1, expect.objectContaining({
      language: 'hi', withGenres: '18', sortBy: 'vote_average.asc',
      voteCountGte: 80, voteAverageLte: 4.8, primaryReleaseYear: 2021,
    }), undefined);
    expect(page).toMatchObject({ page: 1, totalPages: 3, items: [{ id: 'tmdb:movie:50' }] });
  });

  it('mixes movies, shows, and anime when the kind filter is all', async () => {
    jest.spyOn(tmdbClient, 'discoverMovies').mockResolvedValue({ results: [movieDto(60, 'Soon Movie', '2099-01-01')], total_pages: 5 });
    jest.spyOn(tmdbClient, 'discoverTv').mockResolvedValue({ results: [tvDto(61, 'Soon Show', '2099-02-01')], total_pages: 4 });
    jest.spyOn(anilistClient, 'suggestAnimePage').mockResolvedValue({
      media: [{ id: 62, title: { english: 'Soon Anime' }, startDate: { year: 2099, month: 3, day: 1 }, format: 'TV', status: 'NOT_YET_RELEASED' }],
      hasNextPage: false,
      lastPage: 1,
    } as never);
    const page = await new RemoteCatalogRepository().getSuggestionPage(1, { source: 'upcoming', kind: 'all', industry: 'all' });
    // Interleaved movie / show / anime — all genuinely unreleased.
    expect(page.items.map((item) => item.id)).toEqual(['tmdb:movie:60', 'tmdb:series:61', 'anilist:anime:62']);
    expect(page.totalPages).toBe(5);
  });

  it('pages trending-all and bollywood feeds with capped totals', async () => {
    jest.spyOn(tmdbClient, 'trendingMovies').mockResolvedValue({
      results: [movieDto(30, 'Trend Film', '2026-01-01'), movieDto(31, 'Second Film', '2026-02-01')], total_pages: 500,
    });
    jest.spyOn(tmdbClient, 'trendingTv').mockResolvedValue({
      results: [tvDto(32, 'Trend Show', '2026-03-01')], total_pages: 500,
    });
    const animeSpy = jest.spyOn(anilistClient, 'trendingAnime').mockResolvedValue([animeDto(33, 'Trend Anime')]);
    // Bollywood discover joins trending so Hindi titles are always present.
    const discoverForTrending = jest.spyOn(tmdbClient, 'discoverMovies').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language === 'hi' ? [movieDto(34, 'Hindi Trend', '2026-01-05')] : [],
      total_pages: 10,
    }));
    const discoverTvForTrending = jest.spyOn(tmdbClient, 'discoverTv').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language === 'hi' ? [tvDto(35, 'Hindi Trend Show', '2026-01-06')] : [],
      total_pages: 10,
    }));
    const trending = await new RemoteCatalogRepository().getTrendingAllPage(1);
    expect(trending.page).toBe(1);
    expect(trending.totalPages).toBe(20);
    // Movies, shows, Bollywood, and anime interleaved — every section's own content.
    expect(trending.items.map((item) => item.id)).toEqual(['tmdb:movie:30', 'tmdb:series:32', 'tmdb:movie:34', 'tmdb:series:35', 'anilist:anime:33', 'tmdb:movie:31']);
    expect(animeSpy).toHaveBeenCalledTimes(1);
    expect(discoverForTrending).toHaveBeenCalled();
    expect(discoverTvForTrending).toHaveBeenCalled();

    discoverForTrending.mockResolvedValue({
      results: [movieDto(40, 'Hindi Film', '2026-01-01')], total_pages: 12,
    });
    discoverTvForTrending.mockResolvedValue({
      results: [tvDto(41, 'Hindi Show', '2026-03-01')], total_pages: 8,
    });
    const bollywood = await new RemoteCatalogRepository().getBollywoodPage(1);
    // Hindi originals only — Hollywood and anime cannot leak in; series are
    // restricted to Indian OTT premieres with real traction (no TV soaps).
    expect(discoverForTrending).toHaveBeenCalledWith(1, { language: 'hi' }, undefined);
    expect(discoverTvForTrending).toHaveBeenCalledWith(1, {
      language: 'hi', watchRegion: 'IN', watchProviders: '8|119|122', voteCountGte: 40,
    }, undefined);
    expect(bollywood.items.map((item) => item.id).sort()).toEqual(['tmdb:movie:40', 'tmdb:series:41'].sort());
    expect(bollywood.totalPages).toBe(12);
  });

  it('serves movies, shows, and hollywood shelves from TMDB popularity', async () => {
    // Movies = Hollywood (en) + Bollywood (hi) interleaved; shows = English
    // + Hindi-OTT interleaved.
    jest.spyOn(tmdbClient, 'discoverMovies').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language === 'hi'
        ? [movieDto(51, 'Hindi Hit', '2026-01-01')]
        : [movieDto(50, 'Global Hit', '2026-01-01')],
      total_pages: 400,
    }));
    jest.spyOn(tmdbClient, 'discoverTv').mockImplementation(async (_page, options) => ({
      results: (options as { language?: string })?.language === 'hi'
        ? [tvDto(52, 'Hindi Show', '2026-02-01')]
        : [tvDto(51, 'Global Show', '2026-02-01')],
      total_pages: 300,
    }));
    const movies = await new RemoteCatalogRepository().getPopularMoviesPage(1);
    expect(movies.items.map((item) => item.id)).toEqual(['tmdb:movie:50', 'tmdb:movie:51']);
    expect(movies.totalPages).toBe(20);
    const shows = await new RemoteCatalogRepository().getPopularSeriesPage(1);
    expect(shows.items.map((item) => item.id)).toEqual(['tmdb:series:51', 'tmdb:series:52']);

    jest.spyOn(tmdbClient, 'discoverMovies').mockResolvedValue({
      results: [movieDto(60, 'Hollywood Film', '2026-01-01')], total_pages: 100,
    });
    jest.spyOn(tmdbClient, 'discoverTv').mockResolvedValue({
      results: [tvDto(61, 'Hollywood Show', '2026-02-01')], total_pages: 90,
    });
    const hollywood = await new RemoteCatalogRepository().getHollywoodPage(1);
    expect(hollywood.items.map((item) => item.id)).toEqual(['tmdb:movie:60', 'tmdb:series:61']);
  });

  it('resolves directors and age ratings from TMDb with regional fallback', async () => {
    jest.spyOn(tmdbClient, 'credits').mockResolvedValue({ crew: [{ name: 'A Director', job: 'Director' }, { name: 'A Director', job: 'Director' }, { name: 'A Writer', job: 'Writer' }] });
    jest.spyOn(tmdbClient, 'releaseDates').mockResolvedValue({ results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] });
    jest.spyOn(tmdbClient, 'contentRatings').mockResolvedValue({ results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] });
    const repo = new RemoteCatalogRepository();
    await expect(repo.getDirectors({ provider: 'tmdb', mediaType: 'movie', providerId: '1' })).resolves.toEqual(['A Director']);
    await expect(repo.getContentRating({ provider: 'tmdb', mediaType: 'movie', providerId: '1' })).resolves.toBe('PG-13');
    await expect(repo.getContentRating({ provider: 'tmdb', mediaType: 'series', providerId: '2' })).resolves.toBe('TV-MA');
    await expect(repo.getDirectors({ provider: 'anilist', mediaType: 'anime', providerId: '3' })).resolves.toEqual([]);
  });

  it('resolves TVDB cast, directors, ratings, and trailers from extended records', async () => {
    jest.spyOn(tvdbClient, 'getMovie').mockResolvedValue({
      id: 290272, name: 'Dune: Part Two', year: '2024',
      characters: [
        { personName: 'Timothee Chalamet', name: 'Paul Atreides', peopleType: 'Actor', image: '/banners/v4/actor/1/photo/x.jpg', sort: 1 },
        { personName: 'Denis Villeneuve', name: 'Denis Villeneuve', peopleType: 'Director', sort: 50 },
      ],
      contentRatings: [{ name: 'PG-13', country: 'usa' }],
      trailers: [{ name: 'Trailer', url: 'https://www.youtube.com/watch?v=Way9Dexny3w', language: 'eng' }],
    } as never);
    const repo = new RemoteCatalogRepository();
    const identity = { provider: 'tvdb', mediaType: 'movie', providerId: '290272' } as const;
    await expect(repo.getDirectors(identity)).resolves.toEqual(['Denis Villeneuve']);
    await expect(repo.getContentRating(identity)).resolves.toBe('PG-13');
    await expect(repo.getTrailerKey(identity)).resolves.toBe('Way9Dexny3w');
    await expect(repo.getMedia(identity)).resolves.toMatchObject({ id: 'tvdb:movie:290272', cast: [{ name: 'Timothee Chalamet' }] });
  });

  it('keeps provider-qualified identities distinct and tolerates a single failed provider', async () => {
    mockTvdbTrending();
    jest.spyOn(tvdbClient, 'filterSeries').mockResolvedValue({ data: [tvdbSeries(1, 'Show A', '2026-01-01', '2026', 700)], links: tvdbLinks(10) } as never);
    const trending = await new RemoteCatalogRepository().getTrending();
    // Same numeric ID, but movie vs series stay independent.
    expect(trending.map((item) => item.id).sort()).toEqual(['tvdb:movie:1', 'tvdb:movie:2', 'tvdb:series:1'].sort());
    jest.spyOn(tvdbClient, 'filterSeries').mockRejectedValue(new CatalogError('tvdb', 'network'));
    const partial = await new RemoteCatalogRepository().getTrending();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((item) => item.provider === 'tvdb')).toBe(true);
  });

  it('throws a safe error only when every provider fails', async () => {
    jest.spyOn(tvdbClient, 'filterMovies').mockRejectedValue(new CatalogError('tvdb', 'network'));
    jest.spyOn(tvdbClient, 'filterSeries').mockRejectedValue(new CatalogError('tvdb', 'network'));
    await expect(new RemoteCatalogRepository().getTrending()).rejects.toBeInstanceOf(CatalogError);
  });

  it('interleaveRanked is rank-aware, bounded, and provider-neutral', () => {
    const a = [mapTmdbMovie(movieDto(1, 'A', '2026-01-01')), mapTmdbMovie(movieDto(2, 'B', '2026-01-01'))];
    const b = [mapTmdbTv(tvDto(3, 'C', '2026-01-01'))];
    const c = [mapAniListAnime(animeDto(4, 'D'))];
    expect(interleaveRanked([a, b, c], 3).map((item) => item.id)).toEqual(['tmdb:movie:1', 'tmdb:series:3', 'anilist:anime:4']);
    expect(interleaveRanked([a, a, b], 10)).toHaveLength(3);
  });
});

describe('discovery hooks and home structure', () => {
  beforeEach(() => { queryClient.clear(); });
  afterEach(() => { queryClient.clear(); jest.restoreAllMocks(); });

  it('fetches each discovery feed once and serves cache on remount', async () => {
    // Fake timers neutralize TanStack stale/gc timeouts so teardown never hangs.
    jest.useFakeTimers();
    try {
      const trending = [mapTmdbMovie(movieDto(1, 'Film A', '2026-01-01'))];
      const recent = [mapTmdbTv(tvDto(2, 'Show B', '2026-02-01'))];
      const trendingSpy = jest.spyOn(catalogRepository, 'getTrending').mockResolvedValue(trending);
      const recentSpy = jest.spyOn(catalogRepository, 'getRecentlyReleased').mockResolvedValue(recent);
      const Probe = () => {
        const t = useTrending();
        const r = useRecentlyReleased();
        if (t.isLoading || r.isLoading) return <Text>loading</Text>;
        return <Text>{[...(t.data ?? []), ...(r.data ?? [])].map((item) => item.title).join(',')}</Text>;
      };
      let first!: ReturnType<typeof create>;
      let second!: ReturnType<typeof create>;
      await act(async () => { first = create(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>); });
      await act(async () => { await jest.advanceTimersByTimeAsync(10); });
      await act(async () => { await jest.advanceTimersByTimeAsync(10); });
      expect(JSON.stringify(first.toJSON())).toContain('Film A');
      await act(async () => { second = create(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>); });
      await act(async () => { await jest.advanceTimersByTimeAsync(10); });
      expect(trendingSpy).toHaveBeenCalledTimes(1);
      expect(recentSpy).toHaveBeenCalledTimes(1);
      await act(async () => { first.unmount(); second.unmount(); });
    } finally {
      jest.useRealTimers();
    }
  });

  it('home focuses on continue watching plus live catalog shelves', () => {
    const home = readFileSync('app/(tabs)/index.tsx', 'utf8');
    expect(home).toMatch(/Continue Watching/);
    expect(home).toMatch(/New Releases/);
    expect(home).toMatch(/Top 100/);
    expect(home).toMatch(/\/media\/\[id\]/);
    expect(home).not.toMatch(/Your Watchlist/);
    expect(home).not.toMatch(/Most Interested/);
    expect(home).not.toMatch(/Trending Now/);
    expect(home).not.toMatch(/Talk Of The Town/);
    expect(home).not.toMatch(/title="Bollywood"/);
  });

  it('detail groups every action in one compact cluster with Moctale-style info', () => {
    const detail = readFileSync('app/media/[id].tsx', 'utf8');
    expect(detail).toMatch(/DetailActions/);
    expect(detail).toMatch(/Directed By/);
    expect(detail).toMatch(/Age Rating/);
    expect(detail).not.toMatch(/StatusPicker/);
    expect(detail).not.toMatch(/collections\/pick/);
    expect(detail).not.toMatch(/RatingSheet/);
  });
});

describe('metadata display names', () => {
  it('maps language and country codes to readable names with safe fallbacks', () => {
    expect(languageName('hi')).toBe('Hindi');
    expect(languageName('en')).toBe('English');
    expect(languageName('xx')).toBe('XX');
    expect(languageName(undefined)).toBeUndefined();
    expect(countryName('IN')).toBe('India');
    expect(countryName('US')).toBe('USA');
    expect(countryName('ZZ')).toBe('ZZ');
    expect(countryName(undefined)).toBeUndefined();
  });
});

describe('upcoming stream merge', () => {
  const media = (id: number, date: string) => mapTmdbMovie(movieDto(id, `Film ${id}`, date));

  it('emits every unseen page row once, across feeds, in page order', () => {
    const feeds = [
      { data: { pages: [{ items: [media(1, '2099-01-10'), media(2, '2099-01-05')], page: 1, totalPages: 3 }] } },
      // The second feed repeats row 2 (already emitted in this batch) and
      // repeats row 3, which the screen has already shown.
      { data: { pages: [{ items: [media(2, '2099-01-05'), media(3, '2099-01-01')], page: 1, totalPages: 2 }] } },
    ];
    const pending = pendingUpcomingItems(feeds, new Set(['tmdb:movie:3']));
    expect(pending.map((item) => item.id)).toEqual(['tmdb:movie:1', 'tmdb:movie:2']);
  });

  it('sorts inside one arriving batch and sinks undated rows to its bottom', () => {
    const batch = [media(4, '2099-03-01'), media(5, '2099-01-01'), media(6, '')];
    expect(sortUpcomingBatch(batch).map((item) => item.id)).toEqual(['tmdb:movie:5', 'tmdb:movie:4', 'tmdb:movie:6']);
    expect(batch.map((item) => item.id)).toEqual(['tmdb:movie:4', 'tmdb:movie:5', 'tmdb:movie:6']);
  });
});
