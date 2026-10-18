import type { SQLiteDatabase } from 'expo-sqlite';
import { AppError } from '@/domain/errors/AppError';

export const DATABASE_VERSION = 18;

const migrations: Record<number, readonly string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS content_references (
      id TEXT PRIMARY KEY NOT NULL,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tmdb_id, media_type)
    );`,
    `CREATE TABLE IF NOT EXISTS user_content_state (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      content_id TEXT NOT NULL REFERENCES content_references(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('watchlist', 'watched', 'in_progress')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT NOT NULL DEFAULT 'local'
    );`,
    `CREATE TABLE IF NOT EXISTS sync_metadata (
      entity_type TEXT PRIMARY KEY NOT NULL,
      cursor TEXT,
      last_synced_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ],
  2: [
    `CREATE TABLE IF NOT EXISTS tracked_media (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist', 'tvdb')),
      provider_id TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series', 'anime')),
      title TEXT NOT NULL,
      original_title TEXT,
      overview TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      release_date TEXT,
      year INTEGER,
      rating REAL,
      vote_count INTEGER,
      runtime_minutes INTEGER,
      status TEXT,
      language TEXT,
      origin_countries TEXT NOT NULL DEFAULT '[]',
      genres TEXT NOT NULL DEFAULT '[]',
      number_of_seasons INTEGER,
      number_of_episodes INTEGER,
      season_summaries TEXT NOT NULL DEFAULT '[]',
      anime_format TEXT,
      anime_season TEXT,
      popularity INTEGER,
      studios TEXT NOT NULL DEFAULT '[]',
      episode_metadata TEXT NOT NULL DEFAULT 'unavailable' CHECK (episode_metadata IN ('available', 'unavailable')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (provider, media_type, provider_id)
    );`,
    `CREATE TABLE IF NOT EXISTS watchlist_entries (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS movie_watches (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS tracked_series (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      tracking_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS tracked_seasons (
      media_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL CHECK (season_number >= 0),
      name TEXT NOT NULL,
      episode_count INTEGER,
      overview TEXT,
      air_date TEXT,
      poster_url TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (media_id, season_number)
    );`,
    `CREATE TABLE IF NOT EXISTS tracked_episodes (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist', 'tvdb')),
      provider_id TEXT NOT NULL,
      series_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL CHECK (season_number >= 0),
      episode_number INTEGER NOT NULL CHECK (episode_number >= 0),
      title TEXT NOT NULL,
      overview TEXT,
      air_date TEXT,
      still_url TEXT,
      runtime_minutes INTEGER,
      watched_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (provider, provider_id),
      UNIQUE (series_id, season_number, episode_number)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_watchlist_added ON watchlist_entries(added_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_movie_watches_date ON movie_watches(watched_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_tracked_series_updated ON tracked_series(updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_tracked_episodes_series_order ON tracked_episodes(series_id, season_number, episode_number);`,
    `CREATE INDEX IF NOT EXISTS idx_tracked_episodes_watched ON tracked_episodes(series_id, watched_at);`,
    `CREATE INDEX IF NOT EXISTS idx_tracked_media_updated ON tracked_media(updated_at DESC);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_media_provider_identity ON tracked_media(provider, media_type, provider_id);`,
  ],
  // Re-check the Phase 4 schema because earlier development builds may already
  // have recorded version 2 with a partial tracked_media table.
  3: [],
  4: [
    `CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('watchlist', 'movie', 'series', 'episode')),
      entity_key TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist', 'tvdb')),
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series', 'anime')),
      provider_id TEXT NOT NULL,
      season_number INTEGER,
      episode_number INTEGER,
      is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      UNIQUE (entity_type, entity_key)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_updated ON sync_queue(updated_at, id);`,
    `CREATE TABLE IF NOT EXISTS account_binding (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      account_id TEXT NOT NULL,
      bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ],
  // Additive repair for development databases that recorded v4 with an older
  // sync_queue definition. CREATE TABLE IF NOT EXISTS cannot repair columns.
  5: [],
  // Keep legacy NOT NULL media_json schemas writable without rebuilding tables.
  6: [],
  // Favorites, custom lists, and viewing-history sources. sync_queue is rebuilt
  // to accept the 'favorite' entity type; existing queued work is preserved.
  7: [
    `CREATE TABLE IF NOT EXISTS favorite_entries (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      favorited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_favorite_entries_date ON favorite_entries(favorited_at DESC);`,
    `CREATE TABLE IF NOT EXISTS custom_lists (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS custom_list_items (
      list_id TEXT NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (list_id, media_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_custom_list_items_list ON custom_list_items(list_id, added_at DESC);`,
  ],
  // User ratings (independent from watched state) plus rewatch counters.
  // sync_queue is rebuilt to accept the 'rating' entity type.
  8: [
    `CREATE TABLE IF NOT EXISTS user_ratings (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      rating REAL,
      thumbs INTEGER NOT NULL DEFAULT 0 CHECK (thumbs IN (-1, 0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_user_ratings_updated ON user_ratings(updated_at DESC);`,
  ],
  // List folders, list presentation, manual ordering, and the 30-day trash.
  9: [
    `CREATE TABLE IF NOT EXISTS list_folders (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS deleted_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      media_json TEXT,
      list_snapshot TEXT,
      origin_list_id TEXT,
      watched_at TEXT,
      favorited_at TEXT,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_deleted_items_date ON deleted_items(deleted_at DESC);`,
  ],
  // Real user "Interested" marks for upcoming titles. Syncs like favorites;
  // aggregated counts come from Supabase, never from local data alone.
  10: [
    `CREATE TABLE IF NOT EXISTS interested_entries (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_interested_entries_date ON interested_entries(marked_at DESC);`,
  ],
  // Explicit whole-series completion so anime (no per-episode metadata) can be
  // marked watched. Episode-derived completion keeps working unchanged.
  // Column work lives in ensureSeriesCompletedColumns so partial legacy
  // databases gain the table and columns without failing.
  11: [],
  // Watch-later priority (ASAP / Weekend / Someday). Nullable so legacy rows
  // stay valid; column work lives in ensureWatchlistPriority.
  12: [],
  // Manual anime episode counter (local-only, never synced).
  13: [
    `CREATE TABLE IF NOT EXISTS anime_progress (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      watched_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ],
  // Per-episode anime tracking (same seasons/episodes UI as series).
  // tracked_episodes is rebuilt to accept the 'anilist' provider; existing
  // TMDb episode rows are preserved.
  14: [],
  // TVDB joins the catalog: provider CHECKs widen to ('tmdb', 'anilist',
  // 'tvdb') on tracked_media, sync_queue, and tracked_episodes. Fresh
  // installs are born correct via the DDLs above; existing databases are
  // rebuilt below with all rows preserved.
  15: [],
  // India OTT release tracker: verified-record cache plus local notify-me
  // prefs. Rows are standalone (no FK to tracked_media) because verified
  // announcements reference catalog ids that may not be in the library.
  // Dedupe is enforced per movie + platform + country + release event.
  16: [
    `CREATE TABLE IF NOT EXISTS ott_releases (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      media_type TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      movie_title TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_logo_url TEXT,
      tmdb_provider_id INTEGER,
      country TEXT NOT NULL,
      theatrical_date TEXT,
      ott_date TEXT,
      date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN ('exact', 'month', 'year', 'unknown')),
      status TEXT NOT NULL DEFAULT 'unannounced' CHECK (status IN ('confirmed', 'expected', 'window_announced', 'platform_announced', 'unannounced', 'released')),
      source_url TEXT,
      source_published_at TEXT,
      last_verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      is_premiere INTEGER NOT NULL DEFAULT 1 CHECK (is_premiere IN (0, 1)),
      UNIQUE (provider, media_type, provider_id, platform, country, is_premiere)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ott_releases_country_date ON ott_releases(country, ott_date);`,
    `CREATE INDEX IF NOT EXISTS idx_ott_releases_media ON ott_releases(provider, media_type, provider_id, country);`,
    `CREATE INDEX IF NOT EXISTS idx_ott_releases_platform ON ott_releases(country, platform);`,
    `CREATE TABLE IF NOT EXISTS ott_notify_prefs (
      record_id TEXT PRIMARY KEY NOT NULL,
      notify INTEGER NOT NULL DEFAULT 1 CHECK (notify IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ],
  // Watchlist and Watched are mutually exclusive: a title you have finished is
  // no longer "to watch". Data written before that rule existed can hold both
  // rows at once; this pass drops the watchlist half and queues the matching
  // cloud tombstone so the two libraries stay in step. Rows are rewritten in
  // TypeScript below because the queued payload carries a JSON media snapshot.
  17: [],
  // Creator Studio drafts, kept on-device only: no account, no network. Rows
  // store the validated project JSON plus the summary columns the studio home
  // renders, so the drafts list never deserializes slide payloads.
  18: [
    `CREATE TABLE IF NOT EXISTS creator_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('post', 'carousel')),
      caption TEXT NOT NULL DEFAULT '',
      slide_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_creator_drafts_updated_at ON creator_drafts(updated_at DESC);`,
  ],
};

/** Columns the v17 overlap purge reads from `tracked_media`. */
interface WatchedOverlapRow {
  id: string;
  provider: 'tmdb' | 'anilist' | 'tvdb';
  provider_id: string;
  media_type: 'movie' | 'series' | 'anime';
  title: string;
  original_title: string | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_date: string | null;
  year: number | null;
  genres: string;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  season_summaries: string;
  episode_metadata: 'available' | 'unavailable';
}

function parseJsonColumn<T>(value: string | null, fallback: T): T {
  try { return JSON.parse(value ?? '') as T; } catch { return fallback; }
}

/** Same shape the sync layer queues for a watchlist row, built without SQL/JSON1. */
function librarySnapshot(row: WatchedOverlapRow): Record<string, unknown> {
  return {
    id: row.id, provider: row.provider, providerId: row.provider_id, mediaType: row.media_type,
    title: row.title, originalTitle: row.original_title ?? undefined, overview: row.overview ?? undefined,
    posterUrl: row.poster_url ?? undefined, backdropUrl: row.backdrop_url ?? undefined,
    releaseDate: row.release_date ?? undefined, year: row.year ?? undefined,
    genres: parseJsonColumn<unknown[]>(row.genres, []),
    numberOfSeasons: row.number_of_seasons ?? undefined, numberOfEpisodes: row.number_of_episodes ?? undefined,
    seasonSummaries: parseJsonColumn<unknown[]>(row.season_summaries, []),
    episodeMetadata: row.episode_metadata,
  };
}

async function ensureTrackedMediaColumns(database: SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(tracked_media)');
  const present = new Set(columns.map(({ name }) => name));
  if (!present.has('id')) throw new Error('The tracked_media table is missing its stable id column.');
  const additions: [string, string][] = [
    ['provider', "TEXT NOT NULL DEFAULT 'tmdb'"], ['provider_id', "TEXT NOT NULL DEFAULT ''"],
    ['media_type', "TEXT NOT NULL DEFAULT 'movie'"], ['title', "TEXT NOT NULL DEFAULT ''"],
    ['original_title', 'TEXT'], ['overview', 'TEXT'], ['poster_url', 'TEXT'], ['backdrop_url', 'TEXT'],
    ['release_date', 'TEXT'], ['year', 'INTEGER'], ['rating', 'REAL'], ['vote_count', 'INTEGER'],
    ['runtime_minutes', 'INTEGER'], ['status', 'TEXT'], ['language', 'TEXT'],
    ['origin_countries', "TEXT NOT NULL DEFAULT '[]'"], ['genres', "TEXT NOT NULL DEFAULT '[]'"],
    ['number_of_seasons', 'INTEGER'], ['number_of_episodes', 'INTEGER'], ['season_summaries', "TEXT NOT NULL DEFAULT '[]'"],
    ['anime_format', 'TEXT'], ['anime_season', 'TEXT'], ['popularity', 'INTEGER'], ['studios', "TEXT NOT NULL DEFAULT '[]'"],
    ['episode_metadata', "TEXT NOT NULL DEFAULT 'unavailable'"], ['created_at', 'TEXT'], ['updated_at', 'TEXT'],
  ];
  for (const [name, definition] of additions) {
    if (!present.has(name)) await database.execAsync(`ALTER TABLE tracked_media ADD COLUMN ${name} ${definition};`);
  }
  await database.execAsync("UPDATE tracked_media SET provider_id = id WHERE provider_id = '';");
}

async function ensureSyncQueueColumns(database: SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(sync_queue)');
  const present = new Set(columns.map(({ name }) => name));
  if (!present.size) throw new Error('The sync_queue table is missing after migration.');
  const additions: [string, string][] = [
    // Added ids are populated from rowid below; SQLite cannot add a new PK in place.
    ['id', 'INTEGER'],
    ['entity_type', "TEXT NOT NULL DEFAULT 'watchlist'"],
    ['entity_key', "TEXT NOT NULL DEFAULT ''"],
    ['provider', "TEXT NOT NULL DEFAULT 'tmdb'"],
    ['media_type', "TEXT NOT NULL DEFAULT 'movie'"],
    ['provider_id', "TEXT NOT NULL DEFAULT ''"],
    ['season_number', 'INTEGER'],
    ['episode_number', 'INTEGER'],
    ['is_deleted', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
    ['payload', "TEXT NOT NULL DEFAULT '{}'"],
    ['retry_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_error', 'TEXT'],
    ['rewatch_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['position', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of additions) {
    if (!present.has(name)) await database.execAsync(`ALTER TABLE sync_queue ADD COLUMN ${name} ${definition};`);
  }
  if (!present.has('id')) await database.execAsync('UPDATE sync_queue SET id = rowid WHERE id IS NULL;');
  if (!present.has('entity_key')) await database.execAsync("UPDATE sync_queue SET entity_key = 'legacy:' || rowid;");
  if (!present.has('updated_at')) await database.execAsync("UPDATE sync_queue SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = '';");
}

async function ensureLegacySyncQueueMediaJson(database: SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(sync_queue)');
  if (!columns.some(({ name }) => name === 'media_json')) {
    await database.execAsync('ALTER TABLE sync_queue ADD COLUMN media_json TEXT;');
  }
}

async function rebuildSyncQueueForFavorites(database: SQLiteDatabase): Promise<void> {
  await rebuildSyncQueueEntities(database, ['watchlist', 'movie', 'series', 'episode', 'favorite']);
}

async function ensureRewatchColumns(database: SQLiteDatabase): Promise<void> {  for (const table of ['movie_watches', 'tracked_episodes'] as const) {
    const tables = await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`);
    if (!tables.length) continue;
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some(({ name }) => name === 'rewatch_count')) {
      await database.execAsync(`ALTER TABLE ${table} ADD COLUMN rewatch_count INTEGER NOT NULL DEFAULT 0;`);
    }
  }
}

async function ensureSeriesCompletedColumns(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracked_series'");
  if (!tables.length) {
    await database.execAsync(`CREATE TABLE tracked_series (
      media_id TEXT PRIMARY KEY NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
      tracking_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  }
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(tracked_series)');
  const present = new Set(columns.map(({ name }) => name));
  if (!present.has('completed')) await database.execAsync('ALTER TABLE tracked_series ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;');
  if (!present.has('completed_at')) await database.execAsync('ALTER TABLE tracked_series ADD COLUMN completed_at TEXT;');
}

async function ensureWatchlistPriority(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'watchlist_entries'");
  if (!tables.length) return;
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(watchlist_entries)');
  if (!columns.some(({ name }) => name === 'priority')) {
    await database.execAsync('ALTER TABLE watchlist_entries ADD COLUMN priority TEXT;');
  }
}

async function ensureOrganizationColumns(database: SQLiteDatabase): Promise<void> {
  const additions: [table: string, column: string, definition: string][] = [
    ['custom_lists', 'icon', 'TEXT'],
    ['custom_lists', 'color', 'TEXT'],
    ['custom_lists', 'folder_id', 'TEXT REFERENCES list_folders(id) ON DELETE SET NULL'],
    ['watchlist_entries', 'position', 'INTEGER NOT NULL DEFAULT 0'],
    ['custom_list_items', 'position', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [table, column, definition] of additions) {
    const tables = await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`);
    if (!tables.length) continue;
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some(({ name }) => name === column)) {
      await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }
  // Preserve the existing newest-first order as explicit positions (lower sorts first).
  // Runs once with this migration version, so unconditional backfill is safe.
  for (const table of ['watchlist_entries', 'custom_list_items'] as const) {
    const tables = await database.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`);
    if (!tables.length) continue;
    await database.execAsync(`UPDATE ${table} SET position = -CAST(strftime('%s', added_at) AS INTEGER);`);
  }
}

async function rebuildSyncQueueEntities(
  database: SQLiteDatabase,
  entities: readonly string[],
  providers: readonly string[] = ['tmdb', 'anilist', 'tvdb'],
): Promise<void> {
  await ensureSyncQueueColumns(database);
  await ensureLegacySyncQueueMediaJson(database);
  const definitions = await database.getAllAsync<{ sql: string | null }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_queue'");
  if (
    entities.every((entity) => definitions[0]?.sql?.includes(`'${entity}'`)) &&
    providers.every((provider) => definitions[0]?.sql?.includes(`'${provider}'`))
  ) {
    return;
  }
  const check = entities.map((entity) => `'${entity}'`).join(', ');
  await database.execAsync(`CREATE TABLE sync_queue_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN (${check})),
    entity_key TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist', 'tvdb')),
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series', 'anime')),
    provider_id TEXT NOT NULL,
    season_number INTEGER,
    episode_number INTEGER,
    is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    media_json TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    rewatch_count INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (entity_type, entity_key)
  );`);
  await database.execAsync(`INSERT INTO sync_queue_new (id, entity_type, entity_key, provider, media_type, provider_id, season_number, episode_number, is_deleted, updated_at, payload, media_json, retry_count, last_error, rewatch_count, position)
    SELECT id, entity_type, entity_key, provider, media_type, provider_id, season_number, episode_number, is_deleted, updated_at, payload, media_json, retry_count, last_error, COALESCE(rewatch_count, 0), COALESCE(position, 0) FROM sync_queue;`);
  await database.execAsync('DROP TABLE sync_queue;');
  await database.execAsync('ALTER TABLE sync_queue_new RENAME TO sync_queue;');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_sync_queue_updated ON sync_queue(updated_at, id);');
  const sequence = await database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'");
  if (sequence.length) await database.execAsync("UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM sync_queue), 0) WHERE name = 'sync_queue';");
}

async function rebuildTrackedEpisodesForAnime(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracked_episodes'");
  if (!tables.length) return;
  const definitions = await database.getAllAsync<{ sql: string | null }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tracked_episodes'");
  if (definitions[0]?.sql?.includes("'anilist'")) return;
  await database.execAsync(`CREATE TABLE tracked_episodes_new (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'anilist', 'tvdb')),
    provider_id TEXT NOT NULL,
    series_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL CHECK (season_number >= 0),
    episode_number INTEGER NOT NULL CHECK (episode_number >= 0),
    title TEXT NOT NULL,
    overview TEXT,
    air_date TEXT,
    still_url TEXT,
    runtime_minutes INTEGER,
    watched_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rewatch_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (provider, provider_id),
    UNIQUE (series_id, season_number, episode_number)
  );`);
  await database.execAsync(`INSERT INTO tracked_episodes_new (id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes, watched_at, created_at, updated_at, rewatch_count)
    SELECT id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes, watched_at, created_at, updated_at, COALESCE(rewatch_count, 0) FROM tracked_episodes;`);
  await database.execAsync('DROP TABLE tracked_episodes;');
  await database.execAsync('ALTER TABLE tracked_episodes_new RENAME TO tracked_episodes;');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_tracked_episodes_series_order ON tracked_episodes(series_id, season_number, episode_number);');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_tracked_episodes_watched ON tracked_episodes(series_id, watched_at);');
}

const TVDB_PROVIDERS = "('tmdb', 'anilist', 'tvdb')";

async function tableSqlIncludes(database: SQLiteDatabase, table: string, snippet: string): Promise<boolean> {
  const definitions = await database.getAllAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    table,
  );
  return definitions[0]?.sql?.includes(snippet) ?? false;
}

/**
 * Widens a provider CHECK without losing rows. The table is recreated and
 * data copied; callers must run this outside a transaction with foreign keys
 * toggled off, because tracked_media is referenced by library tables.
 */
async function rebuildTrackedMediaProviders(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracked_media'",
  );
  if (!tables.length) return;
  if (await tableSqlIncludes(database, 'tracked_media', "'tvdb'")) return;
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(tracked_media)');
  // Legacy repair columns arrive nullable with NULL rows; coalesce the
  // timestamps so the rebuilt NOT NULL columns stay valid.
  const select = columns
    .map(({ name }) => (name === 'created_at' || name === 'updated_at' ? `COALESCE(${name}, CURRENT_TIMESTAMP)` : name))
    .join(', ');
  const names = columns.map(({ name }) => name).join(', ');
  await database.execAsync(`CREATE TABLE tracked_media_new (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ${TVDB_PROVIDERS}),
    provider_id TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series', 'anime')),
    title TEXT NOT NULL,
    original_title TEXT,
    overview TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    release_date TEXT,
    year INTEGER,
    rating REAL,
    vote_count INTEGER,
    runtime_minutes INTEGER,
    status TEXT,
    language TEXT,
    origin_countries TEXT NOT NULL DEFAULT '[]',
    genres TEXT NOT NULL DEFAULT '[]',
    number_of_seasons INTEGER,
    number_of_episodes INTEGER,
    season_summaries TEXT NOT NULL DEFAULT '[]',
    anime_format TEXT,
    anime_season TEXT,
    popularity INTEGER,
    studios TEXT NOT NULL DEFAULT '[]',
    episode_metadata TEXT NOT NULL DEFAULT 'unavailable' CHECK (episode_metadata IN ('available', 'unavailable')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, media_type, provider_id)
  );`);
  await database.execAsync(`INSERT INTO tracked_media_new (${names}) SELECT ${select} FROM tracked_media;`);
  await database.execAsync('DROP TABLE tracked_media;');
  await database.execAsync('ALTER TABLE tracked_media_new RENAME TO tracked_media;');
  await database.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_media_provider_identity ON tracked_media(provider, media_type, provider_id);');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_tracked_media_updated ON tracked_media(updated_at DESC);');
}

async function rebuildSyncQueueProviders(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_queue'",
  );
  if (!tables.length) return;
  if (await tableSqlIncludes(database, 'sync_queue', "'tvdb'")) return;
  await rebuildSyncQueueEntities(database, ['watchlist', 'movie', 'series', 'episode', 'favorite', 'rating', 'interested']);
}

/**
 * v17: a finished title leaves the Watchlist. Older builds allowed a movie or
 * a completed series to hold a watchlist row and a watched record at the same
 * time, which showed up in both tabs. Watched wins here: the row is dropped and
 * a watchlist tombstone is queued so the cloud copy is removed on the next sync.
 */
async function purgeWatchedFromWatchlist(database: SQLiteDatabase): Promise<void> {
  // Synthetic/legacy databases can predate the watch-state tables entirely;
  // there is nothing to purge when they are absent.
  const required = ['watchlist_entries', 'tracked_media', 'movie_watches', 'tracked_series', 'tracked_episodes'];
  const tables = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${required.map(() => '?').join(', ')})`,
    ...required,
  );
  if (tables.length < required.length) return;
  const rows = await database.getAllAsync<WatchedOverlapRow>(
    `SELECT m.* FROM watchlist_entries w
     JOIN tracked_media m ON m.id = w.media_id
     WHERE EXISTS (SELECT 1 FROM movie_watches mw WHERE mw.media_id = m.id)
        OR EXISTS (SELECT 1 FROM tracked_series ts WHERE ts.media_id = m.id AND ts.completed = 1)
        OR (m.number_of_episodes > 0
          AND EXISTS (SELECT 1 FROM tracked_series ts WHERE ts.media_id = m.id)
          AND (SELECT COUNT(*) FROM tracked_episodes e WHERE e.series_id = m.id AND e.watched_at IS NOT NULL) >= m.number_of_episodes)`,
  );
  if (!rows.length) return;
  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    const media = librarySnapshot(row);
    const payload = JSON.stringify({ media });
    await database.runAsync(
      `INSERT INTO sync_queue (entity_type, entity_key, provider, media_type, provider_id, is_deleted, updated_at, payload, media_json, rewatch_count, position)
       VALUES ('watchlist', ?, ?, ?, ?, 1, ?, ?, ?, 0, 0)
       ON CONFLICT(entity_type, entity_key) DO UPDATE SET is_deleted = 1, updated_at = excluded.updated_at,
        payload = excluded.payload, media_json = excluded.media_json, last_error = NULL`,
      row.id, row.provider, row.media_type, row.provider_id, updatedAt, payload, payload,
    );
    await database.runAsync('DELETE FROM watchlist_entries WHERE media_id = ?', row.id);
  }
}

async function rebuildTrackedEpisodesProviders(database: SQLiteDatabase): Promise<void> {
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracked_episodes'",
  );
  if (!tables.length) return;
  if (await tableSqlIncludes(database, 'tracked_episodes', "'tvdb'")) return;
  await database.execAsync(`CREATE TABLE tracked_episodes_new (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ${TVDB_PROVIDERS}),
    provider_id TEXT NOT NULL,
    series_id TEXT NOT NULL REFERENCES tracked_media(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL CHECK (season_number >= 0),
    episode_number INTEGER NOT NULL CHECK (episode_number >= 0),
    title TEXT NOT NULL,
    overview TEXT,
    air_date TEXT,
    still_url TEXT,
    runtime_minutes INTEGER,
    watched_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rewatch_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (provider, provider_id),
    UNIQUE (series_id, season_number, episode_number)
  );`);
  await database.execAsync(`INSERT INTO tracked_episodes_new (id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes, watched_at, created_at, updated_at, rewatch_count)
    SELECT id, provider, provider_id, series_id, season_number, episode_number, title, overview, air_date, still_url, runtime_minutes, watched_at, created_at, updated_at, COALESCE(rewatch_count, 0) FROM tracked_episodes;`);
  await database.execAsync('DROP TABLE tracked_episodes;');
  await database.execAsync('ALTER TABLE tracked_episodes_new RENAME TO tracked_episodes;');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_tracked_episodes_series_order ON tracked_episodes(series_id, season_number, episode_number);');
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_tracked_episodes_watched ON tracked_episodes(series_id, watched_at);');
}

export async function runMigrations(database: SQLiteDatabase): Promise<void> {
  try {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
      const applied = await transaction.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
      const known = new Set(applied.map((row) => row.version));

      for (const [versionText, statements] of Object.entries(migrations)) {
        const version = Number(versionText);
        if (known.has(version)) continue;
        if (version === 15) continue; // recorded post-transaction after the rebuild below
        if (version === 3) {
          // Re-run CREATE TABLE IF NOT EXISTS statements from v2 to ensure all
          // child tables exist, then add columns missing from early v2 builds.
          for (const statement of migrations[2]) if (statement.startsWith('CREATE TABLE')) await transaction.execAsync(statement);
          await ensureTrackedMediaColumns(transaction);
          for (const statement of migrations[2]) if (statement.includes(' INDEX IF NOT EXISTS ')) await transaction.execAsync(statement);
        } else if (version === 5) {
          await ensureSyncQueueColumns(transaction);
        } else if (version === 6) {
          await ensureSyncQueueColumns(transaction);
          await ensureLegacySyncQueueMediaJson(transaction);
        } else if (version === 7) {
          for (const statement of statements) await transaction.execAsync(statement);
          await rebuildSyncQueueForFavorites(transaction);
        } else if (version === 8) {
          for (const statement of statements) await transaction.execAsync(statement);
          await ensureRewatchColumns(transaction);
          await rebuildSyncQueueEntities(transaction, ['watchlist', 'movie', 'series', 'episode', 'favorite', 'rating']);
        } else if (version === 9) {
          for (const statement of statements) await transaction.execAsync(statement);
          await ensureSyncQueueColumns(transaction);
          await ensureOrganizationColumns(transaction);
        } else if (version === 10) {
          for (const statement of statements) await transaction.execAsync(statement);
          await rebuildSyncQueueEntities(transaction, ['watchlist', 'movie', 'series', 'episode', 'favorite', 'rating', 'interested']);
        } else if (version === 11) {
          await ensureSeriesCompletedColumns(transaction);
        } else if (version === 12) {
          await ensureWatchlistPriority(transaction);
        } else if (version === 13) {
          for (const statement of statements) await transaction.execAsync(statement);
        } else if (version === 14) {
          await rebuildTrackedEpisodesForAnime(transaction);
        } else if (version === 17) {
          await purgeWatchedFromWatchlist(transaction);
        } else {
          for (const statement of statements) await transaction.execAsync(statement);
        }
        await transaction.runAsync('INSERT INTO schema_migrations (version) VALUES (?)', version);
      }
      await transaction.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
    });
    // v15 runs after the migration transaction commits so foreign keys can
    // be toggled around the tracked_media rebuild. Each step is idempotent.
    const appliedVersions = await database.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
    if (!appliedVersions.some((row) => row.version === 15)) {
      await database.execAsync('PRAGMA foreign_keys = OFF;');
      try {
        await rebuildTrackedMediaProviders(database);
        await rebuildSyncQueueProviders(database);
        await rebuildTrackedEpisodesProviders(database);
      } finally {
        await database.execAsync('PRAGMA foreign_keys = ON;');
      }
      await database.runAsync('INSERT INTO schema_migrations (version) VALUES (?)', 15);
    }
  } catch (error) {
    throw new AppError('database', 'The local database could not be initialized.', { cause: error });
  }
}
