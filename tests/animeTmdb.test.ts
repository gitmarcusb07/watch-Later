import { RemoteCatalogRepository, pickTmdbSeriesMatch } from '@/data/remote/catalog/RemoteCatalogRepository';
import { anilistClient } from '@/data/remote/anilist/client';
import { tmdbClient } from '@/data/remote/tmdb/client';
import { kitsuClient } from '@/data/remote/kitsu/client';
import { jikanClient } from '@/data/remote/jikan/client';

afterEach(() => jest.restoreAllMocks());

function animeDto() {
  return {
    id: 21,
    idMal: 21,
    title: { english: 'One Piece', romaji: 'One Piece', native: 'ワンピース' },
    description: 'Pirates.',
    coverImage: { large: 'https://img.example/anilist.jpg' },
    bannerImage: null,
    startDate: { year: 1999, month: 10, day: 20 },
    format: 'TV',
    status: 'RELEASING',
    episodes: null,
    duration: 24,
    genres: ['Adventure'],
    averageScore: 87,
    popularity: 500000,
    season: null,
    seasonYear: null,
    studios: { nodes: [] },
    relations: { edges: [] },
  } as never;
}

function tmdbTv() {
  return {
    id: 37854,
    name: 'One Piece',
    overview: 'Pirate crew.',
    poster_path: '/tmdb-poster.jpg',
    backdrop_path: '/tmdb-back.jpg',
    first_air_date: '1999-10-20',
    genres: [{ id: 10759, name: 'Action & Adventure' }],
    vote_average: 8.7,
    vote_count: 5000,
    seasons: [
      { season_number: 1, name: 'East Blue', episode_count: 61, air_date: '1999-10-20', poster_path: '/s1.jpg' },
      { season_number: 2, name: 'Whiskey Peak', episode_count: 16, air_date: '2001-03-21', poster_path: null },
    ],
  } as never;
}

describe('TMDB anime series matching', () => {
  it('prefers the exact title from the right year over a same-name remake', () => {
    const results = [
      { id: 111110, name: 'ONE PIECE', first_air_date: '2023-08-31' },
      { id: 37854, name: 'One Piece', first_air_date: '1999-10-20' },
    ];
    expect(pickTmdbSeriesMatch(results, 'ONE PIECE', 1999)).toBe(37854);
  });

  it('falls back by year, then by exact name, then refuses to guess', () => {
    // An exact title beats a same-year different show.
    expect(pickTmdbSeriesMatch([
      { id: 1, name: 'Totally Different', first_air_date: '1999-05-05' },
      { id: 2, name: 'One Piece', first_air_date: null },
    ], 'One Piece', 1999)).toBe(2);
    // With no exact match anywhere, the closest year wins.
    expect(pickTmdbSeriesMatch([
      { id: 1, name: 'Totally Different', first_air_date: '1999-05-05' },
      { id: 6, name: 'Another Thing', first_air_date: '2010-01-01' },
    ], 'One Piece', 1999)).toBe(1);
    expect(pickTmdbSeriesMatch([{ id: 3, name: 'One Piece', first_air_date: null }], 'One Piece', 1999)).toBe(3);
    expect(pickTmdbSeriesMatch([{ id: 4, name: 'Something Else', first_air_date: '2001-01-01' }], 'One Piece', 1999)).toBeNull();
    expect(pickTmdbSeriesMatch([], 'One Piece', 1999)).toBeNull();
    expect(pickTmdbSeriesMatch([{ id: 5, name: 'One Piece', first_air_date: '1999-10-20' }], '', 1999)).toBeNull();
  });
});

describe('anime TMDB shell overlay', () => {
  it('takes titles, posters, and seasons from TMDB with AniList refs kept', async () => {
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue(animeDto());
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({
      results: [
        { id: 111110, name: 'ONE PIECE', first_air_date: '2023-08-31' },
        { id: 37854, name: 'One Piece', first_air_date: '1999-10-20' },
      ],
    } as never);
    jest.spyOn(tmdbClient, 'getTv').mockResolvedValue(tmdbTv());
    const media = await new RemoteCatalogRepository().getMedia({ provider: 'anilist', mediaType: 'anime', providerId: '21' });
    expect(media.title).toBe('One Piece');
    expect(media.posterUrl).toContain('/tmdb-poster.jpg');
    expect(media.seasonSummaries).toMatchObject([
      { seasonNumber: 1, name: 'East Blue', episodeCount: 61, refProviderId: '21', refMalId: 21, refTmdbSeriesId: '37854' },
      { seasonNumber: 2, name: 'Whiskey Peak', episodeCount: 16, refTmdbSeriesId: '37854' },
    ]);
    expect(media.numberOfEpisodes).toBe(77);
  });

  it('keeps AniList data when TMDB has no confident match', async () => {
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue(animeDto());
    jest.spyOn(tmdbClient, 'searchTv').mockResolvedValue({
      results: [{ id: 9, name: 'Unrelated Show', first_air_date: '2020-01-01' }],
    } as never);
    const getTv = jest.spyOn(tmdbClient, 'getTv');
    const media = await new RemoteCatalogRepository().getMedia({ provider: 'anilist', mediaType: 'anime', providerId: '21' });
    expect(getTv).not.toHaveBeenCalled();
    expect(media.posterUrl).toBe('https://img.example/anilist.jpg');
    expect(media.seasonSummaries).toBeUndefined();
  });
});

describe('anime TMDB episode path', () => {
  const identity = { provider: 'anilist', mediaType: 'anime', providerId: '21' } as const;
  const summary = {
    seasonNumber: 1,
    name: 'East Blue',
    episodeCount: 61,
    refProviderId: '21',
    refMalId: 21,
    refTmdbSeriesId: '37854',
  };

  beforeEach(() => {
    // A partial TMDB season now asks AniList for its future schedule.
    jest.spyOn(anilistClient, 'getAnime').mockResolvedValue(animeDto());
  });

  it('prefers TMDB episodes with real titles and stills', async () => {
    jest.spyOn(tmdbClient, 'getSeason').mockResolvedValue({
      id: 1001,
      season_number: 1,
      name: 'East Blue',
      episodes: [
        { id: 9001, episode_number: 1, name: 'Romance Dawn', overview: 'Luffy sets sail.', air_date: '1999-10-20', still_path: '/st1.jpg', runtime: 24 },
      ],
    } as never);
    const kitsu = jest.spyOn(kitsuClient, 'resolveAnimeId');
    const season = await new RemoteCatalogRepository().getAnimeSeasonByRef(identity, summary);
    expect(season.episodes[0]).toMatchObject({
      provider: 'anilist',
      mediaType: 'anime',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Romance Dawn',
      stillUrl: expect.stringContaining('/st1.jpg'),
    });
    expect(kitsu).not.toHaveBeenCalled();
  });

  it('falls back to Jikan when the TMDB season fetch fails', async () => {
    jest.spyOn(tmdbClient, 'getSeason').mockRejectedValue(new Error('offline'));
    jest.spyOn(kitsuClient, 'resolveAnimeId').mockResolvedValue(null);
    jest.spyOn(jikanClient, 'getAllEpisodes').mockResolvedValue([{ number: 1, title: 'Jikan premiere' }]);
    const season = await new RemoteCatalogRepository().getAnimeSeasonByRef(identity, summary);
    expect(season.episodes[0]).toMatchObject({ title: 'Jikan premiere' });
  });
});
