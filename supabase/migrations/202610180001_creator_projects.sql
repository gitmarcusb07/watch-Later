-- Creator Studio projects: user-owned posts and carousels. One row per saved
-- project; the editable slide composition lives in `slide_data` as versioned
-- JSON (validated by the app before it is trusted) so template evolution does
-- not need column changes.

create table if not exists public.creator_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  template_id text not null check (template_id in (
    'movie-spotlight',
    'series-spotlight',
    'top5',
    'top10',
    'movie-comparison',
    'watchlist-collection',
    'upcoming-releases'
  )),
  format text not null check (format in ('post', 'carousel')),
  aspect_ratio text not null default '4:5' check (aspect_ratio = '4:5'),
  -- Versioned slide composition. The app validates the full shape; the
  -- database still refuses non-objects and payloads without a slide array.
  slide_data jsonb not null check (
    jsonb_typeof(slide_data) = 'object'
    and slide_data ? 'slides'
    and jsonb_typeof(slide_data -> 'slides') = 'array'
  ),
  caption text not null default '' check (char_length(caption) <= 2200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Studio home lists a user's drafts newest-first.
create index if not exists creator_projects_user_updated_idx
  on public.creator_projects(user_id, updated_at desc);

alter table public.creator_projects enable row level security;

-- Owner-scoped CRUD only. Rendered images stay on-device and are never
-- uploaded by the app.
create policy "Creator projects select own" on public.creator_projects for select to authenticated using (user_id = (select auth.uid()));
create policy "Creator projects insert own" on public.creator_projects for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Creator projects update own" on public.creator_projects for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Creator projects delete own" on public.creator_projects for delete to authenticated using (user_id = (select auth.uid()));

-- Table-level privileges (RLS policies alone are not enough — without these
-- every role gets HTTP 403 / 42501).
grant select, insert, update, delete on public.creator_projects to authenticated;

-- Keep updated_at honest on every edit (same pattern as ott_releases).
create or replace function public.creator_projects_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists creator_projects_touch_updated_at on public.creator_projects;
create trigger creator_projects_touch_updated_at
  before update on public.creator_projects
  for each row execute function public.creator_projects_touch_updated_at();
