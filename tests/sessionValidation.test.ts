import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateSession } from '@/store/app/sessionPersistence';
import { useSessionStore } from '@/store/app/sessionStore';

// Public builds ship with accounts off. This suite covers the dormant cloud
// session code, so opt it into auth explicitly.
jest.mock('@/config/features', () => ({ AUTH_ENABLED: true }));

jest.mock('@/data/remote/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
  supabaseAuthStoragePrefix: () => 'sb-testproject-auth-token',
}));

const { supabase } = jest.requireMock('@/data/remote/supabase/client') as {
  supabase: { auth: { getSession: jest.Mock; getUser: jest.Mock; signOut: jest.Mock } };
};

const KEY = 'watch-later.session.v1';
const savedAuthenticated = { session: { mode: 'authenticated', userId: 'deleted-user', email: 'gone@example.test' }, onboardingComplete: true };

/**
 * `getSession()` restores whatever token is on disk, including one left behind
 * by an account deleted afterwards. The server is the authority: the stored
 * session must never sign the user back into a deleted account.
 */
describe('session hydration validates the restored account', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSessionStore.setState({ session: { mode: 'unauthenticated' }, onboardingComplete: false, hasHydrated: false });
    supabase.auth.getSession.mockReset();
    supabase.auth.getUser.mockReset();
    supabase.auth.signOut.mockClear();
  });

  it('sweeps a stored session the server no longer recognises and falls back to guest', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(savedAuthenticated));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'deleted-user', email: 'gone@example.test' } } } });
    // The account is gone: no user resolves and the error is an auth verdict.
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'User from claim that no longer exists' } });

    await hydrateSession();

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useSessionStore.getState().session.mode).toBe('guest');
    expect(useSessionStore.getState().onboardingComplete).toBe(true);
    const persisted = JSON.parse(await AsyncStorage.getItem(KEY) ?? 'null') as { session: { mode: string } } | null;
    expect(persisted?.session.mode).toBe('guest');
    // The dead token must be gone from disk too.
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('adopts a live account session from the server', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ session: { mode: 'guest', userId: 'guest-1' }, onboardingComplete: true }));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'live-user', email: 'viewer@example.test' } } } });
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'live-user', email: 'viewer@example.test' } }, error: null });

    await hydrateSession();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toEqual({ mode: 'authenticated', userId: 'live-user', email: 'viewer@example.test' });
  });

  it('keeps the session when the liveness check fails on the network (offline launch)', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(savedAuthenticated));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'deleted-user', email: 'gone@example.test' } } } });
    supabase.auth.getUser.mockRejectedValue(new Error('Network request failed'));

    await hydrateSession();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toEqual({ mode: 'authenticated', userId: 'deleted-user', email: 'gone@example.test' });
  });

  it('treats a transport error answer (Failed to fetch) as unverifiable, not as a deleted account', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(savedAuthenticated));
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'deleted-user', email: 'gone@example.test' } } } });
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Failed to fetch' } });

    await hydrateSession();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session.mode).toBe('authenticated');
  });

  it('falls back to guest when no Supabase session is stored at all', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(savedAuthenticated));
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    await hydrateSession();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session.mode).toBe('guest');
  });

  it('never sweeps a Clerk session as a dead Supabase session', async () => {
    const clerkSession = { session: { mode: 'authenticated', userId: 'user_clerk_1', email: 'viewer@example.test', provider: 'clerk' }, onboardingComplete: true };
    await AsyncStorage.setItem(KEY, JSON.stringify(clerkSession));
    // Supabase knows nothing (Clerk identities have no Supabase session).
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    await hydrateSession();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toEqual(clerkSession.session);
  });
});
