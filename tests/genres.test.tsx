import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { queryClient } from '@/lib/query/queryClient';
import { GENRES, anilistGenreFor, genreById, tvGenreIdsFor } from '@/features/genres/catalog';
import { tmdbClient } from '@/data/remote/tmdb/client';
import { anilistClient } from '@/data/remote/anilist/client';
import { catalogRepository, RemoteCatalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { mapAniListAnime } from '@/data/remote/anilist/mappers';
import { mapTmdbMovie } from '@/data/remote/tmdb/mappers';
import GenresScreen from '../app/genres';
import GenreScreen from '../app/genre/[id]';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => {
  const entering = { duration: () => entering, delay: () => entering, withInitialValues: () => entering };
  return { __esModule: true, default: { View: 'View' }, View: 'View', useReducedMotion: () => false, FadeIn: entering, FadeInDown: entering, FadeInUp: entering };
});

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({ id: '28' })),
  useFocusEffect: () => undefined,
}));

const movieDto = (id: number, title: string, releaseDate: string) => ({
  id, title, overview: 'Story', poster_path: '/p.jpg', release_date: releaseDate, genres: [], vote_average: 7, vote_count: 10,
});
const tvDto = (id: number, name: string, airDate: string) => ({
  id, name, overview: 'Story', poster_path: '/p.jpg', first_air_date: airDate, genres: [], vote_average: 7, vote_count: 10,
});
const animeDto = (id: number, title: string, genres: string[] = []) => ({
  id, title: { english: title }, coverImage: { large: 'https://img.example/c.jpg' }, genres, popularity: 500,
});

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

describe('genre catalog', () => {
  it('ships the reference grid alphabetically with unique ids and slugs', () => {
    expect(GENRES.map((entry) => entry.name)).toEqual([
      'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
      'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance',
      'Science Fiction', 'Thriller', 'TV Movie', 'War', 'Western',
    ]);
    expect(new Set(GENRES.map((entry) => entry.id)).size).toBe(GENRES.length);
    expect(new Set(GENRES.map((entry) => entry.slug)).size).toBe(GENRES.length);
    expect(genreById(28)).toMatchObject({ name: 'Action' });
    expect(genreById(424242)).toBeUndefined();
    expect(genreById(Number.NaN)).toBeUndefined();
  });

  it('maps every genre to AniList honestly: exact name, all-anime, or none', () => {
    // Exact names from AniList's own GenreCollection.
    const exact: Record<number, string> = {
      28: 'Action', 12: 'Adventure', 35: 'Comedy', 18: 'Drama', 14: 'Fantasy',
      27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
    };
    for (const [id, name] of Object.entries(exact)) expect(anilistGenreFor(Number(id))).toBe(name);
    // Everything AniList carries is animation, so the Animation shelf shows it all.
    expect(anilistGenreFor(16)).toBe('all');
    // Genres AniList never tags — the anime shelf reports empty instead of faking it.
    for (const id of [80, 99, 10751, 36, 10770, 10752, 37]) expect(anilistGenreFor(id)).toBeNull();
    for (const genre of GENRES) expect(anilistGenreFor(genre.id)).not.toBeUndefined();
    expect(anilistGenreFor(424242)).toBeUndefined();
  });

  it('translates the grid genres onto TMDb separate TV taxonomy', () => {
    // TMDb's TV list is its own taxonomy — Action shows are Action & Adventure, etc.
    expect(tvGenreIdsFor(28)).toBe('10759');
    expect(tvGenreIdsFor(12)).toBe('10759');
    expect(tvGenreIdsFor(878)).toBe('10765');
    expect(tvGenreIdsFor(14)).toBe('10765');
    expect(tvGenreIdsFor(10752)).toBe('10768');
    expect(tvGenreIdsFor(27)).toBe('9648,18');
    expect(tvGenreIdsFor(10749)).toBe('18');
    // Genres sharing ids pass through, TV Movie has no TV counterpart at all.
    expect(tvGenreIdsFor(18)).toBe('18');
    expect(tvGenreIdsFor(9648)).toBe('9648');
    expect(tvGenreIdsFor(10770)).toBeNull();
    for (const genre of GENRES) expect(tvGenreIdsFor(genre.id)).not.toBeUndefined();
    expect(tvGenreIdsFor(424242)).toBeUndefined();
  });

  it('gives every genre card its own hue to carry the identity', () => {
    for (const genre of GENRES) {
      expect(genre.gradient).toHaveLength(2);
      for (const stop of genre.gradient) expect(stop).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // No two cards share a face: every glow color stands alone.
    expect(new Set(GENRES.map((genre) => genre.gradient[0])).size).toBe(GENRES.length);
  });
});

describe('genre endpoints', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by genre test'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('discovers movies and shows with the genre filter attached', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ results: [], page: 1, total_pages: 1 }));
    await tmdbClient.discoverMovies(1, { language: 'hi', withGenres: '28' });
    const movieUrl = fetchSpy.mock.calls[0][0] as string;
    expect(movieUrl).toContain('discover/movie');
    expect(movieUrl).toContain('with_genres=28');
    expect(movieUrl).toContain('with_original_language=hi');

    await tmdbClient.discoverTv(3, { language: 'en', withGenres: '27' });
    const tvUrl = fetchSpy.mock.calls[1][0] as string;
    expect(tvUrl).toContain('discover/tv');
    expect(tvUrl).toContain('with_genres=27');
    expect(tvUrl).toContain('page=3');
  });

  it('asks AniList for one exact genre with pagination variables', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: { Page: { media: [animeDto(7, 'Mystery Anime')], pageInfo: { hasNextPage: true, lastPage: 5 } } } }));
    const result = await anilistClient.genreAnimePage(2, 40, 'Mystery');
    expect(result.media).toMatchObject([{ id: 7 }]);
    expect(result.lastPage).toBe(5);
    expect(result.hasNextPage).toBe(true);
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain('genre_in');
    expect(body).toContain('Mystery');
    expect(body).toContain('"page":2');
  });
});

describe('genre shelves', () => {
  const repo = new RemoteCatalogRepository();
  beforeEach(() => {
    process.env.EXPO_PUBLIC_TMDB_API_KEY = 'test-key';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by genre test'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('Movies mixes Hollywood, Bollywood, and Japanese anime films', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('discover/movie') && url.includes('with_original_language=hi')) return response({ results: [movieDto(2, 'Bollywood Film', '2024-02-06')], page: 1, total_pages: 4 });
      if (url.includes('discover/movie') && url.includes('with_original_language=ja')) return response({ results: [movieDto(3, 'Anime Film', '2024-03-07')], page: 1, total_pages: 4 });
      if (url.includes('discover/movie')) return response({ results: [movieDto(1, 'Hollywood Film', '2024-01-05')], page: 1, total_pages: 4 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    const result = await repo.getGenrePage(1, 28, 'movies');
    expect(result.items.map((item) => item.title)).toEqual(['Hollywood Film', 'Bollywood Film', 'Anime Film']);
    expect(result.totalPages).toBe(4);
    for (const call of fetchSpy.mock.calls) expect(String(call[0])).toContain('with_genres=28');
  });

  it('Shows is Hollywood + Bollywood series via the TV genre taxonomy', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('discover/tv') && url.includes('with_original_language=hi')) return response({ results: [tvDto(4, 'Bollywood Show', '2024-04-08')], page: 1, total_pages: 6 });
      if (url.includes('discover/tv')) return response({ results: [tvDto(5, 'Hollywood Show', '2024-05-09')], page: 1, total_pages: 6 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    // Horror has no TV genre on TMDb — its shows borrow Mystery + Drama ids.
    const result = await repo.getGenrePage(1, 27, 'shows');
    expect(result.items.map((item) => item.title)).toEqual(['Hollywood Show', 'Bollywood Show']);
    expect(result.totalPages).toBe(6);
    expect(fetchSpy.mock.calls.every((call) => String(call[0]).includes('discover/tv'))).toBe(true);
    for (const call of fetchSpy.mock.calls) expect(String(call[0])).toContain('with_genres=9648%2C18');
  });

  it('TV Movie has no TV counterpart — the Shows shelf reports empty without fetching', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const result = await repo.getGenrePage(1, 10770, 'shows');
    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Hindi shows stay on Indian OTT platforms with a vote floor, English stays open', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('discover/tv')) return response({ results: [tvDto(6, 'OTT Show', '2024-01-04')], page: 1, total_pages: 2 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    await repo.getGenrePage(1, 18, 'shows');
    const calls = fetchSpy.mock.calls.map((call) => String(call[0]));
    const hiCall = calls.find((url) => url.includes('discover/tv') && url.includes('with_original_language=hi'));
    // Pipe-joined provider list (OR semantics) + a vote floor that drops daily
    // serials (C.I.D. 32 votes, Taarak Mehta 41) while OTT originals pass.
    expect(hiCall).toContain('watch_region=IN');
    expect(hiCall).toContain('with_watch_providers=8%7C119%7C2336%7C232%7C237%7C350%7C11%7C561%7C315%7C532%7C623');
    expect(hiCall).toContain('vote_count.gte=45');
    const enCall = calls.find((url) => url.includes('discover/tv') && url.includes('with_original_language=en'));
    expect(enCall).not.toContain('watch_region');
    expect(enCall).not.toContain('vote_count');
  });

  it('Comedy leads with pure comedies — the multi-tagged action-comedies follow', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('discover/movie') && url.includes('with_original_language=en')) {
        return response({
          results: [
            { ...movieDto(1, 'Action Comedy Hit', '2024-01-01'), genre_ids: [28, 35] },
            { ...movieDto(2, 'Pure Comedy', '2024-02-02'), genre_ids: [35, 10749] },
          ],
          page: 1, total_pages: 1,
        });
      }
      if (url.includes('discover/movie')) return response({ results: [], page: 1, total_pages: 1 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    const result = await repo.getGenrePage(1, 35, 'movies');
    expect(result.items.map((item) => item.title)).toEqual(['Pure Comedy', 'Action Comedy Hit']);
  });

  it('Shows lead with the genre per the TV taxonomy (primary TV id first)', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('discover/tv') && url.includes('with_original_language=en')) {
        return response({
          results: [
            { ...tvDto(7, 'Drama Only Show', '2024-03-03'), genre_ids: [18] },
            { ...tvDto(8, 'Action Adventure Show', '2024-04-04'), genre_ids: [10759, 18] },
          ],
          page: 1, total_pages: 1,
        });
      }
      if (url.includes('discover/tv')) return response({ results: [], page: 1, total_pages: 1 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    // Action shows carry the TV genre "Action & Adventure" (10759) — the
    // multi-tagged drama-only neighbour follows instead of leading.
    const result = await repo.getGenrePage(1, 28, 'shows');
    expect(result.items.map((item) => item.title)).toEqual(['Action Adventure Show', 'Drama Only Show']);
  });

  it('Anime shelves lead with the exact AniList genre', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: { Page: { media: [
      { ...animeDto(21, 'Comedy First', ['Comedy', 'Action']), popularity: 900 },
      { ...animeDto(22, 'Action First', ['Action', 'Comedy']), popularity: 800 },
    ], pageInfo: { hasNextPage: false, lastPage: 1 } } } }));
    const result = await repo.getGenrePage(1, 28, 'anime');
    expect(result.items.map((item) => item.title)).toEqual(['Action First', 'Comedy First']);
  });

  it('All mixes movies, shows, and anime on page one, anime joins page one only', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('anilist')) return response({ data: { Page: { media: [animeDto(6, 'Anime Series')], pageInfo: { hasNextPage: false, lastPage: 1 } } } });
      if (url.includes('discover/tv') && url.includes('with_original_language=hi')) return response({ results: [tvDto(8, 'Bollywood Show', '2024-06-10')], page: 1, total_pages: 5 });
      if (url.includes('discover/tv')) return response({ results: [tvDto(7, 'Hollywood Show', '2024-06-09')], page: 1, total_pages: 5 });
      if (url.includes('discover/movie') && url.includes('with_original_language=hi')) return response({ results: [movieDto(4, 'Bollywood Movie', '2024-06-07')], page: 1, total_pages: 5 });
      if (url.includes('discover/movie') && url.includes('with_original_language=ja')) return response({ results: [movieDto(5, 'Anime Movie', '2024-06-08')], page: 1, total_pages: 5 });
      if (url.includes('discover/movie')) return response({ results: [movieDto(3, 'Hollywood Movie', '2024-06-06')], page: 1, total_pages: 5 });
      throw new Error(`Unexpected genre request: ${url}`);
    });
    const pageOne = await repo.getGenrePage(1, 28, 'all');
    expect(pageOne.items.map((item) => item.title)).toEqual([
      'Hollywood Movie', 'Bollywood Movie', 'Hollywood Show', 'Bollywood Show', 'Anime Movie', 'Anime Series',
    ]);
    expect(pageOne.totalPages).toBe(5);

    const pageTwo = await repo.getGenrePage(2, 28, 'all');
    expect(pageTwo.items.map((item) => item.title)).toEqual([
      'Hollywood Movie', 'Bollywood Movie', 'Hollywood Show', 'Bollywood Show', 'Anime Movie',
    ]);
    const animeCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes('anilist'));
    expect(animeCalls).toHaveLength(1);
  });

  it('Anime queries AniList by exact genre and returns anime identities', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: { Page: { media: [animeDto(9, 'Mystery Anime')], pageInfo: { hasNextPage: true, lastPage: 12 } } } }));
    const result = await repo.getGenrePage(1, 9648, 'anime');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: 'Mystery Anime', mediaType: 'anime' });
    expect(result.totalPages).toBe(12);
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain('genre_in');
    expect(body).toContain('Mystery');
  });

  it('Animation uses the popular anime feed since everything AniList carries is animation', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: { Page: { media: [animeDto(10, 'Popular Anime')], pageInfo: { hasNextPage: false, lastPage: 1 } } } }));
    const result = await repo.getGenrePage(1, 16, 'anime');
    expect(result.items[0]).toMatchObject({ title: 'Popular Anime', mediaType: 'anime' });
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).not.toContain('genre_in');
    expect(body).toContain('POPULARITY_DESC');
  });

  it('genres AniList never tags report an honest empty anime shelf without network calls', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    for (const genreId of [80, 99, 10751, 36, 10770, 10752, 37]) {
      const result = await repo.getGenrePage(1, genreId, 'anime');
      expect(result.items).toEqual([]);
      expect(result.totalPages).toBe(1);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('genre screens', () => {
  const visibleText = (renderer: ReturnType<typeof create>): string => renderer.root
    .findAllByType('Text' as never)
    .flatMap((node) => (node as { children?: unknown }).children ?? [])
    .filter((child): child is string => typeof child === 'string')
    .join(' ');
  const findLabeled = (renderer: ReturnType<typeof create>, label: string) =>
    renderer.root.findAllByProps({ accessibilityLabel: label }).find((node) => typeof node.props.onPress === 'function');

  beforeEach(() => {
    queryClient.clear();
    (useLocalSearchParams as unknown as jest.Mock).mockReturnValue({ id: '28' });
  });
  afterEach(() => {
    queryClient.clear();
    jest.restoreAllMocks();
  });

  it('renders every genre as a tappable tile', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><GenresScreen /></QueryClientProvider>); });
    await act(async () => {});
    const text = visibleText(renderer);
    for (const genre of GENRES) expect(text).toContain(genre.name);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Browse the Action genre' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Browse the Western genre' }).length).toBeGreaterThan(0);
    await act(async () => { renderer.unmount(); });
  });

  it('genre shelf shows every scope filter and swaps shelves in place', async () => {
    const genreSpy = jest.spyOn(catalogRepository, 'getGenrePage').mockImplementation(async (_page, _genreId, scope) => (
      scope === 'anime'
        ? { items: [mapAniListAnime(animeDto(33, 'Anime Hit'))], page: 1, totalPages: 1 }
        : { items: [mapTmdbMovie(movieDto(11, 'Hollywood Film', '2024-01-05'))], page: 1, totalPages: 1 }
    ));
    let renderer!: ReturnType<typeof create>;
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><GenreScreen /></QueryClientProvider>); });
      let text = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
        text = visibleText(renderer);
        if (text.includes('Hollywood Film')) break;
      }
      expect(text).toContain('Action');
      expect(text).toContain('Hollywood Film');
      // The four scopes from the reference filter row, with their promises.
      expect(findLabeled(renderer, 'Show mixed movies, shows, and anime')).toBeDefined();
      expect(findLabeled(renderer, 'Show Hollywood, Bollywood, and anime movies')).toBeDefined();
      expect(findLabeled(renderer, 'Show Hollywood and Bollywood shows')).toBeDefined();
      const animeTab = findLabeled(renderer, 'Show anime series and movies');
      expect(animeTab).toBeDefined();

      await act(async () => { animeTab?.props.onPress(); });
      let animeText = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25); }); });
        animeText = visibleText(renderer);
        if (animeText.includes('Anime Hit')) break;
      }
      expect(animeText).toContain('Anime Hit');
      expect(animeText).not.toContain('Hollywood Film');
      expect(genreSpy).toHaveBeenCalledWith(1, 28, 'anime', expect.anything());
    } finally {
      if (renderer) await act(async () => { renderer.unmount(); });
    }
  });

  it('unknown genre ids fall back to a safe empty state without fetching', async () => {
    (useLocalSearchParams as unknown as jest.Mock).mockReturnValue({ id: '424242' });
    const genreSpy = jest.spyOn(catalogRepository, 'getGenrePage');
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><GenreScreen /></QueryClientProvider>); });
    await act(async () => {});
    expect(visibleText(renderer)).toContain('Genre not found');
    expect(genreSpy).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('home offers genres beside New Releases', () => {
    const home = readFileSync('app/(tabs)/index.tsx', 'utf8');
    expect(home).toMatch(/SectionHeader title="Genres"/);
    expect(home).toMatch(/'\/genres'/);
    expect(home).toMatch(/pathname: '\/genre\/\[id\]'/);
  });
});
