import { CatalogError } from '@/domain/errors/CatalogError';
import type { CatalogMedia } from '@/domain/models/media';
import { animeEntriesToSummaries, animeSeasonEntries, mapAniListAnime, plainDescription } from '@/data/remote/anilist/mappers';
import { anilistClient } from '@/data/remote/anilist/client';
import { jikanClient } from '@/data/remote/jikan/client';
import { imageUrl } from '@/data/remote/catalog/config';
import { requestJson } from '@/data/remote/catalog/request';
import { RemoteCatalogRepository, mergeCatalogResults } from '@/data/remote/catalog/RemoteCatalogRepository';
import { rankSearchResults, searchMatchTier } from '@/data/remote/catalog/searchRank';
import { mapTmdbMovie, mapTmdbSeason, mapTmdbTv } from '@/data/remote/tmdb/mappers';
import { buildTmdbUrl, tmdbClient } from '@/data/remote/tmdb/client';
import { tvdbClient } from '@/data/remote/tvdb/client';
import { mediaId, parseMediaRouteId } from '@/features/catalog/mediaIdentity';

const movieDto = {
  id: 42, title: 'A Film', original_title: 'Un Film', overview: 'A story', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
  release_date: '2024-03-01', genres: [{ id: 7, name: 'Drama' }], vote_average: 8.2, vote_count: 120, runtime: 105,
  status: 'Released', original_language: 'fr', production_countries: [{ iso_3166_1: 'FR', name: 'France' }],
};

const animeDto = {
  id: 42, title: { english: 'A Film', romaji: 'A Firu', native: '映画' }, description: '<p>Bright &amp; bold<br>story</p>',
  coverImage: { extraLarge: 'https://img.example/cover.jpg' }, bannerImage: null,
  startDate: { year: 2024, month: 2, day: 10 }, season: 'WINTER', seasonYear: 2024, format: 'TV', status: 'FINISHED',
  episodes: 12, duration: 24, genres: ['Drama', null], averageScore: 81, popularity: 900, studios: { nodes: [{ name: 'Studio A' }, null] },
};

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

describe('catalog domain mapping and identity', () => {
  it('maps TMDb movie fields and provider-qualified identity', () => {
    const media = mapTmdbMovie(movieDto);
    expect(media.id).toBe('tmdb:movie:42');
    expect(media.providerId).toBe('42');
    expect(media.mediaType).toBe('movie');
    expect(media.year).toBe(2024);
    expect(media.genres).toEqual([{ id: 7, name: 'Drama' }]);
    expect(media.posterUrl).toContain('/w500/poster.jpg');
    expect(media.runtimeMinutes).toBe(105);
    expect(parseMediaRouteId(mediaId(media))).toEqual({ provider: 'tmdb', mediaType: 'movie', providerId: '42' });
    expect(parseMediaRouteId('anilist:anime:42')?.provider).toBe('anilist');
    expect(mediaId(media)).not.toBe('anilist:anime:42');
  });

  it('maps TV metadata and excludes the special-season entry', () => {
    const media = mapTmdbTv({ id: 5, name: 'Series', first_air_date: '2020-01-02', number_of_seasons: 2, number_of_episodes: 18,
      seasons: [{ season_number: 0, name: 'Specials' }, { season_number: 1, name: 'Season 1', episode_count: 10, poster_path: '/season.jpg' }] });
    expect(media.id).toBe('tmdb:series:5');
    expect(media.numberOfSeasons).toBe(2);
    expect(media.seasonSummaries).toHaveLength(1);
    expect(media.seasonSummaries?.[0].seasonNumber).toBe(1);
  });

  it('maps seasons and episodes without adding watched state', () => {
    const series = { provider: 'tmdb', mediaType: 'series', providerId: '5' } as const;
    const season = mapTmdbSeason({ id: 12, season_number: 1, name: 'Season 1', episodes: [{ id: 31, episode_number: 1, name: 'Pilot', air_date: '2020-01-02', still_path: '/still.jpg', runtime: 43 }] }, series);
    expect(season.episodes[0]).toMatchObject({ provider: 'tmdb', providerId: '31', seriesId: '5', seasonNumber: 1, episodeNumber: 1, title: 'Pilot', runtimeMinutes: 43 });
    expect(season.episodes[0].stillUrl).toContain('/w300/still.jpg');
    expect(season.episodes[0]).not.toHaveProperty('watched');
  });

  it('maps AniList fields safely and strips HTML descriptions', () => {
    expect(plainDescription('<p>Hello <b>there</b></p>&nbsp;World')).toBe('Hello there\n\n World');
    expect(plainDescription('Titans attack.<br><br><br>(Source: MangaHelpers)')).toBe('Titans attack.');
    expect(plainDescription('Part one.\n\n\n\nPart two.')).toBe('Part one.\n\nPart two.');
    const media = mapAniListAnime(animeDto);
    expect(media.id).toBe('anilist:anime:42');
    expect(media.title).toBe('A Film');
    expect(media.originalTitle).toBe('映画');
    expect(media.overview).toBe('Bright & bold\nstory');
    expect(media.genres).toEqual([{ name: 'Drama' }]);
    expect(media.rating).toBe(8.1);
    expect(media.numberOfEpisodes).toBe(12);
    expect(media.episodeMetadata).toBe('available');
    expect(media.seasonSummaries).toEqual([{ seasonNumber: 1, name: 'Season 1', episodeCount: 12, airDate: '2024-02-10', posterUrl: 'https://img.example/cover.jpg', refProviderId: '42', refMalId: undefined }]);
    expect(media.releaseDate).toBe('2024-02-10');
    expect(mapAniListAnime({ id: 7 }).title).toBe('Anime 7');
  });

  it('builds an anime season chain from prequel/sequel relations, skipping movies', () => {
    const dto = {
      ...animeDto,
      relations: {
        edges: [
          { relationType: 'SEQUEL', node: { id: 43, title: { english: 'A Film S2' }, format: 'TV', status: 'FINISHED', episodes: 10, startDate: { year: 2025, month: 1, day: 1 } } },
          { relationType: 'SEQUEL', node: { id: 44, title: { english: 'A Film Movie' }, format: 'MOVIE', status: 'FINISHED', episodes: 1, startDate: { year: 2025, month: 6, day: 1 } } },
          { relationType: 'SIDE_STORY', node: { id: 45, title: { english: 'A Film Side' }, format: 'TV', status: 'FINISHED', episodes: 3, startDate: { year: 2024, month: 6, day: 1 } } },
          { relationType: 'SEQUEL', node: { id: 46, title: { english: 'A Film Recap' }, format: 'TV', status: 'FINISHED', episodes: 1, startDate: { year: 2025, month: 3, day: 1 } } },
        ],
      },
    };
    const entries = animeSeasonEntries(dto);
    // Movies, side stories, and single-episode recaps never become seasons.
    expect(entries.map((entry) => entry.providerId)).toEqual(['42', '43']);
    const summaries = animeEntriesToSummaries(entries);
    expect(summaries.map((summary) => [summary.seasonNumber, summary.name, summary.episodeCount, summary.refProviderId])).toEqual([
      [1, 'Season 1', 12, '42'],
      [2, 'Season 2', 10, '43'],
    ]);
    const media = mapAniListAnime(dto);
    expect(media.seasonSummaries).toHaveLength(2);
  });

  it('sorts undated chain entries last so real seasons keep their numbers', () => {
    const dto = {
      ...animeDto,
      relations: {
        edges: [
          { relationType: 'SEQUEL', node: { id: 47, title: { english: 'A Film S2' }, format: 'TV', status: 'FINISHED', episodes: 10, startDate: null } },
        ],
      },
    };
    const summaries = animeEntriesToSummaries(animeSeasonEntries(dto));
    expect(summaries.map((summary) => summary.refProviderId)).toEqual(['42', '47']);
    expect(summaries[0].seasonNumber).toBe(1);
  });

  it('builds safe image URLs for absent and present provider paths', () => {
    expect(imageUrl(null)).toBeUndefined();
    expect(imageUrl('/p.jpg')).toContain('p.jpg');
    expect(imageUrl('/b.jpg', 'backdrop')).toContain('/w780/b.jpg');
    expect(parseMediaRouteId('tmdb:anime:42')).toBeUndefined();
    expect(parseMediaRouteId('anilist:movie:42')).toBeUndefined();
  });

  it('merges duplicate normalized titles while preserving distinct titles', () => {
    const movie = mapTmdbMovie(movieDto);
    const anime = mapAniListAnime(animeDto);
    const other = mapTmdbMovie({ ...movieDto, id: 43, title: 'Another Film', release_date: '2022-01-01' });
    expect(mergeCatalogResults([[movie], [anime, other]]).map((item) => item.id)).toEqual([movie.id, other.id]);
  });
});

describe('catalog request and provider clients', () => {
  beforeEach(() => { jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by catalog test')); });
  afterEach(() => jest.restoreAllMocks());

  it('maps HTTP and network failures into safe catalog errors', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [503, 'server']] as const) {
      fetchSpy.mockResolvedValueOnce(response({}, status));
      await expect(requestJson('tmdb', 'https://example.invalid/search')).rejects.toMatchObject({ code, status });
    }
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('internal network details'));
    await expect(requestJson('anilist', 'https://example.invalid/graphql')).rejects.toMatchObject({ code: 'network', userMessage: expect.not.stringContaining('internal network details') });
  });

  it('handles invalid JSON and AniList GraphQL errors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response);
    await expect(requestJson('tmdb', 'https://example.invalid')).rejects.toMatchObject({ code: 'invalid_response' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ errors: [{ message: 'private provider error detail' }] }));
    await expect(anilistClient.searchAnime('test')).rejects.toBeInstanceOf(CatalogError);
  });

  it('times out stalled requests without leaking low-level details', async () => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
    }));
    const pending = requestJson('tmdb', 'https://example.invalid/slow');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await jest.advanceTimersByTimeAsync(12_100);
    await assertion;
    jest.useRealTimers();
  });

  it('returns a controlled missing-key error without making a request', async () => {
    expect(() => buildTmdbUrl('search/movie', {}, undefined)).toThrow(expect.objectContaining({ code: 'configuration' }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('parses a successful AniList search response through fetch without internet', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ data: { Page: { media: [animeDto] } } }));
    await expect(anilistClient.searchAnime('A Film')).resolves.toMatchObject([{ id: 42, title: animeDto.title }]);
  });

  it('maps Jikan episode pages from the open anime API', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({
      pagination: { last_visible_page: 1, has_next_page: false },
      data: [
        { mal_id: 1, title: 'To You, in 2000 Years', episode: 1, aired: '2013-04-07T00:00:00+00:00', filler: false, recap: false },
        { mal_id: 2, title: null, episode: 2, aired: null },
      ],
    }));
    await expect(jikanClient.getAllEpisodes(21)).resolves.toEqual([
      { number: 1, title: 'To You, in 2000 Years', aired: '2013-04-07', synopsis: undefined, filler: false, recap: false },
      { number: 2, title: 'Episode 2', aired: undefined, synopsis: undefined, filler: undefined, recap: undefined },
    ]);
  });

  it('normalizes provider results and propagates all-provider failures', async () => {
    const repo = new RemoteCatalogRepository();
    const searchMovie = {
      objectID: 'movie-42', type: 'movie', tvdb_id: '42', name: 'A Film', overview: 'Story',
      image_url: 'https://artworks.thetvdb.com/banners/v4/movie/42/posters/x.jpg', year: '2024',
      genres: ['Drama'], status: 'Released', primary_language: 'eng',
    };
    const searchSeries = {
      objectID: 'series-43', type: 'series', tvdb_id: '43', name: 'A Show', overview: 'Story',
      image_url: 'https://artworks.thetvdb.com/banners/posters/43-1.jpg', year: '2024',
      genres: ['Drama'], status: 'Continuing', primary_language: 'eng',
    };
    const movieSpy = jest.spyOn(tvdbClient, 'search').mockImplementation(async (_query, type) => (
      type === 'movie' ? [searchMovie] : [searchSeries]
    ));
    jest.spyOn(tmdbClient, 'searchMovies').mockResolvedValue({ results: [] } as never);
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({ results: [] } as never);
    const result = await repo.search('A Film', 'all');
    expect(result.items.map((item) => item.id).sort()).toEqual(['tvdb:movie:42', 'tvdb:series:43'].sort());
    expect(result.unavailableProviders).toEqual([]);
    expect(movieSpy.mock.calls.map((call) => call.slice(0, 2))).toContainEqual(['A Film', 'movie']);
    jest.spyOn(tvdbClient, 'search').mockRejectedValue(new CatalogError('tvdb', 'network'));
    await expect(repo.search('A Film', 'all')).rejects.toMatchObject({ code: 'network' });
  });

  it('ranks the exact popular match first so the typed title never needs scrolling', async () => {
    const repo = new RemoteCatalogRepository();
    const tvdbItem = (tvdbId: string, name: string, year: string, type: 'movie' | 'series') => ({
      objectID: `${type}-${tvdbId}`, type, tvdb_id: tvdbId, name, overview: 'Story',
      image_url: `https://artworks.thetvdb.com/banners/posters/${tvdbId}-1.jpg`, year,
      genres: ['Drama'], status: 'Released', primary_language: 'eng',
    });
    jest.spyOn(tvdbClient, 'search').mockImplementation(async (_query, type) => (
      type === 'movie'
        ? [tvdbItem('10', 'Off the Record', '1990', 'movie'), tvdbItem('11', 'The Office', '2005', 'movie')]
        : [tvdbItem('20', 'The Office Chronicles', '2020', 'series')]
    ));
    jest.spyOn(tmdbClient, 'searchMovies').mockResolvedValue({ results: [{ id: 11, title: 'The Office', popularity: 95 }, { id: 10, title: 'Off the Record', popularity: 40 }] } as never);
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({ results: [{ id: 9, name: 'The Office', popularity: 100 }, { id: 8, name: 'The Office Chronicles', popularity: 30 }] } as never);
    const result = await repo.search('the office', 'all');
    expect(result.items.map((item) => item.title)).toEqual(['The Office', 'The Office Chronicles', 'Off the Record']);
  });

  it('keeps search ranked by text match alone when the popularity lookup fails', async () => {
    const repo = new RemoteCatalogRepository();
    const tvdbItem = (tvdbId: string, name: string, type: 'movie' | 'series') => ({
      objectID: `${type}-${tvdbId}`, type, tvdb_id: tvdbId, name, overview: 'Story',
      image_url: `https://artworks.thetvdb.com/banners/posters/${tvdbId}-1.jpg`, year: '2010',
      genres: ['Drama'], status: 'Released', primary_language: 'eng',
    });
    jest.spyOn(tvdbClient, 'search').mockImplementation(async (_query, type) => (
      type === 'movie' ? [tvdbItem('11', 'Zeta Exact', 'movie')] : [tvdbItem('12', 'Zeta Exact Story', 'series')]
    ));
    jest.spyOn(tmdbClient, 'searchMovies').mockRejectedValue(new CatalogError('tmdb', 'network'));
    jest.spyOn(tmdbClient, 'searchTv').mockRejectedValue(new CatalogError('tmdb', 'network'));
    const result = await repo.search('Zeta Exact', 'all');
    expect(result.items.map((item) => item.title)).toEqual(['Zeta Exact', 'Zeta Exact Story']);
    expect(result.unavailableProviders).toEqual([]);
  });

  it('orders search results by match quality first and popularity inside each tier', () => {
    const media = (id: string, title: string, year: number): CatalogMedia => ({
      provider: 'tvdb', mediaType: 'series', providerId: id, id: `tvdb:series:${id}`,
      title, year, genres: [], episodeMetadata: 'available',
    });
    const items = [media('1', 'Deep Cut', 2001), media('2', 'Office Party', 2002), media('3', 'Office', 2003), media('4', 'Unrelated', 2004)];
    const popularity = new Map([['office', 10], ['officeparty', 90]]);
    expect(rankSearchResults(items, 'office', popularity).map((item) => item.title))
      .toEqual(['Office', 'Office Party', 'Deep Cut', 'Unrelated']);
    expect(searchMatchTier('The Office', 'the office')).toBe(0);
    expect(searchMatchTier('The Office (US)', 'the office')).toBe(1);
    expect(searchMatchTier('Dunder Mifflin: The Office', 'the office')).toBe(2);
    expect(searchMatchTier('The Ghostwriter', 'writer')).toBe(3);
    expect(searchMatchTier('Boondock Saints', 'office')).toBe(4);
  });

  it('returns empty results without any provider request for whitespace', async () => {
    const searchMovie = jest.spyOn(tmdbClient, 'searchMovies');
    const result = await new RemoteCatalogRepository().search('  ', 'all');
    expect(result).toEqual({ items: [], unavailableProviders: [] });
    expect(searchMovie).not.toHaveBeenCalled();
  });

  it('fills search with TMDb English titles and drops native-script TVDB rows for Latin queries', async () => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    const repo = new RemoteCatalogRepository();
    jest.spyOn(tvdbClient, 'search').mockImplementation(async (_query, type) => (
      type === 'movie'
        ? [{
          objectID: 'movie-77', type: 'movie', tvdb_id: '77', name: 'रामायण', overview: 'Story',
          image_url: 'https://artworks.thetvdb.com/banners/v4/movie/77/posters/x.jpg', year: '2026',
          genres: ['Drama'], status: 'Announced', primary_language: 'hin',
        }]
        : []
    ));
    jest.spyOn(tmdbClient, 'searchMovies').mockResolvedValue({
      results: [{ id: 11, title: 'Ramayana: Rise of a Legend', release_date: '2026-11-05', popularity: 80 }],
    } as never);
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({ results: [] } as never);
    const result = await repo.search('ramayana', 'all');
    // The Devanagari TVDB row is dropped for a Latin query; TMDb supplies
    // the same title in English with its full release date.
    expect(result.items).toEqual([expect.objectContaining({ title: 'Ramayana: Rise of a Legend', provider: 'tmdb', releaseDate: '2026-11-05' })]);
  });

  it('makes upcoming TMDb titles searchable even when TVDB has no record', async () => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    jest.spyOn(tvdbClient, 'search').mockResolvedValue([] as never);
    jest.spyOn(tmdbClient, 'searchMovies').mockResolvedValue({
      results: [{ id: 99, title: 'Brand New Day', release_date: '2026-07-29', popularity: 60 }],
    } as never);
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({ results: [] } as never);
    const result = await new RemoteCatalogRepository().search('brand new day', 'all');
    expect(result.items.map((item) => item.title)).toEqual(['Brand New Day']);
  });

  it('lists popular anime from AniList with English titles, not TVDB Japanese names', async () => {
    const dto = {
      ...animeDto,
      id: 21,
      title: { english: 'One Piece', romaji: 'One Piece', native: 'ワンピース' },
    };
    jest.spyOn(anilistClient, 'popularAnime').mockResolvedValue({ media: [dto], hasNextPage: true, lastPage: 40 } as never);
    const page = await new RemoteCatalogRepository().getPopularAnimePage(2);
    expect(page.items).toMatchObject([{ id: 'anilist:anime:21', title: 'One Piece' }]);
    expect(page).toMatchObject({ page: 2, totalPages: 40 });
  });

  it('loads provider-specific details and season episodes through the repository', async () => {    const repo = new RemoteCatalogRepository();
    jest.spyOn(tmdbClient, 'getMovie').mockResolvedValue(movieDto);
    const identity = { provider: 'tmdb', mediaType: 'movie', providerId: '42' } as const;
    await expect(repo.getMedia(identity)).resolves.toMatchObject({ id: 'tmdb:movie:42', title: 'A Film' });
    jest.spyOn(tmdbClient, 'getSeason').mockResolvedValue({ id: 1, season_number: 1, name: 'Season 1', episodes: [{ id: 90, episode_number: 1, name: 'Pilot' }] });
    await expect(repo.getSeason({ provider: 'tmdb', mediaType: 'series', providerId: '9' }, 1)).resolves.toMatchObject({ episodes: [{ providerId: '90', title: 'Pilot' }] });
    // Anime seasons resolve through the Jikan open API, with a synthetic
    // 1..N fallback when Jikan is unreachable (fetch is blocked here).
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue(animeDto);
    await expect(repo.getSeason({ provider: 'anilist', mediaType: 'anime', providerId: '42' }, 1)).resolves.toMatchObject({
      seasonNumber: 1,
      name: 'Season 1',
      episodes: expect.arrayContaining([expect.objectContaining({ provider: 'anilist', mediaType: 'anime', seasonNumber: 1 })]),
    });
    const animeSeason = await repo.getSeason({ provider: 'anilist', mediaType: 'anime', providerId: '42' }, 1);
    expect(animeSeason.episodes).toHaveLength(12);
    expect(animeSeason.episodes[0]).toMatchObject({ episodeNumber: 1, title: 'Episode 1' });
    await expect(repo.getSeason({ provider: 'anilist', mediaType: 'anime', providerId: '42' }, 2)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('walks the anime sequel chain so every season resolves its own episodes', async () => {
    const repo = new RemoteCatalogRepository();
    const chain = (id: number, year: number, episodes: number | null, edges: { relationType: string; node: { id: number; title: { english: string }; format: string; status: string; episodes: number | null; startDate: { year: number; month: number; day: number } } }[]) => ({
      id, title: { english: `Chain ${id}` }, status: 'FINISHED', format: 'TV',
      startDate: { year, month: 1, day: 1 }, episodes,
      coverImage: { large: 'https://img.example/c.jpg' },
      relations: { edges },
    });
    const s1 = chain(101, 2020, 24, [{ relationType: 'SEQUEL', node: { id: 102, title: { english: 'Chain 102' }, format: 'TV', status: 'FINISHED', episodes: 23, startDate: { year: 2023, month: 7, day: 1 } } }]);
    const s2 = chain(102, 2023, 23, [
      { relationType: 'PREQUEL', node: { id: 101, title: { english: 'Chain 101' }, format: 'TV', status: 'FINISHED', episodes: 24, startDate: { year: 2020, month: 1, day: 1 } } },
      { relationType: 'SEQUEL', node: { id: 103, title: { english: 'Chain 103' }, format: 'TV', status: 'RELEASING', episodes: null, startDate: { year: 2026, month: 1, day: 1 } } },
    ]);
    const s3 = chain(103, 2026, null, [{ relationType: 'PREQUEL', node: { id: 102, title: { english: 'Chain 102' }, format: 'TV', status: 'FINISHED', episodes: 23, startDate: { year: 2023, month: 7, day: 1 } } }]);
    jest.spyOn(anilistClient, 'getAnime').mockImplementation(async (id: number) => {
      if (id === 101) return s1;
      if (id === 102) return s2;
      if (id === 103) return s3;
      throw new CatalogError('anilist', 'not_found', 404);
    });
    // Jikan is unreachable in tests (fetch blocked), so seasons fall back to
    // synthetic episode lists with the chain's real totals.
    const media = await repo.getMedia({ provider: 'anilist', mediaType: 'anime', providerId: '101' });
    expect(media.seasonSummaries?.map((summary) => [summary.seasonNumber, summary.episodeCount, summary.refProviderId])).toEqual([
      [1, 24, '101'],
      [2, 23, '102'],
      [3, undefined, '103'],
    ]);
    expect(media.numberOfEpisodes).toBe(47);
    const season2 = await repo.getSeason({ provider: 'anilist', mediaType: 'anime', providerId: '101' }, 2);
    expect(season2.episodes).toHaveLength(23);
    expect(season2.episodes[0]).toMatchObject({ provider: 'anilist', mediaType: 'anime', seasonNumber: 2, episodeNumber: 1, title: 'Episode 1' });
    expect(season2.episodes[0].providerId).toBe('101-s2e1');
    // Opening the middle entry surfaces the same whole chain.
    const middle = await repo.getMedia({ provider: 'anilist', mediaType: 'anime', providerId: '102' });
    expect(middle.seasonSummaries).toHaveLength(3);
  });

  it('resolves anime seasons from summary refs without walking the chain', async () => {
    const repo = new RemoteCatalogRepository();
    const getAnimeSpy = jest.spyOn(anilistClient, 'getAnime');
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '55' } as const;
    // Known count, no MAL id: synthetic list with zero network requests.
    const season = await repo.getAnimeSeasonByRef(identity, { seasonNumber: 2, name: 'Season 2', episodeCount: 10, refProviderId: '56' });
    expect(season.seasonNumber).toBe(2);
    expect(season.episodes).toHaveLength(10);
    expect(season.episodes[0].providerId).toBe('55-s2e1');
    expect(getAnimeSpy).not.toHaveBeenCalled();
    // Jikan unreachable here (fetch blocked): falls back to the same list.
    const fallback = await repo.getAnimeSeasonByRef(identity, { seasonNumber: 2, name: 'Season 2', episodeCount: 10, refProviderId: '56', refMalId: 99999 });
    expect(fallback.episodes).toHaveLength(10);
  });

  it('maps IMDb ids and picks YouTube trailers', async () => {
    expect(mapTmdbMovie({ ...movieDto, imdb_id: 'tt1234567' }).imdbId).toBe('tt1234567');
    expect(mapTmdbMovie(movieDto).imdbId).toBeUndefined();
    jest.spyOn(tmdbClient, 'videos').mockResolvedValue({ results: [
      { id: 'a', key: 'teaser1', site: 'YouTube', type: 'Teaser' },
      { id: 'b', key: 'trailer1', site: 'YouTube', type: 'Trailer' },
      { id: 'c', key: 'vimeo1', site: 'Vimeo', type: 'Trailer' },
    ] });
    const repo = new RemoteCatalogRepository();
    await expect(repo.getTrailerKey({ provider: 'tmdb', mediaType: 'movie', providerId: '42' })).resolves.toBe('trailer1');
    jest.spyOn(tmdbClient, 'videos').mockResolvedValue({ results: [] });
    await expect(repo.getTrailerKey({ provider: 'tmdb', mediaType: 'movie', providerId: '42' })).resolves.toBeUndefined();
    await expect(repo.getTrailerKey({ provider: 'anilist', mediaType: 'anime', providerId: '42' })).resolves.toBeUndefined();
  });

  it('maps region watch providers into stream, rent, and buy groups', async () => {
    jest.spyOn(tmdbClient, 'watchProviders').mockResolvedValue({ results: {
      US: {
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
        rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
        buy: [],
      },
    } });
    const repo = new RemoteCatalogRepository();
    const groups = await repo.getWatchProviders({ provider: 'tmdb', mediaType: 'series', providerId: '9' });
    expect(groups.map((group) => group.category)).toEqual(['stream', 'rent']);
    expect(groups[0].providers[0]).toMatchObject({ id: 8, name: 'Netflix' });
    expect(groups[0].providers[0].logoUrl).toContain('/n.jpg');
    jest.spyOn(tmdbClient, 'watchProviders').mockResolvedValue({ results: {} });
    await expect(repo.getWatchProviders({ provider: 'tmdb', mediaType: 'movie', providerId: '42' })).resolves.toEqual([]);
  });
});
