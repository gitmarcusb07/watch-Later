import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import type { CatalogMedia } from '@/domain/models/media';
import { CatalogError } from '@/domain/errors/CatalogError';
import { useUpcomingAnimePages, useUpcomingMoviesPages, useUpcomingSeriesPages } from '@/features/catalog/hooks';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { upcomingSubtitle } from '@/features/catalog/upcoming';
import { pendingUpcomingItems, sortUpcomingBatch } from '@/features/catalog/upcomingStream';
import { queryClient } from '@/lib/query/queryClient';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

type UpcomingFilter = 'all' | 'movies' | 'series' | 'anime';
const FILTERS: { label: string; value: UpcomingFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Movies', value: 'movies' },
  { label: 'Series', value: 'series' },
  { label: 'Anime', value: 'anime' },
];

/** One page per feed per round, then a short rest — steady, complete, and kind to rate limits. */
const ROUND_PACE_MS = 350;
/** Rounds without a single new row before the walk parks itself (scrolling or pulling to refresh resumes it). */
const MAX_IDLE_ROUNDS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export default function UpcomingScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /><View style={styles.title}><AppText variant="heading1">Upcoming</AppText></View></View></FadeInView>
    <View style={styles.filters}>{FILTERS.map((option) => {
      const selected = option.value === filter;
      return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Show upcoming ${option.label}`} onPress={() => { if (!selected) triggerLightHaptic(); setFilter(option.value); }} style={[styles.filter, selected && styles.filterActive]}><AppText variant="label" style={selected ? styles.filterTextActive : styles.filterText}>{option.label}</AppText></Pressable>;
    })}</View>
    {/* Keyed by filter so switching scopes starts a clean append-only stream. */}
    <UpcomingFeedList key={filter} filter={filter} />
  </Screen>;
}

/**
 * The Upcoming feed. All three provider feeds are walked to their last page in
 * the background — one page per feed per round — and every row is emitted
 * exactly once, appended at the end of the list. Nothing is ever re-sorted or
 * removed, so however fast the user flings, the viewport cannot jump and the
 * grid never dead-ends before the feeds are exhausted.
 */
function UpcomingFeedList({ filter }: { filter: UpcomingFilter }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const movies = useUpcomingMoviesPages(filter === 'all' || filter === 'movies');
  const series = useUpcomingSeriesPages(filter === 'all' || filter === 'series');
  const anime = useUpcomingAnimePages(filter === 'all' || filter === 'anime');
  const feeds = filter === 'movies' ? [movies] : filter === 'series' ? [series] : filter === 'anime' ? [anime] : [movies, series, anime];

  const feedsRef = useRef(feeds);
  useEffect(() => { feedsRef.current = feeds; });

  const [items, setItems] = useState<CatalogMedia[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [parked, setParked] = useState(false);
  const emitted = useRef(new Set<string>());
  const idleRounds = useRef(0);
  const pumping = useRef(false);
  const cancelled = useRef(false);

  /** Emits every row that has not been shown yet, keeping the list append-only. */
  const flush = useCallback(() => {
    const active = feedsRef.current;
    if (cancelled.current) return false;
    // A refresh resets the feeds; their old pages are about to be replaced, so
    // emitting them now would duplicate every row.
    if (active.some((query) => query.isRefetching || (query.isPending && query.isFetching))) return false;
    const pending = pendingUpcomingItems(active, emitted.current);
    if (!pending.length) return false;
    for (const media of pending) emitted.current.add(media.id);
    const batch = sortUpcomingBatch(pending);
    setItems((previous) => [...previous, ...batch]);
    return true;
  }, []);

  /** Walks every feed one page per round until all of them end (or the walk parks after repeated stalls). */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (!cancelled.current) {
        flush();
        const active = feedsRef.current;
        const settledFirstPages = active.every((query) => query.data || (!query.isLoading && !query.isFetching));
        const canAdvance = active.some((query) => query.hasNextPage);
        if (settledFirstPages && !canAdvance) {
          setParked(false);
          return;
        }
        const started: Promise<unknown>[] = [];
        if (settledFirstPages) {
          for (const query of active) {
            if (query.hasNextPage && !query.isFetchingNextPage && !query.isRefetching) {
              started.push(Promise.resolve(query.fetchNextPage()).catch(() => undefined));
            }
          }
        }
        await (started.length ? Promise.all(started) : delay(ROUND_PACE_MS));
        if (cancelled.current) return;
        // Let React commit the fetched pages before reading them back.
        await delay(16);
        if (cancelled.current) return;
        const progressed = flush();
        if (started.length) {
          idleRounds.current = progressed ? 0 : idleRounds.current + 1;
          if (progressed) setParked(false);
        }
        if (idleRounds.current >= MAX_IDLE_ROUNDS) {
          // Offline or rate-limited: park until the user scrolls or refreshes —
          // retrying forever would just stack doomed requests.
          setParked(true);
          return;
        }
        await delay(ROUND_PACE_MS);
      }
    } finally {
      pumping.current = false;
    }
  }, [flush]);

  useEffect(() => {
    cancelled.current = false;
    void pump();
    return () => { cancelled.current = true; };
  }, [pump]);

  // A fling firing onEndReached restarts a parked walk (or is a no-op while it runs).
  const nudge = useCallback(() => {
    idleRounds.current = 0;
    setParked(false);
    void pump();
  }, [pump]);

  const refresh = useCallback(() => {
    // A cheap, complete restart: reset the cached pages to page one (the
    // mounted feeds refetch themselves), clear the stream, and re-walk.
    setRefreshing(true);
    emitted.current.clear();
    setItems([]);
    idleRounds.current = 0;
    setParked(false);
    void queryClient.resetQueries({ queryKey: ['catalog', 'upcoming'] }).finally(() => {
      setRefreshing(false);
      void pump();
    });
  }, [pump]);

  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openMedia = (id: string) => router.push({ pathname: '/media/[id]', params: { id } });
  const loading = feeds.some((query) => query.isLoading) && !items.length;
  const failed = feeds.every((query) => query.isError) && !items.length;
  const firstError = feeds.map((query) => query.error).find((error) => error instanceof CatalogError);
  const fetchingMore = feeds.some((query) => query.isFetchingNextPage);
  const canLoadMore = feeds.some((query) => query.hasNextPage);
  const reachedEnd = !canLoadMore && items.length > 0 && feeds.every((query) => Boolean(query.data) || query.isError);

  return loading ? <FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton />} showsVerticalScrollIndicator={false} />
    : failed ? <ErrorView message={firstError instanceof CatalogError ? firstError.userMessage : 'Could not load upcoming titles. Check your connection and try again.'} onRetry={refresh} />
    : items.length ? <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={styles.grid}
      style={styles.flat}
      showsVerticalScrollIndicator={false}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={50}
      windowSize={11}
      removeClippedSubviews={false}
      onEndReached={nudge}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
      ListFooterComponent={fetchingMore ? <View style={styles.footer}><ActivityIndicator color={colors.accent} /><AppText variant="caption" muted>Loading more…</AppText></View> : parked && canLoadMore ? <AppText variant="caption" muted style={styles.end}>Connection hiccup — scroll or pull to keep loading</AppText> : reachedEnd ? <AppText variant="caption" muted style={styles.end}>You have seen it all</AppText> : null}
      renderItem={({ item }) => <PosterCard title={item.title} subtitle={upcomingSubtitle(item)} posterUri={item.posterUrl} width={cardWidth} onPress={() => openMedia(mediaRouteId(item))} />}
    />
    : <EmptyState icon="calendar-outline" title="No upcoming titles" message="Nothing dated in the future right now — check back soon." actionLabel="Browse instead" onAction={() => router.push('/browse')} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md },
  filter: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.white },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  end: { textAlign: 'center', paddingVertical: spacing.xl },
});
