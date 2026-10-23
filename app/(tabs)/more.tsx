import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useClerk } from '@clerk/expo';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useMemo, useState } from 'react';
import { AppText } from '@/components/common/AppText';
import { FadeInView } from '@/components/common/FadeInView';
import { Screen } from '@/components/common/Screen';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { showFriendlyError } from '@/lib/friendlyError';
import { DeleteAccountDialog } from '@/components/auth/DeleteAccountDialog';
import { deleteAccount } from '@/features/auth/deleteAccount';
import { exportLibraryBackup, pickBackupFile, restoreLibraryBackup } from '@/features/backup/libraryBackup';
import { colors, radius, spacing } from '@/theme';
import { useSessionStore } from '@/store/app/sessionStore';
import { useSyncStore } from '@/store/app/syncStore';
import { SupabaseAuthService } from '@/features/auth/SupabaseAuthService';
import { isLocalLibraryPrepFailure, LOCAL_LIBRARY_PREP_NOTICE, LOCAL_LIBRARY_PREP_TITLE } from '@/lib/localLibraryNotice';
import { syncService } from '@/features/sync/SyncService';
import { persistSession } from '@/store/app/sessionPersistence';
import { AppButton } from '@/components/buttons/AppButton';
import { triggerLightHaptic } from '@/lib/haptics';
import { usePressScale } from '@/lib/pressScale';
import type { SyncStatus } from '@/domain/models/sync';

/** Rows hidden while accounts/notifications are off. Screens and logic stay. */
const HIDDEN_MORE_ROWS = new Set(['Notifications', 'Global Hits', 'Upcoming on OTT']);

const groups: { title: string; rows: { label: string; detail: string; icon: keyof typeof Ionicons.glyphMap; route: string; hint: string; beta?: boolean }[] }[] = [  { title: 'PREFERENCES', rows: [{ label: 'Notifications', detail: 'Reminders', icon: 'notifications-outline', route: '/settings/notifications', hint: 'Open Notification settings' }] },
  { title: 'LIBRARY', rows: [{ label: 'Favorites', detail: 'Your favorite titles', icon: 'heart-outline', route: '/favorites', hint: 'Open Favorites' }] },
  { title: 'CREATE', rows: [{ label: 'Creator Studio', detail: 'Instagram-ready posts from your library', icon: 'color-wand-outline', route: '/creator', hint: 'Open Creator Studio (beta)', beta: true }] },
  { title: 'DISCOVER', rows: [{ label: 'Franchise Collections', detail: 'Movies & shows in order', icon: 'albums-outline', route: '/franchises', hint: 'Open franchise collections' }, { label: 'Global Hits', detail: 'Coming soon', icon: 'globe-outline', route: '/global-hits', hint: 'Open Global Hits rankings' }, { label: 'Top 250', detail: 'Top-rated movies & series', icon: 'star-outline', route: '/imdb-top', hint: 'Open Top 250' }, { label: 'Upcoming on OTT', detail: 'Coming soon', icon: 'cloud-outline', route: '/ott-upcoming', hint: 'Open Upcoming on OTT' }, { label: 'New Releases', detail: 'Fresh movies and shows', icon: 'sparkles-outline', route: '/new-releases', hint: 'Open New Releases' }, { label: 'Top 100', detail: 'The highest-rated titles', icon: 'trophy-outline', route: '/top-100', hint: 'Open Top 100' }] },
  { title: 'ABOUT', rows: [{ label: 'About Watch Later', detail: 'A little about this app', icon: 'information-circle-outline', route: '/about', hint: 'Open About Watch Later' }, { label: 'Privacy & terms', detail: 'Your data, your choice', icon: 'shield-checkmark-outline', route: '/privacy', hint: 'Open Privacy and Terms' }] },
];

/** Human "12 min ago" style label for the last successful sync. */
function formatRelative(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString();
}

interface StatusMeta { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; detail: string }

function statusMetaFor(status: SyncStatus, message?: string, lastSyncedAt?: string): StatusMeta {
  const lastSynced = formatRelative(lastSyncedAt);
  switch (status) {
    case 'synced':
      return { label: 'Synced', icon: 'cloud-done-outline', color: colors.success, detail: lastSynced ? `Last synced ${lastSynced}` : 'Your library is up to date' };
    case 'syncing':
      return { label: 'Syncing…', icon: 'sync-outline', color: colors.accent, detail: 'Sending your latest changes' };
    case 'pending':
      return { label: 'Changes pending', icon: 'time-outline', color: colors.warning, detail: message ?? 'We’ll retry automatically' };
    case 'offline':
      return { label: 'Waiting to sync', icon: 'cloud-offline-outline', color: colors.textMuted, detail: message ?? (lastSynced ? `Last synced ${lastSynced} — we’ll sync when you’re back online` : 'We’ll sync as soon as you’re back online') };
    case 'error':
      return { label: 'Sync needs attention', icon: 'alert-circle-outline', color: colors.error, detail: message ?? 'Try again, or sign out and back in' };
    default:
      return { label: 'Ready to sync', icon: 'cloud-outline', color: colors.textMuted, detail: 'Your library syncs automatically' };
  }
}

function initialsFor(email: string): string {
  const letters = email.replace(/[^a-zA-Z]/g, '');
  return (letters.slice(0, 2) || 'U').toUpperCase();
}

type RowTone = 'default' | 'accent' | 'danger';

/**
 * One tappable settings row: haptic tap, spring press animation and a
 * pressed-state highlight — the same feel the other tabs get from their
 * buttons, so More no longer reads as a static list.
 */
function MoreRow({ label, detail, icon, hint, tone = 'default', hideChevron = false, disabled = false, beta = false, onPress }: {
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  tone?: RowTone;
  hideChevron?: boolean;
  disabled?: boolean;
  beta?: boolean;
  onPress: () => void;
}) {
  const { pressScaleStyle, pressIn, pressOut } = usePressScale(0.985);
  const iconColor = tone === 'accent' ? colors.accent : tone === 'danger' ? colors.error : colors.textSecondary;
  const titleColor = tone === 'danger' ? styles.dangerText : undefined;
  return (
    <Animated.View style={[pressScaleStyle, disabled && styles.rowDisabled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${detail}`}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => { if (!disabled) triggerLightHaptic(); onPress(); }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={20} color={iconColor} />
        <View style={styles.rowCopy}>
          <View style={styles.rowTitle}>
            <AppText variant="bodyMedium" style={titleColor}>{label}</AppText>
            {beta ? <View style={styles.betaTag}><AppText style={styles.betaTagText}>BETA</AppText></View> : null}
          </View>
          <AppText variant="caption" muted>{detail}</AppText>
        </View>
        {hideChevron ? null : <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />}
      </Pressable>
    </Animated.View>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const onboardingComplete = useSessionStore((state) => state.onboardingComplete);
  const sync = useSyncStore();
  const { signOut: clerkSignOut } = useClerk();
  // Auth is hidden for now (code stays dormant): no sign-in rows, no
  // notification settings, no coming-soon discovery entries.
  const visibleGroups = useMemo(() => groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => !HIDDEN_MORE_ROWS.has(row.label)) }))
    .filter((group) => group.rows.length > 0), []);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const account = new SupabaseAuthService();
  const status = statusMetaFor(sync.status, sync.message, sync.lastSyncedAt);
  const retryLabel = sync.status === 'offline' || sync.status === 'error';

  async function syncNow() {
    if (session.mode !== 'authenticated' || busy) return;
    setBusy(true);
    try {
      const result = await syncService.sync(session.userId);
      // A 'pending' result means a provider failed or a queue is still full —
      // claiming "up to date" over it would hide work the sync still owes.
      if (result.status === 'synced') showToast('Your library is up to date', 'success');
      else showToast('Synced what we could — some changes are still waiting', 'info');
    } catch (cause) {
      // The sync store already shows a safe status line, but a failed manual
      // sync must also prompt: silently "retrying later" reads as success.
      if (isLocalLibraryPrepFailure(cause)) {
        // Same title + copy as the auth/notice dialogs, so showFriendlyError
        // collapses any overlap into ONE prompt.
        await showFriendlyError(cause, LOCAL_LIBRARY_PREP_TITLE, { message: LOCAL_LIBRARY_PREP_NOTICE });
      } else {
        await showFriendlyError(cause, 'Couldn’t sync your library');
      }
    } finally { setBusy(false); }
  }

  /** Pull-to-refresh: same job as "Sync now" — guests simply resolve. */
  async function refresh() {
    if (busy || refreshing) return;
    if (session.mode !== 'authenticated') return;
    setRefreshing(true);
    try { await syncNow(); } finally { setRefreshing(false); }
  }

  async function signOut() {
    if (busy) return;
    const confirmed = await showDialog({
      type: 'info',
      title: 'Sign out?',
      message: 'You can sign back in anytime — your library stays safe in your account.',
      primaryAction: { label: 'Sign out' },
      secondaryAction: { label: 'Cancel' },
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await account.signOut();
      // App sign-out ends BOTH sessions: a lingering Clerk session breaks
      // the next Google sign-in (Clerk rejects a new SSO flow while signed
      // in) and would sync under the wrong identity.
      await clerkSignOut().catch(() => undefined);
      const guest = { mode: 'guest' as const, userId: `guest-${Date.now()}` };
      setSession(guest);
      await persistSession(guest, onboardingComplete);
      useSyncStore.getState().reset();
    } catch { void showDialog({ type: 'error', title: 'Couldn’t sign out', message: 'Your local library is unchanged. Please try again.' }); }
    finally { setBusy(false); }
  }

  async function confirmDeleteAccount() {
    if (session.mode !== 'authenticated' || busy) return;
    setDeleteOpen(false);
    setBusy(true);
    try {
      await deleteAccount(session.userId);
      await clerkSignOut().catch(() => undefined);
      const guest = { mode: 'guest' as const, userId: `guest-${Date.now()}` };
      setSession(guest);
      await persistSession(guest, onboardingComplete);
      useSyncStore.getState().reset();
      showToast('Your account and all its data were deleted', 'success');
    } catch (cause) {
      // Same rule as every other account error: a modal prompt, never a raw
      // diagnostic (deletion failures are AppErrors with safe copy; anything
      // else is sanitised by the helper).
      await showFriendlyError(cause, 'Couldn’t delete your account');
    } finally { setBusy(false); }
  }
  async function exportBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const confirmed = await showDialog({
        type: 'info',
        title: 'Export your library?',
        message: 'Saves every saved title, watch state, list and rating into one file. Keep it somewhere safe — anyone with the file can read your library. After reinstalling, Import it back here.',
        primaryAction: { label: 'Export' },
        secondaryAction: { label: 'Cancel' },
      });
      if (!confirmed) return;
      const name = await exportLibraryBackup();
      showToast(`Backup saved — share it somewhere safe (${name})`, 'success');
    } catch (cause) {
      await showFriendlyError(cause, 'Couldn’t export your backup');
    } finally { setBusy(false); }
  }

  async function importBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickBackupFile();
      if (!picked) return;
      const confirmed = await showDialog({
        type: 'warning',
        title: 'Replace everything?',
        message: `Importing replaces every title on this device with the backup’s library (${picked.titles} titles). This cannot be undone.`,
        primaryAction: { label: 'Import', destructive: true },
        secondaryAction: { label: 'Cancel' },
      });
      if (!confirmed) return;
      const { titles } = await restoreLibraryBackup(picked.uri);
      showToast(`Restored ${titles} titles from backup`, 'success');
    } catch (cause) {
      await showFriendlyError(cause, 'Couldn’t import your backup');
    } finally { setBusy(false); }
  }
  const stagger = 120 + visibleGroups.length * 55;
  return <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} colors={[colors.accent]} />}>
    <FadeInView><View style={styles.top}><AppText variant="heading1">More</AppText><AppText variant="bodySmall" muted>Your Watch Later space</AppText></View></FadeInView>
    {session.mode === 'authenticated' ? (<FadeInView delay={60}><View style={styles.profile}>
      <View style={styles.avatar}><AppText variant="heading3" style={styles.avatarText}>{session.mode === 'authenticated' ? initialsFor(session.email) : 'G'}</AppText></View>
      <View style={styles.profileCopy}>
        <AppText variant="heading3">{session.mode === 'authenticated' ? session.email || 'Your account' : 'Guest profile'}</AppText>
        {session.mode === 'authenticated'
          ? <View style={styles.statusLine}><View style={[styles.statusDot, { backgroundColor: status.color }]} /><AppText variant="caption" muted>{status.label}</AppText></View>
          : <AppText variant="caption" muted>Your collection stays on this device</AppText>}
      </View>
      <Ionicons name={session.mode === 'authenticated' ? status.icon : 'phone-portrait-outline'} size={20} color={session.mode === 'authenticated' ? status.color : colors.textMuted} />
    </View></FadeInView>) : null}
    {visibleGroups.map((group, index) => (
      <FadeInView key={group.title} delay={120 + index * 55}>
        <View style={styles.group}>
          <AppText variant="caption" style={styles.groupTitle}>{group.title}</AppText>
          <View style={styles.groupCard}>
            {group.rows.map((row) => <MoreRow key={row.label} label={row.label} detail={row.detail} icon={row.icon} hint={row.hint} beta={row.beta} onPress={() => router.push(row.route as never)} />)}
          </View>
        </View>
      </FadeInView>
    ))}
    <FadeInView delay={stagger}>
      <View style={styles.group}><AppText variant="caption" style={styles.groupTitle}>BACKUP</AppText><View style={styles.groupCard}>
        <MoreRow label="Export backup" detail="Save a file to restore after reinstall" icon="download-outline" tone="accent" hint="Saves your library to a file you can keep" disabled={busy} onPress={() => void exportBackup()} />
        <MoreRow label="Import backup" detail="Restore from a saved file" icon="document-text-outline" tone="accent" hint="Restores your library from a file" disabled={busy} onPress={() => void importBackup()} />
      </View></View>
    </FadeInView>
    {session.mode === 'authenticated' ? <FadeInView delay={stagger + 55}><View style={styles.group}><AppText variant="caption" style={styles.groupTitle}>ACCOUNT</AppText><View style={styles.groupCard}><View style={styles.row}><Ionicons name={status.icon} size={20} color={status.color} /><View style={styles.rowCopy}><AppText variant="bodyMedium">{status.label}</AppText><AppText variant="caption" muted>{status.detail}</AppText></View></View><View style={styles.actions}><AppButton label={retryLabel ? 'Try again' : 'Sync now'} onPress={() => void syncNow()} loading={busy || sync.status === 'syncing'} variant="secondary" icon={<Ionicons name="sync-outline" size={17} color={colors.textPrimary} />} /><AppButton label="Sign out" onPress={() => void signOut()} disabled={busy} variant="ghost" icon={<Ionicons name="log-out-outline" size={17} color={colors.textSecondary} />} /><MoreRow label="Delete account" detail="Removes your data everywhere" icon="trash-outline" tone="danger" hideChevron disabled={busy} hint="Requires typing your email to confirm" onPress={() => setDeleteOpen(true)} /></View><DeleteAccountDialog visible={deleteOpen} email={session.mode === 'authenticated' ? session.email : ''} busy={busy} onClose={() => setDeleteOpen(false)} onConfirm={() => void confirmDeleteAccount()} /></View></View></FadeInView> : null}
    <FadeInView delay={stagger + 110}><AppText variant="caption" muted style={styles.version}>WATCH LATER · VERSION {Constants.expoConfig?.version ?? '1.0.0'}</AppText></FadeInView>
  </Screen>;
}
const styles = StyleSheet.create({ top: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs }, profile: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl }, avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }, avatarText: { color: colors.accent, letterSpacing: 0.5 }, profileCopy: { flex: 1, gap: 4 }, statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, statusDot: { width: 7, height: 7, borderRadius: 4 }, group: { marginBottom: spacing.xl }, groupTitle: { color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm, marginLeft: spacing.xs }, groupCard: { backgroundColor: colors.surface, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowCopy: { flex: 1, gap: 2 }, rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, betaTag: { borderRadius: radius.pill, backgroundColor: colors.warning, paddingHorizontal: 6, paddingVertical: 1 }, betaTagText: { color: '#1A1206', fontSize: 8.5, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 }, actions: { gap: spacing.xs, padding: spacing.md }, rowDisabled: { opacity: 0.45 }, dangerText: { color: colors.error }, pressed: { backgroundColor: colors.surfaceElevated }, version: { textAlign: 'center', paddingBottom: spacing.xl, letterSpacing: 0.8 } });
