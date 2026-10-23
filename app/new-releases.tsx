import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import type { CatalogMedia } from '@/domain/models/media';
import { useRecentlyReleased } from '@/features/catalog/hooks';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { colors, spacing } from '@/theme';

function subtitleFor(media: CatalogMedia): string {
  const kind = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime';
  return [media.year, kind].filter(Boolean).join(' · ');
}

export default function NewReleasesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const query = useRecentlyReleased();
  const items = query.data ?? [];
  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openMedia = (id: string) => router.push({ pathname: '/media/[id]', params: { id } });

  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /><View style={styles.title}><AppText variant="heading1">New Releases</AppText></View></View></FadeInView>
    {query.isLoading ? <FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} />
      : query.isError ? <ErrorView message="Could not load new releases. Check your connection and try again." onRetry={() => void query.refetch()} />
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
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
        renderItem={({ item }) => <PosterCard title={item.title} subtitle={subtitleFor(item)} posterUri={item.posterUrl} width={cardWidth} onPress={() => openMedia(mediaRouteId(item))} />}
      />
      : <EmptyState icon="sparkles-outline" title="Nothing new right now" message="Fresh releases will land here as soon as they're out." actionLabel="Browse instead" onAction={() => router.push('/browse')} />}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
});
