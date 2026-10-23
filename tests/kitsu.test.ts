import { RemoteCatalogRepository, isUpcomingMedia } from '@/data/remote/catalog/RemoteCatalogRepository';
import { isUpcoming } from '@/features/catalog/upcoming';
import type { CatalogMedia } from '@/domain/models/media';
import { mapAnimeSeason } from '@/data/remote/anilist/mappers';
import { anilistClient } from '@/data/remote/anilist/client';
import { jikanClient } from '@/data/remote/jikan/client';
import { kitsuClient, __resetKitsuClientForTests } from '@/data/remote/kitsu/client';
import { tvdbClient } from '@/data/remote/tvdb/client';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

const kitsuEpisode = (number: number, title: string) => ({
  id: `${1000 + number}`,
  attributes: {
    number,
    canonicalTitle: title,
    synopsis: `${title} synopsis`,
    airdate: '2024-01-07',
    length: 24,
    thumbnail: { original: `https://media.kitsu.app/episodes/thumbnails/${1000 + number}/original.jpg` },
  },
});

describe('kitsu anime episode pipeline', () => {
  beforeEach(() => {
    __resetKitsuClientForTests();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by kitsu test'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('resolves an AniList id to a Kitsu id and caches the answer', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ data: [{ relationships: { item: { data: { id: '12' } } } }] }));
    await expect(kitsuClient.resolveAnimeId(21)).resolves.toBe('12');
    await expect(kitsuClient.resolveAnimeId(21)).resolves.toBe('12');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('mappings');
  });

  it('requests linkage so the mapping id actually resolves', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(response({ data: [{ relationships: { item: { data: { id: '7442' } } } }] }));
    await expect(kitsuClient.resolveAnimeId(16498)).resolves.toBe('7442');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('include=item');
  });

  it('treats linkage-less mappings as a miss instead of an empty id', async () => {
    // The live API omits relationships.item.data without include=item.
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ data: [{ relationships: { item: {} } }] }));
    await expect(kitsuClient.resolveAnimeId(16499)).resolves.toBeNull();
  });

  it('caches misses so unmapped entries never refetch', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(response({ data: [] }));
    await expect(kitsuClient.resolveAnimeId(999001)).resolves.toBeNull();
    await expect(kitsuClient.resolveAnimeId(999001)).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('pages, dedupes, sorts, and carries stills like show episodes', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const firstPage = Array.from({ length: 20 }, (_, index) => kitsuEpisode(index + 1, `Ep ${index + 1}`));
    firstPage.push(kitsuEpisode(2, 'Second dup'));
    fetchSpy
      .mockResolvedValueOnce(response({ data: firstPage, meta: { count: 23 } }))
      .mockResolvedValueOnce(response({
        data: [kitsuEpisode(21, 'Ep 21'), kitsuEpisode(22, 'Ep 22'), kitsuEpisode(23, 'Ep 23')],
        meta: { count: 23 },
      }));
    const episodes = await kitsuClient.getAllEpisodes('12');
    expect(episodes.map((episode) => episode.number)).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
    expect(episodes[0]).toMatchObject({
      title: 'Ep 1',
      aired: '2024-01-07',
      runtimeMinutes: 24,
      stillUrl: expect.stringContaining('original.jpg'),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('maps anime seasons with stills and runtimes, exactly like shows', () => {
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
    const season = mapAnimeSeason(identity, 1, 'Season 1', [
      { number: 1, title: 'First', aired: '2024-01-07', synopsis: 'S', stillUrl: 'https://img.example/s1.jpg', runtimeMinutes: 24 },
    ]);
    expect(season.episodes[0]).toMatchObject({
      seasonNumber: 1, episodeNumber: 1, stillUrl: 'https://img.example/s1.jpg', runtimeMinutes: 24,
    });
  });

  it('prefers Kitsu titles, then Jikan, then a synthetic list', async () => {
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
    const summary = { seasonNumber: 1, name: 'Season 1', episodeCount: 24, refProviderId: '21', refMalId: 999 };
    const resolveSpy = jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue('12');
    const kitsuSpy = jest.spyOn(kitsuClient, 'getAllEpisodes').mockResolvedValue([
      { number: 1, title: 'Kitsu premiere', stillUrl: 'https://img.example/k1.jpg', runtimeMinutes: 24 },
    ]);
    const jikanSpy = jest.spyOn(jikanClient, 'getAllEpisodes').mockResolvedValue([{ number: 1, title: 'Jikan premiere' }]);

    const repo = new RemoteCatalogRepository();
    const kitsuFirst = await repo.getAnimeSeasonByRef(identity, summary);
    expect(kitsuFirst.episodes[0].title).toBe('Kitsu premiere');
    expect(kitsuFirst.episodes[0].stillUrl).toBe('https://img.example/k1.jpg');
    expect(jikanSpy).not.toHaveBeenCalled();

    kitsuSpy.mockRejectedValueOnce(new Error('kitsu down'));
    const jikanFallback = await repo.getAnimeSeasonByRef(identity, summary);
    expect(jikanFallback.episodes[0].title).toBe('Jikan premiere');

    resolveSpy.mockResolvedValueOnce(null);
    jikanSpy.mockRejectedValueOnce(new Error('jikan limited'));
    const synthetic = await repo.getAnimeSeasonByRef(identity, summary);
    expect(synthetic.episodes).toHaveLength(24);
    expect(synthetic.episodes[0].title).toBe('Episode 1');
  });

  it('prefers English episode titles over romaji canonical titles', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(response({
      data: [{
        id: '5001',
        attributes: {
          number: 1,
          canonicalTitle: 'Kakusei',
          titles: { en_us: 'Awakening', en_jp: 'Kakusei', ja_jp: '覚醒' },
          airdate: '2024-01-07',
          length: 24,
          thumbnail: { original: 'https://media.kitsu.app/episodes/thumbnails/5001/original.jpg' },
        },
      }],
      meta: { count: 1 },
    }));
    const page = await kitsuClient.getEpisodePage('99', 0);
    expect(page.episodes[0]).toMatchObject({ number: 1, title: 'Awakening' });
  });

  it('keeps AniList future dates after the aired Kitsu episodes', async () => {
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
    const summary = {
      seasonNumber: 1,
      name: 'Season 1',
      episodeCount: 4,
      refProviderId: '21',
      futureEpisodes: [
        { episodeNumber: 3, airDate: '2026-10-23' },
        { episodeNumber: 4, airDate: '2026-10-30' },
      ],
    };
    jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue('12');
    jest.spyOn(kitsuClient, 'getAllEpisodes').mockResolvedValue([
      { number: 1, title: 'First', aired: '2026-10-09' },
      { number: 2, title: 'Second', aired: '2026-10-16' },
    ]);
    const getAnime = jest.spyOn(anilistClient, 'getAnime');

    const season = await new RemoteCatalogRepository().getAnimeSeasonByRef(identity, summary);
    expect(season.episodes.map((episode) => [episode.episodeNumber, episode.airDate])).toEqual([
      [1, '2026-10-09'],
      [2, '2026-10-16'],
      [3, '2026-10-23'],
      [4, '2026-10-30'],
    ]);
    expect(season.episodes[2]).toMatchObject({
      provider: 'anilist',
      mediaType: 'anime',
      providerId: '21-s1e3',
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'Episode 3',
    });
    expect(getAnime).not.toHaveBeenCalled();
  });

  it('asks AniList for future dates when an older summary has none', async () => {
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
    jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue('12');
    jest.spyOn(kitsuClient, 'getAllEpisodes').mockResolvedValue([
      { number: 1, title: 'First', aired: '2026-10-09' },
      { number: 2, title: 'Second', aired: '2026-10-16' },
    ]);
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue({
      id: 21,
      title: { english: 'Airing Anime' },
      episodes: 4,
      status: 'RELEASING',
      nextAiringEpisode: { episode: 3, airingAt: 1_792_764_000 },
      airingSchedule: {
        nodes: [
          { episode: 3, airingAt: 1_792_764_000 },
          { episode: 4, airingAt: 1_793_368_800 },
        ],
      },
    } as never);

    const season = await new RemoteCatalogRepository().getAnimeSeasonByRef(identity, {
      seasonNumber: 1, name: 'Season 1', episodeCount: 4, refProviderId: '21',
    });
    expect(season.episodes).toHaveLength(4);
    expect(season.episodes[2].airDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(season.episodes[3].airDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('fills missing dates when Kitsu already lists every episode', async () => {
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
    jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue('12');
    jest.spyOn(kitsuClient, 'getAllEpisodes').mockResolvedValue([
      { number: 1, title: 'First', aired: '2026-10-09' },
      { number: 2, title: 'Second', aired: '2026-10-16' },
      { number: 3, title: 'Third' },
      { number: 4, title: 'Fourth' },
    ]);
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue({
      id: 21,
      title: { english: 'Airing Anime' },
      episodes: 4,
      status: 'RELEASING',
      airingSchedule: {
        nodes: [
          { episode: 3, airingAt: 1_792_764_000 },
          { episode: 4, airingAt: 1_793_368_800 },
        ],
      },
    } as never);

    const season = await new RemoteCatalogRepository().getAnimeSeasonByRef(identity, {
      seasonNumber: 1, name: 'Season 1', episodeCount: 4, refProviderId: '21',
    });
    expect(season.episodes).toHaveLength(4);
    expect(season.episodes[0].airDate).toBe('2026-10-09');
    expect(season.episodes[2].airDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(season.episodes[3].airDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('throws honest metadata errors only when no source has episodes', async () => {    jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue(null);
    jest.spyOn(jikanClient, 'getAllEpisodes').mockRejectedValue(new Error('limited'));
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue({
      id: 4242, title: { english: 'Mystery' }, episodes: null,
    } as never);
    const repo = new RemoteCatalogRepository();
    await expect(repo.getAnimeSeasonByRef(
      { provider: 'anilist', mediaType: 'anime', providerId: '4242' } as const,
      { seasonNumber: 1, name: 'Season 1' },
    )).rejects.toMatchObject({ kind: 'catalog' });
  });
});

describe('top 100 catalog ranking', () => {
  afterEach(() => jest.restoreAllMocks());

  const tvdbLinks = { total_items: 1000, page_size: 500 };
  const topMovie = (id: number, name: string, year: string, score: number, status = 'Released') => ({
    id, name, year, score, status: { name }, image: `/banners/v4/movie/${id}/posters/x.jpg`,
  });
  const topSeries = (id: number, name: string, firstAired: string, year: string, score: number | null, status = 'Continuing') => ({
    id, name, firstAired, year, score, status: { name }, image: `/banners/posters/${id}-1.jpg`,
  });

  function mockTopRated() {
    jest.spyOn(tvdbClient, 'filterMovies').mockResolvedValue({
      data: [topMovie(1, 'Film A', '2020', 9000), topMovie(2, 'Film B', '2019', 1000)],
      links: tvdbLinks,
    } as never);
    jest.spyOn(tvdbClient, 'filterSeries').mockResolvedValue({
      data: [
        topSeries(3, 'Show C', '2021-01-01', '2021', 8000),
        topSeries(4, 'Unscored', '2020-01-01', '2020', null),
        topSeries(5, 'Future Show', '2099-01-01', '2099', 99999, 'Continuing'),
      ],
      links: tvdbLinks,
    } as never);
  }

  it('orders by score, drops unscored and unreleased titles', async () => {
    mockTopRated();
    const top = await new RemoteCatalogRepository().getTopRated();
    expect(top.map((item) => item.id)).toEqual(['tvdb:movie:1', 'tvdb:series:3', 'tvdb:movie:2']);
  });

  it('caps the list at 100 titles', async () => {
    const manyMovies = Array.from({ length: 60 }, (_, index) => topMovie(100 + index, `M ${index}`, '2020', 500 - index));
    const manySeries = Array.from({ length: 60 }, (_, index) => topSeries(200 + index, `S ${index}`, '2020-01-01', '2020', 500 - index));
    jest.spyOn(tvdbClient, 'filterMovies').mockResolvedValue({ data: manyMovies, links: tvdbLinks } as never);
    jest.spyOn(tvdbClient, 'filterSeries').mockResolvedValue({ data: manySeries, links: tvdbLinks } as never);
    const top = await new RemoteCatalogRepository().getTopRated();
    expect(top).toHaveLength(100);
    const scores = top.map((item) => item.popularity ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('unreleased title detection', () => {
  const baseMedia: CatalogMedia = {
    id: 'tmdb:movie:1', provider: 'tmdb', mediaType: 'movie', providerId: '1',
    title: 'T', genres: [], episodeMetadata: 'unavailable',
  };
  const checkers: [string, (media: CatalogMedia) => boolean][] = [    ['features', isUpcoming],
    ['repository', isUpcomingMedia],
  ];

  it.each(checkers)('%s treats year-only future dates as upcoming', (_label, check) => {
    expect(check({ ...baseMedia, releaseDate: '2099' })).toBe(true);
    expect(check({ ...baseMedia, releaseDate: '2020' })).toBe(false);
  });

  it.each(checkers)('%s blocks announced, post-production and pilot titles', (_label, check) => {
    expect(check({ ...baseMedia, status: 'Announced' })).toBe(true);
    expect(check({ ...baseMedia, status: 'Post Production' })).toBe(true);
    expect(check({ ...baseMedia, status: 'Pilot' })).toBe(true);
    expect(check({ ...baseMedia, status: 'Released' })).toBe(false);
  });

  it.each(checkers)('%s still honors dates and announced statuses', (_label, check) => {
    expect(check({ ...baseMedia, releaseDate: '2099-05-04' })).toBe(true);
    expect(check({ ...baseMedia, releaseDate: '2020-05-04' })).toBe(false);
    expect(check({ ...baseMedia, status: 'NOT_YET_RELEASED' })).toBe(true);
  });
});
