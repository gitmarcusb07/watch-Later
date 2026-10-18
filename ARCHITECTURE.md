# Architecture

## Project structure and flow

Expo Router owns route composition under `app/`. Route components compose reusable controls from `src/components/` and call feature-level services; data access stays in repositories and data sources. Feature logic lives in `src/features/`, domain contracts and models in `src/domain/`, and implementations in `src/data/`.

The intended dependency direction is UI → feature/use case → domain contract → repository/data source. UI components do not issue SQL or call Supabase directly.

## State ownership

- Zustand contains client state only: session mode, onboarding completion, and future UI preferences.
- AsyncStorage persists the small session/onboarding envelope. Guest content belongs in SQLite, never Zustand.
- TanStack Query owns remote catalog/server state and is not used as a local user-data database.
- Expo SQLite is the runtime source of truth for watch state for guests and authenticated users.
- The SQLite outbox records pending watch-state mutations and tombstones. Supabase availability never gates a local mutation.

## Local database

`getDatabase()` opens one lazily initialized `watch-later.db` connection, enables foreign keys and WAL, and runs exclusive, versioned migrations. Migration history is recorded in `schema_migrations`, and schema version is reflected by SQLite `user_version`. Migration v4 adds a durable sync outbox and single-account device binding without replacing the Phase 4 watch-state tables.

`SqliteDatabaseRepository` initializes the database and `SqliteWatchStateRepository` owns watch-state and sync operations. Transactions belong at the database/data layer.

## Guest and account ownership

Session is a discriminated union: `unauthenticated`, `guest`, or `authenticated`. Guest entry requires no account and survives app restarts. Supabase Auth owns authenticated token persistence in AsyncStorage; the app session store contains only mode, user ID, and email. Auth restoration does not gate the local library after normal startup hydration.

On sign-in or account creation, the local repository binds SQLite state to that Supabase user and queues its current watchlist, movie watches, tracked series, and watched episodes. The sync service fetches that user's cloud records, merges by provider-qualified entity key and UTC `updated_at`, applies remote-only/newer records in a SQLite transaction, and uploads local-only/newer records. Equal timestamps deterministically favor the local mutation. Cloud removals and unwatches are tombstones. Remote-applied rows bypass the outbox to prevent loops. Failed uploads remain queued for retry.

For safety, the local database records the first account that syncs on a device. Sign-in to a different account on that device is refused; this prevents retained local data from one account from leaking into another. Sign-out clears only the Supabase session and returns to guest mode; it does not delete SQLite data or pending work.

## Supabase and remote media catalog

Supabase is initialized in `src/data/remote/supabase/client.ts` only when the public URL and anon key are configured. `SupabaseAuthService` handles email/password sign-up, sign-in, and sign-out. `SupabaseWatchStateRepository` is the cloud adapter; `SyncService` owns merge and retry orchestration. The cloud migration creates user-owned media metadata, watchlist entries, movie watches, tracked series, and episode watches. Every table enables RLS and scopes CRUD to `auth.uid()`. The service-role key must never ship in the client.

Catalog screens call feature query hooks, which use the domain `CatalogRepository` contract and its remote implementation. TMDb and AniList API clients and provider response mappers live under `src/data/remote/`; UI components receive only normalized domain media and episode models. Provider-qualified IDs preserve catalog identity across sources. TanStack Query caches search, detail, and season requests in memory. AniList currently supplies anime metadata but not episode-level data through the selected public query.

Expo client variables use the `EXPO_PUBLIC_` prefix and are embedded in the app bundle. The TMDb API key is therefore a client API credential, not a server secret; keep it local and out of source control and logs. SQLite stores only the metadata snapshot attached to a user's library entries; it does not mirror the catalog.

## Navigation

The route tree has welcome, login, and create-account paths plus five bottom tabs: Home, Upcoming, Watchlist, Watched, and More. Search lives one tap away in the home top bar, next to the browse shortcut. Route names are URL/deep-link friendly; modal presentation is used for auth placeholders. Expo Router handles native back behavior and preserves tab stacks.

## India OTT release tracker

Verified OTT announcements live in Supabase `public.ott_releases` (see `supabase/migrations/202610100001_ott_releases.sql`): public read for anon + authenticated, no client write policies — only the service-role key (dashboard table editor or admin edge function) may write. The Expo app never holds the service-role key. SQLite migration v16 mirrors the table as an offline cache (`ott_releases`) plus local notify-me prefs (`ott_notify_prefs`).

Domain contracts sit in `src/domain/models/ottRelease.ts` (`OttReleaseRecord`: provider-qualified movie id, platform, `country` defaulting to `IN`, precision-aware `ottReleaseDate`, `confirmed | expected | window_announced | platform_announced | unannounced | released` status, source URL, verification timestamps) with validation and precision-aware labels in `src/features/ott/`. `OttReleaseService` merges verified records (remote-first, SQLite fallback) with live TMDB `IN` availability via `getWatchProvidersForRegion` — current streaming only, never presented as a future premiere, and never inferred from theatrical dates. UI: `OttReleaseSection` on the media details screen and the `Upcoming on OTT` screen (`app/ott-upcoming.tsx`, linked from More → Discover and the Upcoming tab). Notify-me persists per-record prefs in SQLite and schedules one local notification per exact future date through `expo-notifications`; month/year windows never schedule. `refreshOttReminders()` re-registers alerts on foreground (granted-permission only, 15-min cooldown) so postponed dates self-correct; Settings → Notifications has a 10-second test alert. Release administration is `app/ott-admin.tsx` (More → OTT release admin): device-local PIN gate plus per-session service-role key (never stored) writing through `ottAdminApi`; validation is shared with the domain gate. Additional countries reuse the same record shape with a different `country` code.

## Creator Studio

Creator Studio turns catalog metadata the user already has into Instagram-ready posts and carousels. It is reachable from More → Create → Creator Studio (`/creator`) and offers five seeds built from existing cached reads (watchlist, trending, upcoming, Global Hits month/year), the seven typed templates, and a signed-in user's saved drafts. Guests keep the full create/edit/export flow; drafts are the only signed-in feature.

Authoring is template-based, never a free-position canvas. `src/domain/models/creator.ts` defines the versioned `CreatorProjectData` JSON (theme, accent, branding, bounded slides). `src/features/creator/templates.ts` is the single registry of template capabilities (title counts, slide caps, default copy), and `src/components/creator/templates/` renders each template from bounded `CreatorTitleRef` snapshots. Snapshots (title, year, release date, poster, rating, genres, seasons, streaming names) are captured at selection time, so a draft renders with no catalog request and missing fields stay hidden — dates, ratings, and availability are never fabricated. `src/features/creator/validation.ts` parses every stored row defensively and bounds arrays and text.

The editor (`app/creator/editor.tsx`) owns state through the pure reducer in `src/features/creator/useCreatorEditor.ts`; canvases receive primitives and are memoized, so editing one slide does not re-render the rest. Slide canvases are authored at 360×450 (exact 4:5) and captured at 1080×1350 by `src/components/creator/export/SlideExportStage.tsx` using `react-native-view-shot`. Exports run on demand from the export sheet, either the current slide or all slides in order. Saving asks for photo permission at that moment (`expo-media-library`); sharing opens the system sheet (`expo-sharing`). Rendered PNGs stay on the device and are never uploaded.

Caption suggestions and hashtags (`src/features/creator/captions.ts`) are pure, deterministic rules over the project's own snapshots — no AI key or network. Copying uses `expo-clipboard`.

Drafts live in Supabase `public.creator_projects` (migration `202610180001_creator_projects.sql`): one owner-scoped row per project with validated `template_id`/`format`/`aspect_ratio` columns and versioned `slide_data` JSON, owner CRUD RLS, an `updated_at` trigger, and a `(user_id, updated_at desc)` index. Reads and writes use `dataClient()` (Clerk JWT when present, else the Supabase session) and `parseCreatorProjectRow`; guests never query drafts.

## Design system

All semantic colors, typography, spacing, radius, and shadows live under `src/theme/`. The UI uses a dark cinematic base, lavender accent, restrained gradients, rounded surfaces, and Expo vector icons.
