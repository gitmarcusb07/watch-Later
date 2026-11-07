import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateSession } from '@/store/app/sessionPersistence';
import { useSessionStore } from '@/store/app/sessionStore';

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

/**
 * Public builds set AUTH_ENABLED=false: the app is local-only, so startup must
 * never restore a cloud session or call Supabase.
 */
describe('local-only session hydration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSessionStore.setState({ session: { mode: 'unauthenticated' }, onboardingComplete: false, hasHydrated: false });
    supabase.auth.getSession.mockClear();
    supabase.auth.getUser.mockClear();
    supabase.auth.signOut.mockClear();
  });

  it('keeps the stored guest id and never touches Supabase', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({
      session: { mode: 'guest', userId: 'guest-stable' },
      onboardingComplete: true,
    }));

    await hydrateSession();

    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toEqual({ mode: 'guest', userId: 'guest-stable' });
    expect(useSessionStore.getState().onboardingComplete).toBe(true);
  });

  it('drops a stored cloud session to guest but keeps onboarding complete', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({
      session: { mode: 'authenticated', userId: 'cloud-user', email: 'viewer@example.test' },
      onboardingComplete: true,
    }));

    await hydrateSession();

    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session.mode).toBe('guest');
    expect(useSessionStore.getState().onboardingComplete).toBe(true);
  });
});
