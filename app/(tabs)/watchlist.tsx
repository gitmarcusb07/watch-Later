import { useEffect, useMemo, useState } from 'react';
import { FlatList, Animated, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { EmptyState, ErrorView, LibraryListSkeleton } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { LibrarySearchInput } from '@/components/library/controls';
import { PRIORITY_META, PRIORITY_ORDER } from '@/features/watchState/priority';
import type { SeriesProgress, WatchPriority, WatchlistEntry } from '@/domain/models/watchState';
import { useSeriesProgress, useWatchlist, useWatchlistMutation, watchKeys } from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { prefetchMedia } from '@/features/catalog/hooks';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { matchesLocalQuery } from '@/lib/localSearch';
import { sortLibraryEntries, type LibrarySortKey } from '@/lib/librarySort';
import { timeAgo } from '@/lib/relativeTime';
import { triggerLightHaptic } from '@/lib/haptics';
import { usePressMotion } from '@/lib/pressMotion';
import { actionPalette, type ActionTone } from '@/theme/actionPalette';
import { colors, radius, spacing } from '@/theme';

type PriorityFilter = 'all' | WatchPriority;

const SORT_OPTIONS: { key: LibrarySortKey; label: string }[] = [
  { key: 'recent', label: 'Recently saved' },
  { key: 'title', label: 'A–Z' },
  { key: 'year', label: 'Newest' },
  { key: 'runtime', label: 'Longest' },
];

function kindLabel(media: WatchlistEntry['media']): string {
  return media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'Show' : 'Anime';
}

function WatchlistRow({ entry, progress, onOpen }: { entry: WatchlistEntry; progress?: SeriesProgress; onOpen: () => void }) {
  const { media } = entry;
  const queryClient = useQueryClient();
  // Always remove: a stale/non-loaded status must never re-add the row on tap.
  const remove = useWatchlistMutation(media, true);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => { if (remove.error) void showDialog({ type: 'error', title: 'Couldn’t update your watchlist', message: friendlyErrorMessage(remove.error) }); }, [remove.error]);
  const undoRemove = () => {
    void watchStateRepository.saveToWatchlist(media, entry.priority).then(() => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      scheduleAutoSync('mutation');
    }).catch((undoError: unknown) => {
      void showDialog({ type: 'error', title: 'Couldn’t restore', message: friendlyErrorMessage(undoError) });
    });
  };
  const watching = Boolean(progress && !progress.isComplete && progress.watchedEpisodeCount > 0);
  const highlight = watching && progress
    ? {
        text: `Watching • ${progress.watchedEpisodeCount}${progress.totalEpisodeCount ? `/${progress.totalEpisodeCount}` : ''} episodes`,
        color: actionPalette('watching').color,
      }
    : entry.priority
      ? { text: `${PRIORITY_META[entry.priority].label} • ${timeAgo(entry.addedAt)}`, color: PRIORITY_META[entry.priority].color }
      : { text: `Saved • ${timeAgo(entry.addedAt)}`, color: colors.textMuted };
  // While actively watching, the row should read as Watching, not retain the
  // orange ASAP priority mark. The priority is still visible and editable in
  // the category tabs and the Watch Later sheet.
  const palette = actionPalette(watching ? 'watching' : entry.priority ?? 'watch-later');
  const removeMotion = usePressMotion('shake', 0.9);

  return <View style={styles.rowCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${media.title}`} accessibilityHint="Opens title details" onPress={() => { triggerLightHaptic(); onOpen(); }} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
      <View style={styles.posterWrap}>
        {media.posterUrl && !posterFailed
          ? <RemoteImage uri={media.posterUrl} style={styles.poster} onError={() => setPosterFailed(true)} />
          : <View style={[styles.poster, styles.posterFallback]}><Ionicons name="film-outline" size={23} color={colors.accent} /></View>}
        <LinearGradient colors={['rgba(5,6,10,0)', 'rgba(5,6,10,0.55)']} style={styles.posterScrim} />
      </View>
      <View style={styles.rowCopy}>
        <AppText variant="bodyMedium" numberOfLines={1} style={styles.rowTitle}>{media.title}</AppText>
        <AppText variant="caption" muted numberOfLines={1}>{[media.year, kindLabel(media)].filter(Boolean).join(' · ')}</AppText>
        {highlight ? <AppText variant="caption" numberOfLines={1} style={{ color: highlight.color }}>{highlight.text}</AppText> : null}
      </View>
    </Pressable>
    <View style={styles.rowActions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${media.title} from watchlist`} accessibilityState={{ disabled: remove.isPending }} disabled={remove.isPending} onPress={() => { removeMotion.play(); remove.mutate(undefined, { onSuccess: () => showToast('Removed from watchlist', 'info', { actionLabel: 'Undo', durationMs: 5000, onAction: undoRemove }) }); }} onPressIn={removeMotion.pressIn} onPressOut={removeMotion.pressOut} style={({ pressed }) => [styles.removeButton, { backgroundColor: palette.soft, borderColor: palette.border }, remove.isPending && styles.disabled, pressed && styles.pressed]}>
        <Animated.View style={removeMotion.pressMotionStyle}><Ionicons name="bookmark" size={17} color={palette.color} /></Animated.View>
      </Pressable>
    </View>
  </View>;
}

function PriorityTab({ count, label, selected, onPress, tone = 'neutral' }: { count: number; label: string; selected: boolean; onPress: () => void; tone?: ActionTone }) {
  const palette = actionPalette(tone);
  const motion = usePressMotion(tone === 'asap' ? 'launch' : tone === 'weekend' ? 'bounce' : tone === 'someday' ? 'float' : 'pop', 0.95);
  return <Pressable accessibilityRole="radio" accessibilityLabel={`Priority ${label}`} accessibilityState={{ selected }} onPress={() => { motion.play(); if (!selected) triggerLightHaptic(); onPress(); }} onPressIn={motion.pressIn} onPressOut={motion.pressOut} style={({ pressed }) => [styles.tab, selected && { backgroundColor: palette.soft, borderColor: palette.color }, pressed && styles.pressed]}>
    <Animated.View style={[styles.tabContent, motion.pressMotionStyle]}>
      <AppText variant="label" numberOfLines={1} style={[styles.tabLabel, selected && { color: palette.color }]}>{label}</AppText>
      <View style={[styles.tabCount, selected && { backgroundColor: palette.color }]}><AppText style={[styles.tabCountText, selected && { color: palette.onColor }]}>{count}</AppText></View>
    </Animated.View>
  </Pressable>;
}

export default function WatchlistScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySortKey>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const query = useWatchlist();
  const progressQuery = useSeriesProgress();
  const allEntries = useMemo(() => query.data ?? [], [query.data]);
  const progressByMediaId = useMemo(() => {
    const map = new Map<string, SeriesProgress>();
    for (const item of progressQuery.data ?? []) {
      if (!item.isComplete && item.watchedEpisodeCount > 0) map.set(item.media.id, item);
    }
    return map;
  }, [progressQuery.data]);
  const counts = useMemo<Record<PriorityFilter, number>>(() => {
    const next: Record<PriorityFilter, number> = { all: allEntries.length, asap: 0, weekend: 0, someday: 0 };
    for (const entry of allEntries) if (entry.priority) next[entry.priority] += 1;
    return next;
  }, [allEntries]);
  const entries = useMemo(() => {
    const filtered = allEntries.filter(({ media, priority }) =>
      (filter === 'all' || priority === filter) && matchesLocalQuery(media.title, search),
    );
    return sortLibraryEntries(filtered.map((entry) => ({
      entry,
      title: entry.media.title,
      year: entry.media.year,
      runtimeMinutes: entry.media.runtimeMinutes,
      addedAt: entry.addedAt,
    })), sort).map((item) => item.entry);
  }, [allEntries, filter, search, sort]);
  const empty = filter === 'all'
    ? <EmptyState icon="bookmark-outline" title="Your watchlist is empty" message="You haven't saved anything yet. Search the catalog and save movies, shows, or anime to find them here." actionLabel="Find something to watch" onAction={() => router.push('/search')} />
    : <EmptyState icon="bookmark-outline" title={`No ${PRIORITY_META[filter].label} titles`} message="Tap Watch Later on any title and pick a priority to file it here." actionLabel="Browse titles" onAction={() => router.push('/search')} />;
  const header = <View style={styles.header}>
    <View style={styles.titleRow}>
      <View style={styles.titleCopy}>
        <AppText variant="caption" style={styles.eyebrow}>SAVED FOR LATER</AppText>
        <AppText variant="heading1" style={styles.title}>Watchlist</AppText>
        <AppText variant="bodySmall" muted>Everything you kept, sorted by what you’re in the mood for.</AppText>
      </View>
      <View style={styles.countBadge}><Ionicons name="bookmark" size={13} color={colors.accent} /><AppText variant="label" style={styles.countText}>{entries.length}</AppText></View>
    </View>
    <View style={styles.searchRow}>
      <View style={styles.searchGrow}><LibrarySearchInput value={search} onChange={setSearch} label="Search your watchlist" placeholder="Search your watchlist" /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Show watchlist sorting" accessibilityState={{ expanded: sortOpen }} onPress={() => { triggerLightHaptic(); setSortOpen((open) => !open); }} style={[styles.sortButton, sortOpen && styles.sortButtonActive]}>
        <Ionicons name="options-outline" size={19} color={sortOpen ? colors.accent : colors.textSecondary} />
      </Pressable>
    </View>
    {sortOpen ? <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort watchlist">
      {SORT_OPTIONS.map((option) => {
        const selected = sort === option.key;
        return <Pressable key={option.key} accessibilityRole="radio" accessibilityLabel={`Sort watchlist by ${option.label}`} accessibilityState={{ selected }} onPress={() => { triggerLightHaptic(); setSort(option.key); }} style={[styles.sortChip, selected && styles.sortChipActive]}><AppText variant="caption" style={[styles.sortChipText, selected && styles.sortChipTextActive]}>{option.label}</AppText></Pressable>;
      })}
    </View> : null}
    <View style={styles.tabs} accessibilityRole="tablist">
      <PriorityTab label="All" count={counts.all} selected={filter === 'all'} onPress={() => setFilter('all')} tone="neutral" />
      {PRIORITY_ORDER.map((priority) => (
        <PriorityTab key={priority} label={PRIORITY_META[priority].label} count={counts[priority]} selected={filter === priority} onPress={() => setFilter(priority)} tone={priority} />
      ))}
    </View>
  </View>;
  return <Screen><FlatList
    data={entries}
    keyExtractor={(item) => item.media.id}
    renderItem={({ item }) => <WatchlistRow entry={item} progress={progressByMediaId.get(item.media.id)} onOpen={() => { const id = mediaRouteId(item.media); prefetchMedia(id); router.push({ pathname: '/media/[id]', params: { id } }); }} />}
    ListHeaderComponent={<FadeInView><View>{header}</View></FadeInView>}
    ListEmptyComponent={query.isLoading ? <LibraryListSkeleton /> : query.isError ? <ErrorView message="Couldn't load your watchlist. Your data is safe." onRetry={() => void query.refetch()} /> : empty}
    contentContainerStyle={styles.list}
    style={styles.flat}
    showsVerticalScrollIndicator={false}
    initialNumToRender={12}
    windowSize={9}
    removeClippedSubviews={false}
    refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
  /></Screen>;
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  titleCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.accent, letterSpacing: 2, fontWeight: '700' },
  title: { color: colors.white },
  countBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: 2 },
  countText: { color: colors.textPrimary },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  searchGrow: { flex: 1 },
  sortButton: { width: 48, height: 48, marginTop: spacing.md, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sortButtonActive: { borderColor: colors.accent, backgroundColor: 'rgba(168,85,247,0.10)' },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  sortChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  sortChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(168,85,247,0.12)' },
  sortChipText: { color: colors.textSecondary },
  sortChipTextActive: { color: colors.accent, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 4, marginTop: spacing.lg, padding: 4, borderRadius: 18, backgroundColor: 'rgba(8,6,14,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, paddingHorizontal: 2, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  tabContent: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabLabel: { color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  tabCount: { minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.pill, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  tabCountText: { color: colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: '700' },
  flat: { flex: 1 },
  list: { flexGrow: 1, paddingBottom: spacing['2xl'] },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.md, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  posterWrap: { width: 78, height: 112, borderRadius: radius.medium, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  poster: { width: '100%', height: '100%' },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  posterScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
  rowCopy: { flex: 1, gap: 3, paddingVertical: 2 },
  rowTitle: { color: colors.white, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  rowActions: { alignItems: 'center', gap: spacing.sm },
  removeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
