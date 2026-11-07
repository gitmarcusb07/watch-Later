import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CloudWatchStateRepository, PendingWatchStateChange, WatchStateSyncRepository } from '@/domain/models/watchState';
import { mapTmdbMovie, mapTmdbTv } from '@/data/remote/tmdb/mappers';
import { runMigrations } from '@/data/local/database/migrations';
import { SqliteWatchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { SyncService, syncService } from '@/features/sync/SyncService';
import { createSqliteTestAdapter } from './sqliteTestAdapter';
import { useAppearanceStore } from '@/store/app/appearanceStore';
import { useNotificationStore } from '@/store/app/notificationStore';
import { useSessionStore } from '@/store/app/sessionStore';
import { useSyncStore } from '@/store/app/syncStore';
import { useDialogStore } from '@/components/feedback/AppDialog';
import NotificationsScreen from '../app/settings/notifications';
import AboutScreen from '../app/about';
import MoreScreen from '../app/(tabs)/more';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

jest.mock('react-native-reanimated', () => {
  const entering = { duration: () => entering, delay: () => entering, withInitialValues: () => entering };
  return { __esModule: true, default: { View: 'View' }, View: 'View', useReducedMotion: () => false, FadeIn: entering, FadeInDown: entering, FadeInUp: entering };
});

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));

// MoreScreen signs out of Clerk alongside Supabase; no provider exists under test.
jest.mock('@clerk/expo', () => ({
  useClerk: () => ({ signOut: jest.fn().mockResolvedValue(undefined), user: null }),
  useSSO: () => ({ startSSOFlow: jest.fn() }),
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue(null), isSignedIn: false }),
}));

// Backup file flows are exercised in repository tests; UI tests never touch them.
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue('{}'),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }) }));

function movie(id: number) {
  return mapTmdbMovie({ id, title: `Film ${id}`, overview: 'Story', poster_path: '/p.jpg', genres: [] });
}

function series() {
  return mapTmdbTv({ id: 42, name: 'Series 42', overview: 'Series', poster_path: '/s.jpg', first_air_date: '2020-01-01', genres: [], seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }] });
}

function episodeOf(parent: ReturnType<typeof series>) {
  return { provider: 'tmdb', mediaType: 'series', providerId: '420101', seriesId: parent.providerId, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' } as const;
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

function favoriteChange(overrides: Partial<PendingWatchStateChange> = {}): PendingWatchStateChange {
  const media = movie(9);
  return { id: 3, entityType: 'favorite', entityKey: media.id, provider: media.provider, mediaType: media.mediaType, providerId: media.providerId, deleted: false, updatedAt: '2026-10-06T10:00:00.000Z', watchedAt: '2026-10-06T10:00:00.000Z', media, retryCount: 0, ...overrides };
}

describe('favorites', () => {
  it('20. favorite and unfavorite persist locally with queue entries', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const title = movie(11);
    await repository.setFavorite(title, true);
    expect(await repository.isFavorite(title)).toBe(true);
    expect((await repository.getFavorites()).map(({ media }) => media.id)).toEqual([title.id]);
    const pending = await repository.getPendingChanges();
    expect(pending.filter((change) => change.entityType === 'favorite')).toHaveLength(1);
    const reloaded = new SqliteWatchStateRepository(async () => adapter.database);
    expect(await reloaded.isFavorite(title)).toBe(true);
    await reloaded.setFavorite(title, false);
    expect(await reloaded.isFavorite(title)).toBe(false);
    expect(await reloaded.getFavorites()).toHaveLength(0);
    adapter.close();
  });

  it('23/24. favorites sync for authenticated users and merge on sign-in', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const local: WatchStateSyncRepository = repository;
    const cloud: jest.Mocked<CloudWatchStateRepository> = {
      getAuthenticatedUserId: jest.fn().mockResolvedValue('account-1'),
      fetch: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
      getInterestedCounts: jest.fn().mockResolvedValue([]),
    };
    const title = movie(12);
    await repository.setFavorite(title, true);
    const service = new SyncService(local, cloud);
    await service.sync('account-1');
    expect(cloud.upsert).toHaveBeenCalledWith('account-1', expect.arrayContaining([expect.objectContaining({ entityType: 'favorite' })]));

    const remote = favoriteChange({ id: -1, entityKey: movie(13).id, providerId: '13', media: movie(13) });
    await repository.applyRemoteChanges([remote]);
    expect(await repository.isFavorite(movie(13))).toBe(true);
    adapter.close();
  });

  it('guest favorites stay local until account binding enqueues them', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    await repository.setFavorite(movie(14), true);
    expect(await repository.getBoundAccount()).toBeUndefined();
    await repository.bindAccount('account-9');
    const pending = await repository.getPendingChanges();
    expect(pending.some((change) => change.entityType === 'favorite' && change.providerId === '14')).toBe(true);
    adapter.close();
  });

  it('25. favorites stay independent from watchlist and watched state', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const title = movie(15);
    await repository.addToWatchlist(title);
    await repository.markMovieWatched(title, true);
    expect(await repository.isFavorite(title)).toBe(false);
    await repository.setFavorite(title, true);
    await repository.removeFromWatchlist(title);
    await repository.markMovieWatched(title, false);
    expect(await repository.isFavorite(title)).toBe(true);
    adapter.close();
  });
});

describe('lists', () => {
  it('30/31. creates and opens lists', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const list = await repository.createCustomList('Comfort rewatches');
    expect(list.name).toBe('Comfort rewatches');
    expect((await repository.getCustomLists()).map(({ id }) => id)).toEqual([list.id]);
    const detail = await repository.getCustomList(list.id);
    expect(detail?.items).toHaveLength(0);
    await expect(repository.createCustomList('   ')).rejects.toThrow('Give your list a name');
    adapter.close();
  });

  it('32/33. adds and removes media without touching sync state', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const list = await repository.createCustomList('Party picks');
    const title = movie(21);
    await repository.addToCustomList(list.id, title);
    await repository.addToCustomList(list.id, title);
    const detail = await repository.getCustomList(list.id);
    expect(detail?.items.map(({ media }) => media.id)).toEqual([title.id]);
    // Untouched catalog titles are materialized locally so lists reopen offline.
    expect(await repository.getTrackedMedia(title)).toBeDefined();
    await repository.removeFromCustomList(list.id, title);
    expect((await repository.getCustomList(list.id))?.items).toHaveLength(0);
    const pending = await repository.getPendingChanges();
    expect(pending).toHaveLength(0);
    adapter.close();
  });

  it('34/35. lists survive restart for guests without an account', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const list = await repository.createCustomList('Rainy days');
    await repository.addToCustomList(list.id, movie(22));
    const reloaded = new SqliteWatchStateRepository(async () => adapter.database);
    expect((await reloaded.getCustomLists())[0]).toMatchObject({ id: list.id, name: 'Rainy days', itemCount: 1 });
    expect(await reloaded.getBoundAccount()).toBeUndefined();
    adapter.close();
  });

  it('deleting a list removes its entries but keeps tracked media', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const list = await repository.createCustomList('Temp');
    const title = movie(23);
    await repository.addToCustomList(list.id, title);
    await repository.deleteCustomList(list.id);
    expect(await repository.getCustomLists()).toHaveLength(0);
    expect(await repository.getCustomList(list.id)).toBeUndefined();
    expect(await repository.getTrackedMedia(title)).toBeDefined();
    adapter.close();
  });
});

describe('history', () => {
  it('26/27/28. derives newest-first activity from real watches, never watchlist adds', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    const title = movie(31);
    await repository.addToWatchlist(title);
    expect(await repository.getViewingHistory()).toHaveLength(0);
    await repository.markMovieWatched(title, true);
    const parent = series();
    const season = { series: parent, seasonNumber: 1, name: 'Season 1', episodes: [{ ...episodeOf(parent) }] };
    await repository.setEpisodeWatched(parent, season, { ...episodeOf(parent) }, true);
    const history = await repository.getViewingHistory();
    expect(history).toHaveLength(2);
    expect(history[0].watchedAt >= history[1].watchedAt).toBe(true);
    expect(history.map((item) => item.kind).sort()).toEqual(['episode', 'movie']);
    adapter.close();
  });

  it('29. reports an empty history for fresh libraries', async () => {
    const { adapter, ready } = setupRepository();
    const repository = await ready;
    expect(await repository.getViewingHistory()).toEqual([]);
    adapter.close();
  });
});

describe('settings stores', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('37. appearance choice persists locally', async () => {
    useAppearanceStore.getState().setTheme('dark');
    const raw = await AsyncStorage.getItem('watch-later.appearance.v1');
    expect(raw).toContain('dark');
  });

  it('38. notification preferences persist locally', async () => {
    useNotificationStore.getState().setPreferences({ continueWatchingReminders: true });
    expect(useNotificationStore.getState().continueWatchingReminders).toBe(true);
    const raw = await AsyncStorage.getItem('watch-later.notifications.v1');
    expect(raw).toContain('continueWatchingReminders');
  });
});

describe('more menu and static screens', () => {
  it('11-17. every more row navigates to a real route', () => {
    const more = readFileSync('app/(tabs)/more.tsx', 'utf8');
    // Upcoming lives on its own tab, so the More menu must not repeat it.
    expect(more).not.toContain('/upcoming');
    for (const route of ['/settings/notifications', '/favorites', '/about']) {
      expect(more).toContain(route);
    }
    // Legal pages are hosted on the TeraPlayer website and open externally.
    expect(more).toContain('PRIVACY_POLICY_URL');
    expect(more).toContain('TERMS_URL');
    for (const removed of ['/settings/ratings', '/settings/appearance', '/collections', '/trash', '/history']) {
      expect(more).not.toContain(removed);
    }
    expect(more).not.toContain('onPress={() => undefined}');
  });

  it('37-40. settings and info screens render', async () => {
    for (const Screen of [NotificationsScreen, AboutScreen]) {
      let renderer!: ReturnType<typeof create>;
      await act(async () => { renderer = create(<Screen />); });
      expect(renderer.toJSON()).toBeTruthy();
      renderer.unmount();
    }
  });

  it('sync now only claims "up to date" when the sync actually completed', async () => {
    useSessionStore.setState({ session: { mode: 'authenticated', userId: 'user-123', email: 'viewer@example.test' } });
    useSyncStore.setState({ status: 'idle', message: undefined, lastSyncedAt: undefined });
    useDialogStore.setState({ toast: null });
    const sync = jest.spyOn(syncService, 'sync').mockResolvedValue({ uploaded: 0, downloaded: 0, status: 'pending' });

    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<MoreScreen />); });
    const press = (label: string) => renderer.root
      .findAll((node) => typeof node.props?.onPress === 'function' && node.props?.accessibilityLabel === label)[0]
      .props.onPress();

    // A pending result still owes work — it must not claim completion.
    await act(async () => { press('Sync now'); });
    expect(useDialogStore.getState().toast?.message).toMatch(/still waiting/);
    expect(useDialogStore.getState().toast?.message).not.toMatch(/up to date/);

    useDialogStore.setState({ toast: null });
    sync.mockResolvedValue({ uploaded: 0, downloaded: 0, status: 'synced' });
    await act(async () => { press('Sync now'); });
    expect(useDialogStore.getState().toast?.message).toBe('Your library is up to date');

    sync.mockRestore();
    useDialogStore.setState({ toast: null });
    await act(async () => { renderer.unmount(); });
  });
});
