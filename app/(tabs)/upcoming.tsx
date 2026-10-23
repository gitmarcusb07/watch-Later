import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import type { CatalogMedia } from '@/domain/models/media';
import { CatalogError } from '@/domain/errors/CatalogError';
import { prefetchMedia, useAllUpcoming } from '@/features/catalog/hooks';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { upcomingSubtitle } from '@/features/catalog/upcoming';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

type UpcomingFilter = 'all' | 'movies' | 'series' | 'anime';
const FILTERS: { label: string; value: UpcomingFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Movies', value: 'movies' },
  { label: 'Series', value: 'series' },
  { label: 'Anime', value: 'anime' },
];

function matchesFilter(media: CatalogMedia, filter: UpcomingFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'movies') return media.mediaType === 'movie';
  if (filter === 'series') return media.mediaType === 'series';
  return media.mediaType === 'anime';
}

/**
 * The complete release calendar. One cached query walks every capped provider
 * page before rendering, so the grid is ordered once and never re-sorted,
 * appended into, or parked halfway through — the source of the old jumps.
 * Filtering afterwards is purely local and instant.
 */
export default function UpcomingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<CatalogMedia>>(null);
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  const query = useAllUpcoming();
  const items = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter]);
  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const firstError = query.error instanceof CatalogError ? query.error : undefined;

  function changeFilter(next: UpcomingFilter) {
    if (next === filter) return;
    triggerLightHaptic();
    setFilter(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function openMedia(media: CatalogMedia) {
    triggerLightHaptic();
    const id = mediaRouteId(media);
    prefetchMedia(id);
    router.push({ pathname: '/media/[id]', params: { id } });
  }

  const header = <FadeInView>
    <View style={styles.topRow}>
      <IconButton name="arrow-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <View style={styles.countBadge}>
        <Ionicons name="calendar" size={13} color={colors.accent} />
        <AppText variant="label" style={styles.countText}>{filtered.length}</AppText>
      </View>
    </View>
    <View style={styles.headerCopy}>
      <AppText variant="caption" style={styles.eyebrow}>RELEASE CALENDAR</AppText>
      <AppText variant="heading1" style={styles.title}>Upcoming</AppText>
      <AppText variant="bodySmall" muted>Every dated movie, show, and anime — oldest release first.</AppText>
    </View>
    <View style={styles.filters}>
      {FILTERS.map((option) => {
        const selected = option.value === filter;
        return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Show upcoming ${option.label}`} onPress={() => changeFilter(option.value)} style={[styles.filter, selected && styles.filterActive]}>
          <AppText variant="label" style={selected ? styles.filterTextActive : styles.filterText}>{option.label}</AppText>
        </Pressable>;
      })}
    </View>
  </FadeInView>;

  const empty = query.isLoading
    ? <View style={styles.skeletonGrid} accessibilityRole="progressbar" accessibilityLabel="Loading every upcoming release">{[0, 1, 2, 3, 4, 5].map((index) => <PosterSkeleton key={index} width={cardWidth} />)}</View>
    : query.isError
      ? <ErrorView message={firstError?.userMessage ?? 'Could not load upcoming titles. Check your connection and try again.'} onRetry={() => void query.refetch()} />
      : <EmptyState icon="calendar-outline" title={items.length ? `No upcoming ${filter === 'all' ? 'titles' : filter}` : 'No upcoming titles'} message={items.length ? 'Nothing in this group right now — try All.' : 'Nothing dated in the future right now — check back soon.'} actionLabel={items.length ? 'Show all releases' : 'Browse instead'} onAction={() => items.length ? changeFilter('all') : router.push('/browse')} />;

  return <Screen><FlatList
    ref={listRef}
    data={filtered}
    keyExtractor={(item) => item.id}
    numColumns={2}
    columnWrapperStyle={styles.gridRow}
    ListHeaderComponent={header}
    ListEmptyComponent={empty}
    ListFooterComponent={filtered.length ? <AppText variant="caption" muted style={styles.end}>You have seen every dated release</AppText> : null}
    contentContainerStyle={styles.grid}
    style={styles.flat}
    showsVerticalScrollIndicator={false}
    initialNumToRender={10}
    maxToRenderPerBatch={10}
    updateCellsBatchingPeriod={50}
    windowSize={11}
    removeClippedSubviews={false}
    refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
    renderItem={({ item }) => <PosterCard title={item.title} subtitle={upcomingSubtitle(item)} posterUri={item.posterUrl} width={cardWidth} onPress={() => openMedia(item)} />}
  /></Screen>;
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.lg },
  countBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  countText: { color: colors.textPrimary },
  headerCopy: { gap: 2, paddingTop: spacing.sm },
  eyebrow: { color: colors.accent, letterSpacing: 2 },
  title: { color: colors.white },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  filter: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.white },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingTop: spacing.sm },
  end: { textAlign: 'center', paddingVertical: spacing.xl },
});
