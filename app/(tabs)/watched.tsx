import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { EmptyState, ErrorView, LibraryListSkeleton } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { TrackedMediaRow } from '@/components/media/TrackedMediaRow';
import { LibrarySearchInput } from '@/components/library/controls';
import {
  resetEpisodeScheduleBackfill,
  useAdvanceEpisode,
  useMovieWatchedMutation,
  useSeriesProgress,
  useWatchedLibrary,
  watchKeys,
} from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { prefetchMedia } from '@/features/catalog/hooks';
import { formatReleaseDate, hasAired } from '@/features/catalog/upcoming';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { matchesLocalQuery } from '@/lib/localSearch';
import { groupByMonth, timeAgo } from '@/lib/relativeTime';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import type { CatalogMedia } from '@/domain/models/media';
import type { SeriesProgress, WatchedLibraryItem } from '@/domain/models/watchState';

type Segment = 'watching' | 'completed';

function kindLabel(media: CatalogMedia): string {
  return media.mediaType === 'anime' ? 'Anime' : media.mediaType === 'series' ? 'Show' : 'Movie';
}

function watchedDateOf(item: WatchedLibraryItem): string | undefined {
  return item.kind === 'movie' ? item.watchedAt : item.progress.lastWatchedAt;
}

function MovieRow({ media, watchedAt, onOpen }: { media: CatalogMedia; watchedAt: string; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMovieWatchedMutation(media, true);
  useEffect(() => { if (mutation.error) void showDialog({ type: 'error', title: 'Couldn’t update watched status', message: friendlyErrorMessage(mutation.error) }); }, [mutation.error]);
  const undo = () => {
    void watchStateRepository.markMovieWatched(media, true).then(() => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      scheduleAutoSync('mutation');
    }).catch((undoError: unknown) => {
      void showDialog({ type: 'error', title: 'Couldn’t restore', message: friendlyErrorMessage(undoError) });
    });
  };
  const ago = timeAgo(watchedAt);
  return <TrackedMediaRow media={media} hideOverview subtitle={[media.year, 'Movie', ago].filter(Boolean).join(' • ')} onPress={onOpen} actionLabel={`Mark ${media.title} unwatched`} actionIcon="checkmark-circle" actionTone="watched" actionMotion="bounce" actionDisabled={mutation.isPending} onAction={() => mutation.mutate(undefined, { onSuccess: () => showToast('Marked unwatched', 'info', { actionLabel: 'Undo', durationMs: 5000, onAction: undo }) })} />;
}

function SeriesRow({ item, onOpen }: { item: Extract<WatchedLibraryItem, { kind: 'series' }>; onOpen: () => void }) {
  const { progress } = item;
  const episodeTotal = progress.totalEpisodeCount;
  const ago = timeAgo(progress.lastWatchedAt);
  return <TrackedMediaRow media={progress.media} hideOverview subtitle={[progress.media.year, kindLabel(progress.media), ago].filter(Boolean).join(' • ')} badge={episodeTotal ? `Complete · ${episodeTotal} episodes` : 'Complete'} badgeTone="success" progress={undefined} onPress={onOpen} />;
}

/**
 * One in-progress show, styled like a streaming queue: poster, progress bar,
 * EP x / y, a one-tap + EP button, and the next release date. The schedule
 * expands to every future episode the cached season knows about, so episode 3
 * keeps its date even when only episodes 1–2 have dropped.
 */
function WatchingRow({ item, onOpen }: { item: SeriesProgress; onOpen: () => void }) {
  const advance = useAdvanceEpisode();
  const advanceLock = useRef(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const next = item.nextEpisode;
  const nextAired = next ? hasAired(next.airDate) : false;
  const future = useMemo(() => (item.nextEpisodes ?? []).filter((episode) => !hasAired(episode.airDate)), [item.nextEpisodes]);
  const airingNext = next && !nextAired ? next : undefined;
  const upcoming = airingNext ?? future[0];
  const upcomingDate = formatReleaseDate(upcoming?.airDate);
  const total = item.totalEpisodeCount;
  const episodeLabel = total ? `EP ${item.watchedEpisodeCount} / ${total}` : `EP ${item.watchedEpisodeCount}`;
  const percent = Math.round(Math.max(0, Math.min(1, item.progress)) * 100);
  const canAdvance = Boolean((next && nextAired) || (!next && (item.nextSeasonNumber !== undefined || item.media.mediaType === 'anime')));
  const headline = next && nextAired
    ? `Next · EP ${next.episodeNumber}${next.title ? ` · ${next.title}` : ''}`
    : upcoming
      ? `EP ${upcoming.episodeNumber} airs ${upcomingDate ?? 'soon'}`
      : item.nextSeasonNumber !== undefined
        ? `Season ${item.nextSeasonNumber} · schedule loading`
        : 'No episode schedule yet';
  const meta = [item.media.year, kindLabel(item.media), timeAgo(item.lastWatchedAt)].filter(Boolean).join(' • ');

  function handleAdvance() {
    if (!canAdvance || advance.isPending || advanceLock.current) return;
    advanceLock.current = true;
    triggerLightHaptic();
    advance.mutate(item, {
      onSuccess: () => showToast('Episode marked watched', 'success'),
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t update progress', message: friendlyErrorMessage(error) }),
      onSettled: () => { advanceLock.current = false; },
    });
  }

  return <View style={styles.watchCard}>
    <View style={styles.watchMain}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.media.title}`} accessibilityHint="Opens title details" onPress={() => { triggerLightHaptic(); onOpen(); }} style={({ pressed }) => [styles.watchOpen, pressed && styles.pressed]}>
        <View style={styles.posterWrap}>
          {item.media.posterUrl && !posterFailed
            ? <RemoteImage uri={item.media.posterUrl} style={styles.poster} onError={() => setPosterFailed(true)} />
            : <View style={[styles.poster, styles.posterFallback]}><Ionicons name="film-outline" size={23} color={colors.accent} /></View>}
        </View>
        <View style={styles.watchCopy}>
          <AppText variant="bodyMedium" numberOfLines={1} style={styles.watchTitle}>{item.media.title}</AppText>
          <AppText variant="caption" muted numberOfLines={1}>{meta}</AppText>
          <View style={styles.progressMeta}>
            <AppText variant="caption" style={styles.episodeLabel}>{episodeLabel}</AppText>
            <AppText variant="caption" muted>{percent}%</AppText>
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]} /></View>
          <View style={styles.nextLine}>
            <Ionicons name={upcoming ? 'calendar-outline' : 'play-circle-outline'} size={12} color={upcoming ? colors.accent : colors.textMuted} />
            <AppText variant="caption" numberOfLines={1} style={upcoming ? styles.nextText : styles.mutedNext}>{headline}</AppText>
          </View>
        </View>
      </Pressable>
      <View style={styles.watchActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={next ? `Mark episode ${next.episodeNumber} of ${item.media.title} watched` : `Mark next episode of ${item.media.title} watched`}
          accessibilityState={{ disabled: !canAdvance || advance.isPending }}
          disabled={!canAdvance || advance.isPending}
          onPress={handleAdvance}
          style={({ pressed }) => [styles.epButton, (!canAdvance || advance.isPending) && styles.disabled, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={15} color={colors.white} />
          <AppText style={styles.epButtonText}>{next ? `EP ${next.episodeNumber}` : 'EP'}</AppText>
        </Pressable>
        {future.length ? <Pressable accessibilityRole="button" accessibilityLabel={`${scheduleOpen ? 'Hide' : 'Show'} upcoming episode dates for ${item.media.title}`} accessibilityState={{ expanded: scheduleOpen }} onPress={() => { triggerLightHaptic(); setScheduleOpen((open) => !open); }} hitSlop={6} style={styles.scheduleToggle}>
          <Ionicons name={scheduleOpen ? 'chevron-up' : 'calendar'} size={13} color={colors.textSecondary} />
          <AppText variant="caption" style={styles.scheduleToggleText}>Dates</AppText>
        </Pressable> : null}
      </View>
    </View>
    {scheduleOpen && future.length ? <View style={styles.schedule}>
      <AppText variant="caption" style={styles.scheduleKicker}>UPCOMING EPISODES</AppText>
      {future.slice(0, 6).map((episode) => (
        <View key={`${episode.seasonNumber}:${episode.episodeNumber}`} style={styles.scheduleRow}>
          <AppText variant="caption" style={styles.scheduleEp}>EP {episode.episodeNumber}</AppText>
          <AppText variant="caption" muted>{formatReleaseDate(episode.airDate) ?? 'Date to be announced'}</AppText>
        </View>
      ))}
    </View> : null}
  </View>;
}

type ListRow =
  | { type: 'watching'; key: string; item: SeriesProgress }
  | { type: 'header'; key: string; label: string }
  | { type: 'completed'; key: string; item: WatchedLibraryItem };

export default function WatchingScreen() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const requestedTab: Segment | undefined = tab === 'completed' ? 'completed' : tab === 'watching' ? 'watching' : undefined;
  const [segment, setSegment] = useState<Segment>(requestedTab ?? 'watching');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const seriesProgress = useSeriesProgress();
  const library = useWatchedLibrary();

  // Home's "Watched" counter opens this screen on Completed. Apply the route
  // request on focus, then clear it so the tab keeps the segment the user
  // chose when they come back through the tab bar.
  useFocusEffect(useCallback(() => {
    if (!requestedTab) return;
    setSegment(requestedTab);
    router.setParams({ tab: undefined });
  }, [requestedTab, router]));

  const watching = useMemo(() => (seriesProgress.data ?? [])
    .filter((item) => !item.isComplete && item.watchedEpisodeCount > 0 && matchesLocalQuery(item.media.title, search))
    .sort((a, b) => (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') || a.media.title.localeCompare(b.media.title)), [seriesProgress.data, search]);

  const completed = useMemo(() => (library.data ?? []).filter((item) => {
    const media = item.kind === 'movie' ? item.media : item.progress.media;
    return matchesLocalQuery(media.title, search);
  }), [library.data, search]);
  const groups = useMemo(() => groupByMonth(completed, watchedDateOf), [completed]);

  const rows: ListRow[] = useMemo(() => segment === 'watching'
    ? watching.map((item): ListRow => ({ type: 'watching', key: `watching:${item.media.id}`, item }))
    : groups.flatMap((group): ListRow[] => [
        { type: 'header', key: `header:${group.key}`, label: group.label },
        ...group.items.map((item): ListRow => ({
          type: 'completed',
          key: item.kind === 'movie' ? `movie:${item.media.id}` : `series:${item.progress.media.id}`,
          item,
        })),
      ]), [segment, watching, groups]);

  const activeLoading = segment === 'watching' ? seriesProgress.isLoading : library.isLoading;
  const activeError = segment === 'watching' ? seriesProgress.isError : library.isError;
  const activeRefetch = segment === 'watching' ? () => void seriesProgress.refetch() : () => void library.refetch();

  const open = (media: CatalogMedia, season?: number) => {
    const id = mediaRouteId(media);
    prefetchMedia(id);
    router.push({ pathname: '/media/[id]', params: season !== undefined && Number.isFinite(season) ? { id, season: String(season) } : { id } });
  };

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    triggerLightHaptic();
    resetEpisodeScheduleBackfill();
    void Promise.all([seriesProgress.refetch(), library.refetch()]).finally(() => setRefreshing(false));
  };

  const header = <View style={styles.header}>
    <View style={styles.titleRow}>
      <View style={styles.titleCopy}>
        <AppText variant="caption" style={styles.eyebrow}>{segment === 'completed' ? 'YOUR LIBRARY' : 'YOUR SHOWS'}</AppText>
        <AppText variant="heading1" style={styles.title}>{segment === 'completed' ? 'Watched' : 'Watching'}</AppText>
        <AppText variant="bodySmall" muted>{segment === 'completed' ? 'Movies and shows you have finished.' : 'Pick up where you left off — or revisit what you finished.'}</AppText>
      </View>
      <View style={styles.countBadge}>
        <Ionicons name={segment === 'watching' ? 'play-circle' : 'checkmark-circle'} size={13} color={segment === 'watching' ? colors.accent : colors.success} />
        <AppText variant="label" style={styles.countText}>{segment === 'watching' ? watching.length : completed.length}</AppText>
      </View>
    </View>
    <View style={styles.segments} accessibilityRole="tablist">
      <Pressable accessibilityRole="tab" accessibilityLabel={`Watching, ${watching.length} shows`} accessibilityState={{ selected: segment === 'watching' }} onPress={() => { if (segment !== 'watching') { triggerLightHaptic(); setSegment('watching'); } }} style={[styles.segment, segment === 'watching' && styles.segmentActive]}>
        <Ionicons name={segment === 'watching' ? 'play-circle' : 'play-circle-outline'} size={15} color={segment === 'watching' ? colors.white : colors.textSecondary} />
        <AppText variant="label" style={[styles.segmentText, segment === 'watching' && styles.segmentTextActive]}>Watching</AppText>
        <View style={[styles.segmentCount, segment === 'watching' && styles.segmentCountActive]}><AppText style={[styles.segmentCountText, segment === 'watching' && styles.segmentCountTextActive]}>{watching.length}</AppText></View>
      </Pressable>
      <Pressable accessibilityRole="tab" accessibilityLabel={`Completed, ${completed.length} titles`} accessibilityState={{ selected: segment === 'completed' }} onPress={() => { if (segment !== 'completed') { triggerLightHaptic(); setSegment('completed'); } }} style={[styles.segment, segment === 'completed' && styles.segmentActive]}>
        <Ionicons name={segment === 'completed' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={15} color={segment === 'completed' ? colors.white : colors.textSecondary} />
        <AppText variant="label" style={[styles.segmentText, segment === 'completed' && styles.segmentTextActive]}>Completed</AppText>
        <View style={[styles.segmentCount, segment === 'completed' && styles.segmentCountActive]}><AppText style={[styles.segmentCountText, segment === 'completed' && styles.segmentCountTextActive]}>{completed.length}</AppText></View>
      </Pressable>
    </View>
    <LibrarySearchInput value={search} onChange={setSearch} label={segment === 'watching' ? 'Search shows you are watching' : 'Search completed titles'} placeholder={segment === 'watching' ? 'Search shows you are watching' : 'Search completed titles'} />
  </View>;

  const watchingEmpty = <EmptyState icon="play-circle-outline" title="Nothing in progress" message="Mark an episode of a show or anime and its progress, next episode, and release dates will live here." actionLabel="Find something to watch" onAction={() => router.push('/search')} />;
  const completedEmpty = <EmptyState icon="checkmark-done-outline" title="Nothing completed yet" message="Movies you mark watched and shows you finish will appear here. Your progress is tracked on this device." actionLabel="Explore titles" onAction={() => router.push('/search')} />;

  return <Screen>
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item: row }) => {
        if (row.type === 'header') return <View style={styles.monthHeader}><AppText variant="caption" style={styles.monthLabel}>{row.label}</AppText><View style={styles.monthLine} /></View>;
        if (row.type === 'watching') {
          const season = row.item.nextEpisode?.seasonNumber ?? row.item.nextSeasonNumber;
          return <WatchingRow item={row.item} onOpen={() => open(row.item.media, season)} />;
        }
        const item = row.item;
        return item.kind === 'movie'
          ? <MovieRow media={item.media} watchedAt={item.watchedAt} onOpen={() => open(item.media)} />
          : <SeriesRow item={item} onOpen={() => open(item.progress.media)} />;
      }}
      ListHeaderComponent={<FadeInView>{header}</FadeInView>}
      ListEmptyComponent={activeLoading
        ? <LibraryListSkeleton card={false} posterWidth={54} posterHeight={78} />
        : activeError
          ? <ErrorView message={segment === 'watching' ? "Couldn't load your progress. Your data is safe." : "Couldn't load watched titles. Your data is safe."} onRetry={activeRefetch} />
          : segment === 'watching' ? watchingEmpty : completedEmpty}
      contentContainerStyle={styles.list}
      style={styles.flat}
      showsVerticalScrollIndicator={false}
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      windowSize={9}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
      ListFooterComponent={rows.length ? <View style={styles.footerSpace} /> : null}
    />
  </Screen>;
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  titleCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.accent, letterSpacing: 2 },
  title: { color: colors.white },
  countBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: 2 },
  countText: { color: colors.textPrimary },
  segments: { flexDirection: 'row', gap: 4, marginTop: spacing.lg, padding: 4, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 14 },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: colors.white },
  segmentCount: { minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.pill, alignItems: 'center', backgroundColor: colors.surfaceElevated },
  segmentCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  segmentCountText: { color: colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: '700' },
  segmentCountTextActive: { color: colors.white },
  watchCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, padding: spacing.sm, marginBottom: spacing.md },
  watchMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  watchOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  posterWrap: { width: 70, height: 102, borderRadius: radius.medium, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  poster: { width: '100%', height: '100%' },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  watchCopy: { flex: 1, gap: 3, paddingVertical: 1 },
  watchTitle: { color: colors.white, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  progressMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: 2 },
  episodeLabel: { color: colors.textPrimary, fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 0.3 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  nextLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  nextText: { color: colors.accent, flexShrink: 1, fontSize: 10.5, lineHeight: 14 },
  mutedNext: { flexShrink: 1, fontSize: 10.5, lineHeight: 14 },
  watchActions: { alignItems: 'center', gap: spacing.sm, paddingRight: 2 },
  epButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 62, height: 34, borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: spacing.sm },
  epButtonText: { color: colors.white, fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.3 },
  scheduleToggle: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3 },
  scheduleToggleText: { color: colors.textSecondary, fontSize: 9.5, lineHeight: 12 },
  schedule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm, gap: 5 },
  scheduleKicker: { color: colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 1.2 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  scheduleEp: { color: colors.textPrimary, fontWeight: '700' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  monthLabel: { color: colors.textMuted, letterSpacing: 1 },
  monthLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  flat: { flex: 1 },
  list: { flexGrow: 1, paddingBottom: spacing['2xl'] },
  footerSpace: { height: spacing.lg },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
