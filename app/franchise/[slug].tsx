import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import { franchiseBySlug, franchiseItemRouteId } from '@/features/franchises/catalog';
import { useFranchiseStatuses } from '@/features/franchises/hooks';
import { colors, radius, spacing } from '@/theme';

function kindLabel(mediaType: string): string {
  return mediaType === 'movie' ? 'Movie' : 'Show';
}

/**
 * One franchise: hero art, description, member count and the numbered,
 * in-order poster grid. Members open the standard media detail screen, so
 * watchlist/watched actions work exactly as they do everywhere else.
 */
export default function FranchiseDetailScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { width } = useWindowDimensions();
  const franchise = franchiseBySlug(slug);
  const items = useMemo(() => franchise?.items ?? [], [franchise]);
  const statuses = useFranchiseStatuses(items);
  const columns = width >= 640 ? 4 : 3;
  const cardWidth = Math.max(96, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md * (columns - 1)) / columns));
  const watchedCount = useMemo(() => {
    const map = statuses.data;
    if (!map) return 0;
    return items.filter((item) => map[franchiseItemRouteId(item)]?.complete).length;
  }, [items, statuses.data]);

  if (!franchise) {
    return (
      <Screen>
        <View style={styles.backFloating}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
        </View>
        <EmptyState icon="albums-outline" title="Collection not found" message="This franchise collection is no longer available." />
      </Screen>
    );
  }

  const backdropUri = franchise.backdropPath ? `https://image.tmdb.org/t/p/w780${franchise.backdropPath}` : undefined;
  const openMedia = (routeId: string) => router.push({ pathname: '/media/[id]', params: { id: routeId } } as never);

  return (
    <Screen>
      {/* Pinned above the grid: the back button never scrolls away. */}
      <View style={styles.backFloating}>
        <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${franchiseItemRouteId(item)}-${index}`}
        numColumns={columns}
        key={`cols-${columns}`}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        style={styles.flat}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={9}
        updateCellsBatchingPeriod={30}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.heroWrap}>
            <FadeInView>
              <View style={styles.backdrop}>
                {backdropUri ? <RemoteImage uri={backdropUri} style={StyleSheet.absoluteFill} /> : null}
                <View style={styles.scrim} />
                <View style={styles.backdropCopy}>
                  <AppText variant="heading1" style={styles.heroTitle}>{franchise.title}</AppText>
                  <View style={styles.countRow}>
                    <Ionicons name="albums-outline" size={14} color={colors.textSecondary} />
                    <AppText variant="caption" style={styles.countText}>{items.length} {items.length === 1 ? 'item' : 'items'}</AppText>
                    {statuses.data && watchedCount > 0 ? (
                      <View style={styles.watchedPill}>
                        <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                        <AppText variant="caption" style={styles.watchedText}>{watchedCount} watched</AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
              <AppText variant="bodySmall" muted style={styles.overview}>{franchise.overview}</AppText>
              <AppText variant="caption" muted style={styles.orderHint}>In order · tap any title to open it</AppText>
            </FadeInView>
          </View>
        }
        renderItem={({ item, index }) => {
          const routeId = franchiseItemRouteId(item);
          const status = statuses.data?.[routeId];
          const subtitle = [kindLabel(item.mediaType), item.year].filter(Boolean).join(' · ');
          return (
            <PosterCard
              title={item.title}
              subtitle={subtitle}
              meta={status?.complete ? '✓ Watched' : undefined}
              posterUri={item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : undefined}
              badge={String(index + 1)}
              width={cardWidth}
              onPress={() => openMedia(routeId)}
            />
          );
        }}
        ListEmptyComponent={<EmptyState icon="albums-outline" title="Empty collection" message="This franchise has no linked titles yet." />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  heroWrap: { paddingTop: spacing.lg + 48 + spacing.md, paddingBottom: spacing.lg },
  backFloating: { position: 'absolute', top: spacing.lg, left: spacing.xl, zIndex: 10 },
  backdrop: { height: 190, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 6, 10, 0.45)' },
  backdropCopy: { padding: spacing.lg, gap: spacing.sm },
  heroTitle: { color: colors.white, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  countText: { color: colors.textSecondary },
  watchedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(117, 214, 162, 0.14)' },
  watchedText: { color: colors.success },
  overview: { marginTop: spacing.lg },
  orderHint: { marginTop: spacing.sm, color: colors.textMuted, letterSpacing: 0.4 },
});
