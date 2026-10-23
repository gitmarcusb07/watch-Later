import { useMemo, useState } from 'react';
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
import { prefetchMedia, useBollywoodPages, useHollywoodPages, usePopularAnimePages, usePopularMoviesPages, usePopularSeriesPages, useTrendingAllPages } from '@/features/catalog/hooks';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { isUpcoming } from '@/features/catalog/upcoming';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

type BrowseTab = 'trending' | 'movies' | 'shows' | 'anime' | 'bollywood' | 'hollywood';
const TABS: { label: string; value: BrowseTab; hint: string }[] = [
  { label: 'Trending', value: 'trending', hint: 'Show trending titles' },
  { label: 'Movies', value: 'movies', hint: 'Show popular movies' },
  { label: 'Shows', value: 'shows', hint: 'Show popular series' },
  { label: 'Anime', value: 'anime', hint: 'Show popular anime' },
  { label: 'Bollywood', value: 'bollywood', hint: 'Show Hindi movies and OTT shows' },
  { label: 'Hollywood', value: 'hollywood', hint: 'Show English movies and shows' },
];

function useTabQuery(tab: BrowseTab) {
  const trending = useTrendingAllPages(tab === 'trending');
  const movies = usePopularMoviesPages(tab === 'movies');
  const shows = usePopularSeriesPages(tab === 'shows');
  const anime = usePopularAnimePages(tab === 'anime');
  const bollywood = useBollywoodPages(tab === 'bollywood');
  const hollywood = useHollywoodPages(tab === 'hollywood');
  switch (tab) {
    case 'movies': return movies;
    case 'shows': return shows;
    case 'anime': return anime;
    case 'bollywood': return bollywood;
    case 'hollywood': return hollywood;
    case 'trending':
    default: return trending;
  }
}

function subtitleFor(media: CatalogMedia): string {
  const kind = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime';
  return [media.year, kind].filter(Boolean).join(' · ');
}

export default function BrowseScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<BrowseTab>('trending');
  const query = useTabQuery(tab);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: CatalogMedia[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const media of page.items) {
        // Browse is a "what's out now" shelf: unreleased titles belong on
        // /upcoming, so they are dropped here even if a provider ranks them.
        if (seen.has(media.id) || isUpcoming(media)) continue;
        seen.add(media.id);
        merged.push(media);
      }
    }
    return merged;
  }, [query.data]);
  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openMedia = (id: string) => {
    // Warm the media detail cache before the push so the page opens instantly.
    prefetchMedia(id);
    router.push({ pathname: '/media/[id]', params: { id } });
  };
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  };

  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /><View style={styles.title}><AppText variant="heading1">Browse</AppText></View><IconButton name="calendar-outline" label="Open upcoming releases" onPress={() => router.push('/upcoming' as never)} /></View></FadeInView>
    <View style={styles.tabs}>{TABS.map((option) => (
      <Pressable key={option.value} accessibilityRole="tab" accessibilityLabel={option.hint} accessibilityState={{ selected: tab === option.value }} onPress={() => { if (tab !== option.value) triggerLightHaptic(); setTab(option.value); }} style={[styles.tab, tab === option.value && styles.active]}>
        <AppText variant="label" style={{ color: tab === option.value ? colors.white : colors.textSecondary }}>{option.label}</AppText>
      </Pressable>
    ))}</View>
    {query.isLoading && !items.length ? <FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} />
      : query.isError && !items.length ? <ErrorView message={query.error instanceof CatalogError ? query.error.userMessage : 'Could not load browse titles. Check your connection and try again.'} onRetry={() => void query.refetch()} />
      : items.length ? <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        style={styles.flat}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
        ListFooterComponent={query.isFetching && !query.isRefetching ? <View style={styles.footer}><ActivityIndicator color={colors.accent} /><AppText variant="caption" muted>Loading more…</AppText></View> : !query.hasNextPage ? <AppText variant="caption" muted style={styles.end}>You have seen it all</AppText> : null}
        renderItem={({ item }) => <PosterCard title={item.title} subtitle={subtitleFor(item)} posterUri={item.posterUrl} width={cardWidth} onPress={() => openMedia(mediaRouteId(item))} />}
      />
      : <EmptyState icon="compass-outline" title="Nothing here yet" message="These shelves fill in when you're back online." actionLabel="Go to search" onAction={() => router.push('/search')} />}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  end: { textAlign: 'center', paddingVertical: spacing.xl },
});
