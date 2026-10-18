import { act, create } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query/queryClient';
import { AppError } from '@/domain/errors/AppError';
import type { CatalogMedia, CatalogSeason } from '@/domain/models/media';
import { mapTmdbMovie, mapTmdbTv } from '@/data/remote/tmdb/mappers';
import { mapAniListAnime, syntheticAnimeSeason } from '@/data/remote/anilist/mappers';
import { runMigrations } from '@/data/local/database/migrations';
import { SqliteWatchStateRepository, watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { createSqliteTestAdapter } from './sqliteTestAdapter';
import { AutoSyncScheduler, backoffDelayMs } from '@/features/sync/autoSync';
import { getMovieStatus, getSeriesStatus, finishTitle, markUpToHere } from '@/features/watchState/status';
import { catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import SearchScreen from '../app/search';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

function series() {
  return mapTmdbTv({ id: 42, name: 'Series 42', overview: 'Series', poster_path: '/s.jpg', first_air_date: '2020-01-01', genres: [], number_of_seasons: 1, number_of_episodes: 3, seasons: [{ season_number: 1, name: 'Season 1', episode_count: 3 }] });
}

function seasonOf(parent: CatalogMedia, count = 3): CatalogSeason {
  const episodes: CatalogSeason['episodes'] = Array.from({ length: count }, (_, index) => ({
    provider: 'tmdb', mediaType: 'series', providerId: `42010${index + 1}`, seriesId: parent.providerId,
    seasonNumber: 1, episodeNumber: index + 1, title: `Episode ${index + 1}`,
  }));
  return { series: parent, seasonNumber: 1, name: 'Season 1', episodes };
}

function setupRepository() {
  const adapter = createSqliteTestAdapter();
  const ready = (async () => {
    adapter.raw.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter.database);
    return new SqliteWatchStateRepository(async () => adapter.database);
  })();
  return { adapter, ready };
}

describe('sync backoff', () => {
  it('grows exponentially and caps at fifteen minutes', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(5000);
    expect(backoffDelayMs(2)).toBe(10000);
    expect(backoffDelayMs(3)).toBe(20000);
    expect(backoffDelayMs(100)).toBe(900000);
  });

  it('delays retries after failures and resets after success', async () => {
    const delays: number[] = [];
    let attempt = 0;
    const scheduler = new AutoSyncScheduler({
      getSession: () => ({ mode: 'authenticated', userId: 'account-1' }),
      sync: async () => {
        attempt += 1;
        if (attempt <= 2) throw new Error('offline');
      },
      setTimer: (fn, ms) => { delays.push(ms); fn(); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearTimer: () => undefined,
    });
    scheduler.schedule();
    await act(async () => {});
    scheduler.schedule();
    await act(async () => {});
    scheduler.schedule();
    await act(async () => {});
    expect(delays).toEqual([1000, 5000, 10000]);
    expect(attempt).toBe(3);
  });
});

describe('title status derivation', () => {
  it('resolves movie and series states by precedence', () => {
    expect(getMovieStatus({ watchlisted: false, movieWatched: false })).toBe('none');
    expect(getMovieStatus({ watchlisted: true, movieWatched: false })).toBe('plan');
    expect(getMovieStatus({ watchlisted: true, movieWatched: true })).toBe('finished');
    expect(getSeriesStatus({ watchlisted: false, tracking: false, complete: false })).toBe('none');
    expect(getSeriesStatus({ watchlisted: true, tracking: false, complete: false })).toBe('plan');
    expect(getSeriesStatus({ watchlisted: true, tracking: true, complete: false })).toBe('watching');
    expect(getSeriesStatus({ watchlisted: true, tracking: true, complete: true })).toBe('finished');
  });
});

describe('finishTitle', () => {
  it('finishes movies with a single watched write', async () => {
    const marked: { media: CatalogMedia; watched: boolean }[] = [];
    await finishTitle(mapTmdbMovie({ id: 1, title: 'Film', genres: [] }), {
      getFullMedia: async () => { throw new AppError('catalog', 'unused'); },
      getSeason: async () => { throw new AppError('catalog', 'unused'); },
      repo: { markMovieWatched: async (media: CatalogMedia, watched: boolean) => { marked.push({ media, watched }); }, startTrackingSeries: async () => undefined } as never,
    });
    expect(marked).toHaveLength(1);
    expect(marked[0].watched).toBe(true);
  });

  it('fetches real season metadata before finishing a series', async () => {
    const parent = series();
    const season = seasonOf(parent);
    const finished: { watched: boolean; count: number }[] = [];
    await finishTitle(parent, {
      getFullMedia: async () => parent,
      getSeason: async () => season,
      repo: {
        markMovieWatched: async () => undefined,
        startTrackingSeries: async () => undefined,
        setSeriesWatched: async (_media: CatalogMedia, seasons: CatalogSeason[], watched: boolean) => { finished.push({ watched, count: seasons.flatMap((item) => item.episodes).length }); },
      } as never,
    });
    expect(finished).toEqual([{ watched: true, count: 3 }]);
  });

  it('tracks anime and marks it complete without inventing episode data', async () => {
    const tracked: string[] = [];
    const completed: string[] = [];
    const anime = { provider: 'anilist', mediaType: 'anime', providerId: '7', id: 'anilist:anime:7', title: 'Anime', genres: [], episodeMetadata: 'unavailable' } as CatalogMedia;
    await finishTitle(anime, {
      getFullMedia: async () => anime,
      getSeason: async () => { throw new AppError('catalog', 'unused'); },
      repo: {
        markMovieWatched: async () => undefined,
        startTrackingSeries: async (media: CatalogMedia) => { tracked.push(media.id); },
        setSeriesComplete: async (media: CatalogMedia, complete: boolean) => { if (complete) completed.push(media.id); },
      } as never,
    });
    expect(tracked).toEqual(['anilist:anime:7']);
    expect(completed).toEqual(['anilist:anime:7']);
  });

  it('finishes anime through real season metadata instead of a bare flag', async () => {
    const anime = mapAniListAnime({ id: 99, title: { english: 'Anime 99' }, status: 'FINISHED', startDate: { year: 2024, month: 1, day: 1 }, episodes: 2 });
    const season = syntheticAnimeSeason({ provider: 'anilist', mediaType: 'anime', providerId: '99' }, 1, 2);
    const finished: { watched: boolean; count: number }[] = [];
    await finishTitle(anime, {
      getFullMedia: async () => anime,
      getSeason: async () => season,
      repo: {
        markMovieWatched: async () => undefined,
        startTrackingSeries: async () => undefined,
        setSeriesWatched: async (_media: CatalogMedia, seasons: CatalogSeason[], watched: boolean) => { finished.push({ watched, count: seasons.flatMap((item) => item.episodes).length }); },
      } as never,
    });
    expect(finished).toEqual([{ watched: true, count: 2 }]);
  });

  it('refuses to finish series without season metadata', async () => {
    const parent = { ...series(), seasonSummaries: [] };
    await expect(finishTitle(parent, {
      getFullMedia: async () => parent,
      getSeason: async () => seasonOf(parent),
      repo: { markMovieWatched: async () => undefined, startTrackingSeries: async () => undefined, setSeriesWatched: async () => undefined } as never,
    })).rejects.toMatchObject({ kind: 'catalog' });
  });
});

describe('markUpToHere', () => {
  it('marks cached episodes up to a position and keeps first-watched dates', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const parent = series();
    const season = seasonOf(parent);
    await repository.setSeriesWatched(parent, [{ ...season, episodeCount: 3 }], false);
    await repository.markEpisodesUpTo(parent, season, 2);
    expect(await repository.getWatchedEpisodeIds(parent, 1)).toEqual(['420101', '420102']);
    const first = await adapter.database.getFirstAsync<{ watched_at: string }>('SELECT watched_at FROM tracked_episodes WHERE provider_id = ?', '420101');
    await repository.markEpisodesUpTo(parent, season, 2);
    expect((await adapter.database.getFirstAsync<{ watched_at: string }>('SELECT watched_at FROM tracked_episodes WHERE provider_id = ?', '420101'))?.watched_at).toBe(first?.watched_at);
    expect((await adapter.database.getFirstAsync<{ rewatch_count: number }>('SELECT rewatch_count FROM tracked_episodes WHERE provider_id = ?', '420101'))?.rewatch_count).toBe(1);
    adapter.close();
  });

  it('fetches and caches a missing season before marking', async () => {
    const parent = series();
    const season = seasonOf(parent);
    let stored = false;
    let marked = 0;
    await markUpToHere(parent, 1, 2, {
      getFullMedia: async () => parent,
      getSeason: async () => season,
      repo: {
        getCachedSeason: async () => undefined,
        storeSeason: async () => { stored = true; },
        markEpisodesUpTo: async () => { marked += 1; },
      } as never,
    });
    expect(stored).toBe(true);
    expect(marked).toBe(1);
  });

  it('rejects invalid positions', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    await expect(repository.markEpisodesUpTo(series(), seasonOf(series()), 0)).rejects.toThrow('valid season');
    adapter.close();
  });

  it('tracks anime episodes individually exactly like series episodes', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const anime = mapAniListAnime({ id: 99, title: { english: 'Anime 99' }, status: 'FINISHED', startDate: { year: 2024, month: 1, day: 1 }, episodes: 3 });
    expect(anime.episodeMetadata).toBe('available');
    const identity = { provider: 'anilist', mediaType: 'anime', providerId: '99' } as const;
    const season = syntheticAnimeSeason(identity, 1, 3);
    await repository.storeSeason(anime, season.seasonNumber, season.name, 3, undefined, undefined, undefined, season.episodes);
    await repository.setEpisodeWatched(anime, season, season.episodes[0], true);
    expect(await repository.getWatchedEpisodeIds(anime, 1)).toEqual(['99-s1e1']);
    const progress = await repository.getSeriesProgress();
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ watchedEpisodeCount: 1, totalEpisodeCount: 3 });
    expect(progress[0].nextEpisode).toMatchObject({ episodeNumber: 2, title: 'Episode 2' });
    adapter.close();
  });
});

describe('list membership feedback', () => {
  it('reports whether a list add inserted or already existed', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const list = await repository.createCustomList('Picks');
    const title = mapTmdbMovie({ id: 9, title: 'Film', genres: [] });
    expect(await repository.addToCustomList(list.id, title)).toBe(true);
    expect(await repository.addToCustomList(list.id, title)).toBe(false);
    adapter.close();
  });
});

describe('migration to v8', () => {
  it('adds ratings and rewatch columns while preserving queued work', async () => {
    const adapter = createSqliteTestAdapter();
    adapter.raw.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations(version) VALUES (1), (2), (3), (4), (5), (6), (7);
      PRAGMA user_version = 7;
      CREATE TABLE tracked_media (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL DEFAULT 'tmdb', provider_id TEXT NOT NULL, media_type TEXT NOT NULL DEFAULT 'movie', title TEXT NOT NULL);
      CREATE TABLE movie_watches (media_id TEXT PRIMARY KEY NOT NULL, watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
        provider TEXT NOT NULL, media_type TEXT NOT NULL, provider_id TEXT NOT NULL,
        season_number INTEGER, episode_number INTEGER, is_deleted INTEGER NOT NULL,
        updated_at TEXT NOT NULL, payload TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        UNIQUE (entity_type, entity_key)
      );
      INSERT INTO sync_queue (entity_type, entity_key, provider, media_type, provider_id, is_deleted, updated_at, payload)
      VALUES ('movie', 'tmdb:movie:7', 'tmdb', 'movie', '7', 0, '2026-01-02T03:04:05.000Z', '{}');
    `);
    await runMigrations(adapter.database);
    expect(await adapter.database.getFirstAsync<{ user_version: number }>('PRAGMA user_version')).toMatchObject({ user_version: 18 });
    const tables = await adapter.database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map(({ name }) => name)).toEqual(expect.arrayContaining(['user_ratings']));
    const queued = await adapter.database.getFirstAsync<{ entity_key: string; payload: string }>('SELECT * FROM sync_queue WHERE entity_key = ?', 'tmdb:movie:7');
    expect(queued).toMatchObject({ entity_key: 'tmdb:movie:7', payload: '{}' });
    await adapter.database.runAsync("INSERT INTO sync_queue (entity_type, entity_key, provider, media_type, provider_id, is_deleted, updated_at, payload) VALUES ('rating', 'tmdb:movie:7', 'tmdb', 'movie', '7', 0, '2026-01-02T03:04:05.000Z', '{}')");
    const rewatch = await adapter.database.getAllAsync<{ name: string }>('PRAGMA table_info(movie_watches)');
    expect(rewatch.map(({ name }) => name)).toContain('rewatch_count');
    adapter.close();
  });
});

describe('search stale fallback', () => {
  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked network request blocked by progress test'));
  });

  afterEach(() => {
    queryClient.clear();
    jest.restoreAllMocks();
  });

  it('shows saved results with a refresh affordance when offline', async () => {
    jest.useFakeTimers();
    try {
      const items = [mapTmdbMovie({ id: 21, title: 'Cached Film', release_date: '2024-01-01', genres: [] })];
      // Seed STALE cache: fresh entries would (correctly) skip refetching.
      queryClient.setQueryData(['catalog', 'search', 'cached', 'all'], { items, unavailableProviders: [] }, { updatedAt: Date.now() - 10 * 60_000 });
      const searchSpy = jest.spyOn(catalogRepository, 'search').mockRejectedValue(new Error('offline now'));
      // Keep local hooks hermetic: no real SQLite or catalog calls in this UI test.
      jest.spyOn(catalogRepository, 'getTrending').mockResolvedValue([]);
      jest.spyOn(watchStateRepository, 'getLibraryStatuses').mockResolvedValue({});
      jest.spyOn(watchStateRepository, 'getWatchlist').mockResolvedValue([]);
      jest.spyOn(watchStateRepository, 'getWatchedLibrary').mockResolvedValue([]);
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(<QueryClientProvider client={queryClient}><SearchScreen /></QueryClientProvider>);
      });
      const input = renderer.root.findByProps({ accessibilityLabel: 'Search movies, shows and anime' });
      await act(async () => { input.props.onChangeText('cached'); });
      // Debounce (320ms), first failure, then the default backoff retry.
      await jest.advanceTimersByTimeAsync(2500);
      await act(async () => {});
      expect(searchSpy).toHaveBeenCalled();
      // Step fake time so the debounce, failure, and backoff retry all settle.
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
      const text = JSON.stringify(renderer.toJSON());
      expect(text).toContain('Cached Film');
      expect(text).toContain('Showing saved results');
      await act(async () => { renderer.unmount(); });
    } finally {
      jest.useRealTimers();
    }
  });
});
