import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export interface Database {
  public: {
    Tables: {
      library_media: Table<CloudMediaRow>;
      watchlist_entries: Table<CloudStateRow & { added_at: string; position?: number | null; priority?: string | null }>;
      movie_watches: Table<CloudStateRow & { watched_at: string | null; rewatch_count?: number | null }>;
      tracked_series: Table<CloudStateRow & { tracking_started_at: string; completed?: boolean | null; completed_at?: string | null }>;
      episode_watches: Table<CloudEpisodeRow>;
      favorite_entries: Table<CloudStateRow & { favorited_at: string }>;
      user_ratings: Table<CloudStateRow & { rating: number | null; thumbs: number }>;
      interested_marks: Table<CloudStateRow & { title: string; poster_url: string | null; release_date: string | null; marked_at: string }>;
      ott_releases: Table<CloudOttReleaseRow>;
      profiles: Table<{ id: string; created_at: string; updated_at: string }>;
      global_hit_reports: Table<CloudHitReportRow>;
      imdb_ratings: Table<CloudImdbRatingRow>;
      creator_projects: Table<CloudCreatorProjectRow, Omit<CloudCreatorProjectRow, 'id' | 'created_at' | 'updated_at'>>;
    };
    Views: Record<string, never>;
    Functions: { get_interested_counts: { Args: Record<string, never>; Returns: { provider: string; media_type: string; provider_id: string; interested_count: number }[] } };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Row> = { Row: Row; Insert: Insert; Update: Partial<Row>; Relationships: [] };
type CloudMediaRow = { user_id: string; provider: string; media_type: string; provider_id: string; title: string; original_title: string | null; overview: string | null; poster_url: string | null; backdrop_url: string | null; release_date: string | null; year: number | null; genres: Json; number_of_seasons: number | null; number_of_episodes: number | null; season_summaries: Json; episode_metadata: string; updated_at: string };
type CloudHitReportRow = { period_type: string; period_key: string; generated_at: string; retrieved_at: string; methodology: string; status: string; movie_items: Json; series_items: Json };
type CloudCreatorProjectRow = { id: string; user_id: string; name: string; template_id: string; format: string; aspect_ratio: string; slide_data: Json; caption: string; created_at: string; updated_at: string };
type CloudImdbRatingRow = { tmdb_id: number; media_type: string; imdb_id: string; title: string; year: number | null; poster_url: string | null; rating: number; votes: number; list_rank: number | null; updated_at: string };
type CloudStateRow = { user_id: string; provider: string; media_type: string; provider_id: string; is_deleted: boolean; updated_at: string };
type CloudEpisodeRow = { user_id: string; provider: string; episode_provider_id: string; series_provider: string; series_media_type: string; series_provider_id: string; season_number: number; episode_number: number; title: string; overview: string | null; air_date: string | null; still_url: string | null; runtime_minutes: number | null; watched_at: string | null; is_deleted: boolean; updated_at: string; rewatch_count?: number | null };
export type CloudOttReleaseRow = {
  id: string; provider: string; media_type: string; provider_id: string; movie_title: string;
  platform: string; platform_logo_url: string | null; tmdb_provider_id: number | null; country: string;
  theatrical_date: string | null; ott_date: string | null; date_precision: string; status: string;
  source_url: string | null; source_published_at: string | null; last_verified_at: string;
  created_at: string; updated_at: string; notes: string | null; is_premiere: boolean;
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient<Database>(url, anonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          // Native Google sign-in must use PKCE: the authorize URL carries a
          // code_challenge and the callback returns `?code=…`, which
          // SupabaseAuthService exchanges via exchangeCodeForSession. The
          // verifier is kept in the same AsyncStorage by the client.
          flowType: 'pkce',
        },
      })
    : null;

/**
 * Clerk JWT provider for Supabase's third-party auth. Registered by
 * `ClerkSupabaseBridge` (mounted inside `ClerkProvider`) and cleared on
 * sign-out. Null while the Clerk session is absent — data callers then fall
 * back to the Supabase-authenticated singleton above.
 *
 * A separate client is required (not `accessToken` on the singleton):
 * supabase-js disables `supabase.auth.*` on a client configured with
 * `accessToken`, and this app's email/password, PKCE, sign-out, deletion,
 * and listener flows all need `auth.*` alive.
 */
let clerkTokenProvider: (() => Promise<string | null>) | null = null;

export function setClerkTokenProvider(provider: (() => Promise<string | null>) | null): void {
  clerkTokenProvider = provider;
  // The data client below caches nothing auth-related per request (the token
  // is resolved per call), so swapping the provider is enough — but drop the
  // client itself on sign-out so no Clerk-authed instance lingers.
  if (!provider) clerkDataClient = null;
}

/** Fresh `supabase`-template Clerk JWT, or null outside a Clerk session. */
export async function getClerkToken(): Promise<string | null> {
  try {
    return (await clerkTokenProvider?.()) ?? null;
  } catch {
    return null;
  }
}

let clerkDataClient: NonNullable<typeof supabase> | null = null;

/**
 * Client for user-scoped data (RLS) writes/reads. Returns a Clerk-authed
 * client when a Clerk session is live, else the Supabase-authenticated
 * singleton. Throws when cloud sync is unconfigured, like before.
 */
export async function dataClient(): Promise<NonNullable<typeof supabase>> {
  const token = await getClerkToken();
  if (token) {
    if (!url || !anonKey) throw new Error('Cloud sync is not configured on this device.');
    clerkDataClient ??= createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => (await getClerkToken()) ?? '',
    });
    return clerkDataClient;
  }
  if (!supabase) throw new Error('Cloud sync is not configured on this device.');
  return supabase;
}

/**
 * AsyncStorage key prefix supabase-js uses to persist the session, the user,
 * and every PKCE verifier slot — all of which begin
 * `sb-<project-ref>-auth-token`. This client relies on supabase-js's default
 * derivation, so account deletion can sweep every key under that prefix and
 * wipe them directly. That matters because once the auth user is gone
 * server-side its refresh token is dead, and `signOut()` bails out on that
 * error *before* touching storage — which is precisely what left a deleted
 * account's session behind to sign the user back in on next launch.
 */
export function supabaseAuthStoragePrefix(): string | null {
  if (!url) return null;
  try {
    return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}
