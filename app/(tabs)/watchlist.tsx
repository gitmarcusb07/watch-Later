import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { EmptyState, ErrorView, LibraryListSkeleton } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { LibrarySearchInput } from '@/components/library/controls';
import { PRIORITY_META, PRIORITY_ORDER } from '@/features/watchState/priority';
import type { SeriesProgress, WatchPriority, WatchlistEntry } from '@/domain/models/watchState';
import { useAdvanceEpisode, useSeriesProgress, useToggleWatchlist, useWatchlist, watchKeys } from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { matchesLocalQuery } from '@/lib/localSearch';
import { sortLibraryEntries, type LibrarySortKey } from '@/lib/librarySort';
import { timeAgo } from '@/lib/relativeTime';
import { triggerLightHaptic } from '@/lib/haptics';
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
  const remove = useToggleWatchlist(media);
  const advance = useAdvanceEpisode();
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
  const highlight = entry.priority
    ? { text: `${PRIORITY_META[entry.priority].label} • ${timeAgo(entry.addedAt)}`, color: PRIORITY_META[entry.priority].color }
    : { text: `Saved • ${timeAgo(entry.addedAt)}`, color: colors.textMuted };
  const episodic = media.mediaType !== 'movie';
  const canAdvance = Boolean(progress && !progress.isComplete && (progress.nextEpisode || media.mediaType === 'anime'));
  const nextEpisode = progress?.nextEpisode;
  const nextEpisodeLabel = nextEpisode
    ? `S${nextEpisode.seasonNumber} E${nextEpisode.episodeNumber}${nextEpisode.title ? ` · ${nextEpisode.title}` : ''}`
    : undefined;
  const episodeCount = progress
    ? `${progress.watchedEpisodeCount}${progress.totalEpisodeCount ? ` / ${progress.totalEpisodeCount}` : ''} episodes`
    : undefined;
  const ratio = progress ? Math.max(0, Math.min(1, progress.progress)) : 0;

  function handleAdvance() {
    if (!progress || advance.isPending) return;
    triggerLightHaptic();
    advance.mutate(progress, {
      onSuccess: () => showToast('Episode marked watched', 'success'),
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t update progress', message: friendlyErrorMessage(error) }),
    });
  }

  return <View style={styles.rowCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${media.title}`} accessibilityHint="Opens title details" onPress={() => { triggerLightHaptic(); onOpen(); }} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
      <View style={styles.posterWrap}>
        {media.posterUrl && !posterFailed
          ? <Image source={{ uri: media.posterUrl }} style={styles.poster} resizeMode="cover" onError={() => setPosterFailed(true)} />
          : <View style={[styles.poster, styles.posterFallback]}><Ionicons name="film-outline" size={23} color={colors.accent} /></View>}
        <LinearGradient colors={['rgba(5,6,10,0)', 'rgba(5,6,10,0.55)']} style={styles.posterScrim} />
      </View>
      <View style={styles.rowCopy}>
        <AppText variant="bodyMedium" numberOfLines={1} style={styles.rowTitle}>{media.title}</AppText>
        <AppText variant="caption" muted numberOfLines={1}>{[media.year, kindLabel(media)].filter(Boolean).join(' · ')}</AppText>
        {highlight ? <AppText variant="caption" numberOfLines={1} style={{ color: highlight.color }}>{highlight.text}</AppText> : null}
        {nextEpisodeLabel ? <AppText variant="caption" numberOfLines={1} style={styles.nextEpisode}>Next · {nextEpisodeLabel}</AppText> : null}
        {progress ? <View style={styles.progressBlock}>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} /></View>
          <AppText variant="caption" muted style={styles.progressLabel}>{episodeCount}</AppText>
        </View> : null}
      </View>
    </Pressable>
    <View style={styles.rowActions}>
      {episodic && canAdvance ? <Pressable accessibilityRole="button" accessibilityLabel={`Mark next episode of ${media.title} watched`} accessibilityState={{ disabled: advance.isPending }} disabled={advance.isPending} onPress={handleAdvance} style={({ pressed }) => [styles.epButton, advance.isPending && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="add" size={15} color={colors.white} />
        <AppText style={styles.epButtonText}>EP</AppText>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${media.title} from watchlist`} accessibilityState={{ disabled: remove.isMutating }} disabled={remove.isMutating} onPress={() => remove.toggle(undefined, { onSuccess: () => showToast('Removed from watchlist', 'info', { actionLabel: 'Undo', durationMs: 10000, onAction: undoRemove }) })} style={({ pressed }) => [styles.removeButton, remove.isMutating && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="bookmark" size={17} color={colors.accent} />
      </Pressable>
    </View>
  </View>;
}

function PriorityTab({ count, label, selected, onPress }: { count: number; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={`Priority ${label}`} accessibilityState={{ selected }} onPress={() => { if (!selected) triggerLightHaptic(); onPress(); }} style={[styles.tab, selected && styles.tabActive]}>
    <AppText variant="label" numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelActive]}>{label}</AppText>
    <View style={[styles.tabCount, selected && styles.tabCountActive]}><AppText style={[styles.tabCountText, selected && styles.tabCountTextActive]}>{count}</AppText></View>
  </Pressable>;
}

export default function WatchlistScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySortKey>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const query = useWatchlist();
  const progress = useSeriesProgress();
  const progressById = useMemo(() => new Map((progress.data ?? []).map((item) => [item.media.id, item])), [progress.data]);
  const allEntries = useMemo(() => query.data ?? [], [query.data]);
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
  const header = <LinearGradient colors={['#25163A', '#160F24', colors.background]} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerBand}>
    <View style={styles.titleRow}>
      <View style={styles.titleCopy}>
        <AppText variant="caption" style={styles.eyebrow}>YOUR LIBRARY</AppText>
        <AppText style={styles.title}>Watchlist</AppText>
        <AppText variant="bodySmall" muted>Saved for later, sorted by what you’re in the mood for.</AppText>
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
      <PriorityTab label="All" count={counts.all} selected={filter === 'all'} onPress={() => setFilter('all')} />
      {PRIORITY_ORDER.map((priority) => (
        <PriorityTab key={priority} label={PRIORITY_META[priority].label} count={counts[priority]} selected={filter === priority} onPress={() => setFilter(priority)} />
      ))}
    </View>
  </LinearGradient>;
  return <Screen><FlatList
    data={entries}
    keyExtractor={(item) => item.media.id}
    renderItem={({ item }) => <WatchlistRow entry={item} progress={progressById.get(item.media.id)} onOpen={() => router.push({ pathname: '/media/[id]', params: { id: mediaRouteId(item.media) } })} />}
    ListHeaderComponent={<FadeInView><View>{header}</View></FadeInView>}
    ListEmptyComponent={query.isLoading ? <LibraryListSkeleton /> : query.isError ? <ErrorView message="Couldn't load your watchlist. Your data is safe." onRetry={() => void query.refetch()} /> : empty}
    contentContainerStyle={styles.list}
    style={styles.flat}
    showsVerticalScrollIndicator={false}
    initialNumToRender={12}
    windowSize={7}
    removeClippedSubviews
    refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
  /></Screen>;
}

const styles = StyleSheet.create({
  headerBand: { marginHorizontal: -spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg, marginBottom: spacing.lg, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  titleCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.accent, letterSpacing: 2.2, fontWeight: '700' },
  title: { color: colors.white, fontSize: 37, lineHeight: 41, fontWeight: '800', letterSpacing: -1.1 },
  countBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
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
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: spacing.sm, paddingHorizontal: 2, borderRadius: 14 },
  tabActive: { backgroundColor: colors.accent },
  tabLabel: { color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  tabLabelActive: { color: colors.white },
  tabCount: { minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.pill, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  tabCountText: { color: colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: '700' },
  tabCountTextActive: { color: colors.white },
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
  nextEpisode: { color: colors.accent, marginTop: 2 },
  progressBlock: { gap: 4, marginTop: spacing.xs },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  progressLabel: { fontSize: 10, lineHeight: 13 },
  rowActions: { alignItems: 'center', gap: spacing.sm },
  epButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 48, height: 34, borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: spacing.sm },
  epButtonText: { color: colors.white, fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.4 },
  removeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
