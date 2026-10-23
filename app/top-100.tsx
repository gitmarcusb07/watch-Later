import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import { useImdbTop } from '@/features/catalog/hooks';
import { mixImdbTops, type ImdbTopItem } from '@/data/remote/supabase/imdbRatings';
import { formatCompactCount } from '@/lib/format';
import { colors, spacing } from '@/theme';

function subtitleFor(item: ImdbTopItem): string {
  const kind = item.mediaType === 'movie' ? 'Movie' : 'TV series';
  const votes = formatCompactCount(item.votes);
  return [`IMDb ★ ${item.rating.toFixed(1)}${votes ? ` (${votes})` : ''}`, item.year, kind].filter(Boolean).join(' · ');
}

export default function Top100Screen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const moviesQuery = useImdbTop('movie');
  const seriesQuery = useImdbTop('series');
  const items = mixImdbTops(moviesQuery.data ?? [], seriesQuery.data ?? []);
  const loading = moviesQuery.isLoading || seriesQuery.isLoading;
  const failed = (moviesQuery.isError || seriesQuery.isError) && !items.length;
  const refetching = (moviesQuery.isRefetching || seriesQuery.isRefetching) && !loading;
  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openMedia = (item: ImdbTopItem) => router.push({ pathname: '/media/[id]', params: { id: `tmdb:${item.mediaType}:${item.tmdbId}` } });
  const refetch = () => { void Promise.all([moviesQuery.refetch(), seriesQuery.refetch()]); };

  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /><View style={styles.title}><AppText variant="heading1">Top 100</AppText></View></View></FadeInView>
    {loading ? <FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} />
      : failed ? <ErrorView message="Could not load the top 100. Check your connection and try again." onRetry={refetch} />
      : items.length ? <FlatList
        data={items}
        keyExtractor={(item) => `${item.mediaType}:${item.tmdbId}`}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        style={styles.flat}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
        renderItem={({ item, index }) => <PosterCard title={item.title} subtitle={subtitleFor(item)} posterUri={item.posterUrl} badge={`#${index + 1}`} width={cardWidth} onPress={() => openMedia(item)} />}
      />
      : <EmptyState icon="trophy-outline" title="Top 100 not published yet" message="The weekly IMDb snapshot has not been generated yet. Check back soon." />}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
});
