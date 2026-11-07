import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_ENABLED } from '@/config/features';
import type { SessionState } from '@/domain/models/session';
import { useSessionStore } from './sessionStore';
import { supabase } from '@/data/remote/supabase/client';
import { isNetworkAuthError } from '@/lib/netError';

const KEY = 'watch-later.session.v1';
interface PersistedSession {
  session: SessionState;
  onboardingComplete: boolean;
}

/**
 * True when the stored Supabase session still belongs to a live account.
 *
 * `getSession()` restores whatever token is on disk, including one left behind
 * by an account that was deleted afterwards — a perfectly valid-looking
 * session that would sign the user straight back in with no library. The
 * server is the authority: `getUser()` fails once the auth user is gone.
 * Offline, the session cannot be disproven, so it is kept.
 */
async function isLiveSupabaseSession(client: NonNullable<typeof supabase>): Promise<boolean> {
  if (!client.auth.getUser) return true;
  try {
    const { data, error } = await client.auth.getUser();
    if (data.user) return true;
    // A transport failure cannot disprove the session: keep it and let the
    // next online launch re-check. Only a real auth verdict (the user no
    // longer resolves) means the account is gone.
    if (error && isNetworkAuthError(error)) return true;
    return false;
  } catch {
    return true; // offline / unreachable: keep the session usable
  }
}

export async function hydrateSession(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) as PersistedSession : undefined;
    if (!AUTH_ENABLED) {
      // Local-only build: keep onboarding state and the stored guest id, but
      // never restore or validate a cloud session. This also avoids the
      // Supabase getUser() network check on startup.
      const guest = saved?.session.mode === 'guest'
        ? saved.session
        : { mode: 'guest' as const, userId: `guest-${Date.now()}` };
      const onboardingComplete = saved?.onboardingComplete ?? false;
      useSessionStore.getState().setSession(guest);
      useSessionStore.getState().setOnboardingComplete(onboardingComplete);
      await persistSession(guest, onboardingComplete);
      return;
    }
    if (saved?.session && typeof saved.onboardingComplete === 'boolean') {
      useSessionStore.getState().setSession(saved.session);
      useSessionStore.getState().setOnboardingComplete(saved.onboardingComplete);
    }
    // A Clerk session is validated by ClerkProvider itself (the bridge feeds
    // Supabase on demand): never sweep it as a dead Supabase session.
    if (saved?.session.mode === 'authenticated' && 'provider' in saved.session && saved.session.provider === 'clerk') return;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const storedUser = data.session?.user ?? null;
      const live = storedUser ? await isLiveSupabaseSession(supabase) : false;
      if (live && storedUser) {
        const authenticated = { mode: 'authenticated' as const, userId: storedUser.id, email: storedUser.email ?? '' };
        useSessionStore.getState().setSession(authenticated);
        if (saved) await persistSession(authenticated, saved.onboardingComplete);
      } else {
        // A stored session that the server no longer recognises belongs to a
        // deleted (or revoked) account: sweep it so nothing can re-adopt it.
        if (storedUser) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (saved?.session.mode === 'authenticated') {
          const guest = { mode: 'guest' as const, userId: `guest-${Date.now()}` };
          useSessionStore.getState().setSession(guest);
          await persistSession(guest, saved.onboardingComplete);
        }
      }
    } else if (saved?.session.mode === 'authenticated') {
      const guest = { mode: 'guest' as const, userId: `guest-${Date.now()}` };
      useSessionStore.getState().setSession(guest);
      await persistSession(guest, saved.onboardingComplete);
    }
  } catch {
    await AsyncStorage.removeItem(KEY);
  } finally {
    useSessionStore.getState().setHasHydrated(true);
  }
}

export async function persistSession(session: SessionState, onboardingComplete: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ session, onboardingComplete } satisfies PersistedSession));
}
