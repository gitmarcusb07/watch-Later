import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { runMigrations } from '@/data/local/database/migrations';
import { SqliteDatabaseRepository } from '@/data/local/repositories/SqliteDatabaseRepository';
import { createSqliteTestAdapter } from './sqliteTestAdapter';

describe('local database foundation', () => {
  it('applies schema migrations once within an exclusive transaction', async () => {
    const appliedVersions: number[] = [];
    const statements: string[] = [];
    const transaction = {
      execAsync: jest.fn(async (sql: string) => { statements.push(sql); }),
      getAllAsync: jest.fn(async (sql: string) => sql.includes('schema_migrations') ? appliedVersions.map((version) => ({ version })) : [{ name: 'id' }]),
      runAsync: jest.fn(async (_sql: string, version?: number) => {
        if (version !== undefined) appliedVersions.push(version);
        return {} as SQLiteRunResult;
      }),
    };
    const database = {
      withExclusiveTransactionAsync: jest.fn(async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)),
      execAsync: jest.fn(async (sql: string) => { statements.push(sql); }),
      getAllAsync: transaction.getAllAsync,
      runAsync: transaction.runAsync,
    } as unknown as SQLiteDatabase;

    await runMigrations(database);
    expect(database.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    // v15 is recorded post-transaction (provider CHECK rebuild), so it lands
    // after v16/v17 in insertion order; set membership is what matters.
    expect(appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 15]);
    expect(statements.some((sql) => sql.includes('content_references'))).toBe(true);
    await runMigrations(database);
    expect(appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 15]);
  });

  it('exposes initialization through a repository boundary', async () => {
    const initialize = jest.spyOn(SqliteDatabaseRepository.prototype, 'initialize').mockResolvedValue();
    await new SqliteDatabaseRepository().initialize();
    expect(initialize).toHaveBeenCalledTimes(1);
    initialize.mockRestore();
  });

  it('widens provider checks to tvdb while preserving rows (v15)', async () => {
    const { database, close } = createSqliteTestAdapter();
    try {
      // Simulate a pre-v15 database: narrow provider CHECKs over the full
      // historical column sets, versions 1..14 already recorded.
      await database.execAsync(`CREATE TABLE tracked_media (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist')),
        provider_id TEXT NOT NULL, media_type TEXT NOT NULL, title TEXT NOT NULL,
        original_title TEXT, overview TEXT, poster_url TEXT, backdrop_url TEXT,
        release_date TEXT, year INTEGER, rating REAL, vote_count INTEGER,
        runtime_minutes INTEGER, status TEXT, language TEXT,
        origin_countries TEXT NOT NULL DEFAULT '[]', genres TEXT NOT NULL DEFAULT '[]',
        number_of_seasons INTEGER, number_of_episodes INTEGER,
        season_summaries TEXT NOT NULL DEFAULT '[]', anime_format TEXT, anime_season TEXT,
        popularity INTEGER, studios TEXT NOT NULL DEFAULT '[]',
        episode_metadata TEXT NOT NULL DEFAULT 'unavailable',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (provider, media_type, provider_id)
      );`);
      await database.execAsync(`CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('watchlist', 'movie', 'series', 'episode', 'favorite', 'rating', 'interested')),
        entity_key TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist')),
        media_type TEXT NOT NULL, provider_id TEXT NOT NULL, season_number INTEGER, episode_number INTEGER,
        is_deleted INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL, media_json TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        rewatch_count INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (entity_type, entity_key)
      );`);
      await database.execAsync(`CREATE TABLE tracked_episodes (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL CHECK (provider = 'tmdb'),
        provider_id TEXT NOT NULL, series_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
        season_number INTEGER NOT NULL, episode_number INTEGER NOT NULL, title TEXT NOT NULL,
        overview TEXT, air_date TEXT, still_url TEXT, runtime_minutes INTEGER, watched_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        rewatch_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider, provider_id), UNIQUE (series_id, season_number, episode_number)
      );`);
      await database.runAsync(
        "INSERT INTO tracked_media (id, provider, provider_id, media_type, title) VALUES ('tmdb:movie:1', 'tmdb', '1', 'movie', 'Old Film')",
      );
      await database.runAsync(
        "INSERT INTO sync_queue (entity_type, entity_key, provider, media_type, provider_id, is_deleted, updated_at, payload) VALUES ('watchlist', 'tmdb:movie:1', 'tmdb', 'movie', '1', 0, '2026-01-01', '{}')",
      );
      await database.runAsync(
        "INSERT INTO tracked_episodes (id, provider, provider_id, series_id, season_number, episode_number, title) VALUES ('tmdb:episode:9', 'tmdb', '9', 'tmdb:movie:1', 1, 1, 'Pilot')",
      );
      await database.execAsync('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
      await database.execAsync(`INSERT INTO schema_migrations (version) VALUES ${Array.from({ length: 14 }, (_, index) => `(${index + 1})`).join(', ')};`);
      await expect(database.runAsync(
        "INSERT INTO tracked_media (id, provider, provider_id, media_type, title) VALUES ('tvdb:movie:2', 'tvdb', '2', 'movie', 'Blocked')",
      )).rejects.toThrow();

      await runMigrations(database);

      // Old rows survive; tvdb rows are accepted everywhere now.
      await database.runAsync(
        "INSERT INTO tracked_media (id, provider, provider_id, media_type, title) VALUES ('tvdb:movie:2', 'tvdb', '2', 'movie', 'New Film')",
      );
      await database.runAsync(
        "INSERT INTO sync_queue (entity_type, entity_key, provider, media_type, provider_id, is_deleted, updated_at, payload) VALUES ('watchlist', 'tvdb:movie:2', 'tvdb', 'movie', '2', 0, '2026-01-01', '{}')",
      );
      await database.runAsync(
        "INSERT INTO tracked_episodes (id, provider, provider_id, series_id, season_number, episode_number, title) VALUES ('tvdb:episode:3', 'tvdb', '3', 'tvdb:movie:2', 1, 1, 'Premiere')",
      );
      const media = await database.getAllAsync<{ id: string }>('SELECT id FROM tracked_media ORDER BY id');
      expect(media.map((row) => row.id).sort()).toEqual(['tmdb:movie:1', 'tvdb:movie:2'].sort());
      const versions = await database.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
      expect(versions.map((row) => row.version)).toContain(15);

      // Reruns are idempotent.
      await runMigrations(database);
      const rerun = await database.getAllAsync<{ id: string }>('SELECT id FROM tracked_media ORDER BY id');
      expect(rerun).toHaveLength(2);
    } finally {
      close();
    }
  });
});
