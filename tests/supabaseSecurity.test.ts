import { readFileSync } from 'node:fs';

describe('Supabase watch-state security migration', () => {
  const sql = readFileSync('supabase/migrations/202610060001_watch_state.sql', 'utf8').toLowerCase();
  const tables = ['profiles', 'library_media', 'watchlist_entries', 'movie_watches', 'tracked_series', 'episode_watches'];

  it.each(tables)('enables RLS and owner-scoped read/write policies for %s', (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toMatch(new RegExp(`create policy ".*" on public\\.${table} for select to authenticated using \\((?:id|user_id) = \\(select auth\\.uid\\(\\)\\)\\)`));
    expect(sql).toMatch(new RegExp(`create policy ".*" on public\\.${table} for insert to authenticated with check \\((?:id|user_id) = \\(select auth\\.uid\\(\\)\\)\\)`));
    expect(sql).toMatch(new RegExp(`create policy ".*" on public\\.${table} for update to authenticated using \\((?:id|user_id) = \\(select auth\\.uid\\(\\)\\)\\) with check \\((?:id|user_id) = \\(select auth\\.uid\\(\\)\\)\\)`));
    expect(sql).toMatch(new RegExp(`create policy ".*" on public\\.${table} for delete to authenticated using \\((?:id|user_id) = \\(select auth\\.uid\\(\\)\\)\\)`));
  });

  it('uses normalized provider-qualified entities and explicit tombstones', () => {
    expect(sql).toContain('primary key (user_id, provider, media_type, provider_id)');
    expect(sql).toContain('primary key (user_id, episode_provider_id)');
    expect(sql).toContain('is_deleted boolean not null default false');
    expect(sql).toContain('foreign key (user_id, provider, media_type, provider_id) references public.library_media');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});

describe('Supabase favorites security migration', () => {
  const sql = readFileSync('supabase/migrations/202610060003_favorites.sql', 'utf8').toLowerCase();

  it('enables owner-scoped RLS and grants for favorite_entries', () => {
    expect(sql).toContain('alter table public.favorite_entries enable row level security');
    expect(sql).toMatch(/create policy ".*" on public\.favorite_entries for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.favorite_entries for insert to authenticated with check \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.favorite_entries for update to authenticated using \(user_id = \(select auth\.uid\(\)\)\) with check \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.favorite_entries for delete to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toContain('grant select, insert, update, delete on public.favorite_entries to authenticated');
    expect(sql).not.toMatch(/to anon|to public\b/);
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});

describe('Supabase interested security migration', () => {
  const sql = readFileSync('supabase/migrations/202610060006_interested.sql', 'utf8').toLowerCase();

  it('keeps raw marks owner-scoped but exposes only aggregated real counts', () => {
    expect(sql).toContain('alter table public.interested_marks enable row level security');
    expect(sql).toMatch(/create policy ".*" on public\.interested_marks for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toContain('grant select, insert, update, delete on public.interested_marks to authenticated');
    expect(sql).toContain('create or replace function public.get_interested_counts()');
    expect(sql).toContain('security definer');
    expect(sql).toContain('grant execute on function public.get_interested_counts() to authenticated');
    expect(sql).toContain('grant execute on function public.get_interested_counts() to anon');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});

describe('Supabase series completion migration', () => {
  const sql = readFileSync('supabase/migrations/202610060007_series_completed.sql', 'utf8').toLowerCase();

  it('adds explicit completion columns without touching RLS ownership', () => {
    expect(sql).toContain('completed');
    expect(sql).toContain('completed_at');
    expect(sql).toContain('alter table public.tracked_series');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});

describe('Supabase anime episodes migration', () => {
  const sql = readFileSync('supabase/migrations/202610090009_anime_episodes.sql', 'utf8').toLowerCase();

  it('widens episode_watches to the anilist provider and anime media type', () => {
    expect(sql).toContain('episode_watches');
    expect(sql).toContain(`('tmdb', 'anilist')`);
    expect(sql).toContain(`('series', 'anime')`);
  });
});

describe('Supabase OTT releases migration', () => {
  const sql = readFileSync('supabase/migrations/202610100001_ott_releases.sql', 'utf8').toLowerCase().replace(/\s+/g, ' ');

  it('exposes verified announcements for public read but no client writes', () => {
    expect(sql).toContain('alter table public.ott_releases enable row level security');
    expect(sql).toMatch(/create policy ".*" on public\.ott_releases for select to anon, authenticated using \(true\)/);
    expect(sql).not.toMatch(/for insert to (anon|authenticated)/);
    expect(sql).not.toMatch(/for update to (anon|authenticated)/);
    expect(sql).not.toMatch(/for delete to (anon|authenticated)/);
  });

  it('dedupes per movie, platform, country, and release event with honest precision', () => {
    expect(sql).toContain('unique (provider, media_type, provider_id, platform, country, is_premiere)');
    expect(sql).toContain(`check (date_precision in ('exact', 'month', 'year', 'unknown'))`);
    expect(sql).toContain('last_verified_at');
  });
});
describe('Supabase watchlist priority migration', () => {
  const sql = readFileSync('supabase/migrations/202610060008_watchlist_priority.sql', 'utf8').toLowerCase();

  it('adds a nullable priority column without touching RLS ownership', () => {
    expect(sql).toContain('priority');
    expect(sql).toContain('alter table public.watchlist_entries');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});

describe('Supabase creator projects migration', () => {
  const sql = readFileSync('supabase/migrations/202610180001_creator_projects.sql', 'utf8').toLowerCase();

  it('keeps drafts owner-scoped with grants and a touch trigger', () => {
    expect(sql).toContain('alter table public.creator_projects enable row level security');
    expect(sql).toMatch(/create policy ".*" on public\.creator_projects for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.creator_projects for insert to authenticated with check \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.creator_projects for update to authenticated using \(user_id = \(select auth\.uid\(\)\)\) with check \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/create policy ".*" on public\.creator_projects for delete to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toContain('grant select, insert, update, delete on public.creator_projects to authenticated');
    expect(sql).not.toMatch(/to anon|to public\b/);
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('validates template ids, formats, and the fixed 4:5 ratio with a latest-first index', () => {
    expect(sql).toContain(`check (template_id in (`);
    expect(sql).toContain(`'movie-spotlight'`);
    expect(sql).toContain(`'upcoming-releases'`);
    expect(sql).toContain(`check (format in ('post', 'carousel'))`);
    expect(sql).toContain(`check (aspect_ratio = '4:5')`);
    expect(sql).toContain(`jsonb_typeof(slide_data) = 'object'`);
    expect(sql).toContain(`slide_data ? 'slides'`);
    expect(sql).toContain(`jsonb_typeof(slide_data -> 'slides') = 'array'`);
    expect(sql).toContain('create index if not exists creator_projects_user_updated_idx');
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain('updated_at timestamptz not null default now()');
    expect(sql).toContain('creator_projects_touch_updated_at');
    expect(sql).toContain('new.updated_at = now()');
  });
});
