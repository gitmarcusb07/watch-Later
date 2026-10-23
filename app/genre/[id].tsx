import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import type { CatalogMedia } from '@/domain/models/media';
import type { GenrePageKind } from '@/domain/repositories/CatalogRepository';
import { CatalogError } from '@/domain/errors/CatalogError';
import { useGenrePages } from '@/features/genres/hooks';
import { anilistGenreFor, genreById } from '@/features/genres/catalog';
import { prefetchMedia } from '@/features/catalog/hooks';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { isUpcoming } from '@/features/catalog/upcoming';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';

/** The filter row under the genre title — All shows everything mixed. */
const SCOPES: { label: string; value: GenrePageKind; hint: string }[] = [
  { label: 'All', value: 'all', hint: 'Show mixed movies, shows, and anime' },
  { label: 'Movies', value: 'movies', hint: 'Show Hollywood, Bollywood, and anime movies' },
  { label: 'Shows', value: 'shows', hint: 'Show Hollywood and Bollywood shows' },
  { label: 'Anime', value: 'anime', hint: 'Show anime series and movies' },
];

function subtitleFor(media: CatalogMedia): string {
  const kind = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime';
  return [media.year, kind].filter(Boolean).join(' · ');
}

function readGenreId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

export default function GenreScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string }>();
  const genreId = readGenreId(params.id);
  const genre = genreById(genreId);
  const [kind, setKind] = useState<GenrePageKind>('all');
  const query = useGenrePages(genreId, kind, genre !== undefined);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: CatalogMedia[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const media of page.items) {
        // Genre grids are discovery shelves: unreleased titles are the
        // Upcoming screen's job, never a "browse" poster grid.
        if (seen.has(media.id) || isUpcoming(media)) continue;
        seen.add(media.id);
        merged.push(media);
      }
    }
    return merged;
  }, [query.data]);
  const cardWidth = Math.max(96, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md * 2) / 3));
  const openMedia = (id: string) => {
    // Warm the media detail cache so the pushed page renders instantly.
    prefetchMedia(id);
    router.push({ pathname: '/media/[id]', params: { id } } as never);
  };
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  };
  const animeUntagged = kind === 'anime' && (anilistGenreFor(genreId) === null || anilistGenreFor(genreId) === undefined);

  if (!genre) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
          <View style={styles.title}><AppText variant="heading1">Genre</AppText></View>
        </View>
        <EmptyState icon="pricetags-outline" title="Genre not found" message="This genre collection is no longer available." actionLabel="Back to genres" onAction={() => router.replace('/genres' as never)} />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Header and filter row stay pinned above the grid — scrolling the
          posters never hides the back button or the active scope. */}
      <FadeInView>
        <View style={styles.header}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
          <View style={styles.title}><AppText variant="heading1">{genre.name}</AppText></View>
        </View>
      </FadeInView>
      <View style={styles.tabs} accessibilityRole="tablist">
        {SCOPES.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.hint}
            accessibilityState={{ selected: kind === option.value }}
            onPress={() => { if (kind !== option.value) triggerLightHaptic(); setKind(option.value); }}
            style={[styles.tab, kind === option.value && styles.active]}
          >
            <AppText variant="label" style={{ color: kind === option.value ? colors.white : colors.textSecondary }}>{option.label}</AppText>
          </Pressable>
        ))}
      </View>
      {query.isLoading && !items.length ? <FlatList data={[0, 1, 2, 3, 4, 5, 6, 7, 8]} keyExtractor={(item) => String(item)} numColumns={3} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} />
        : query.isError && !items.length ? <ErrorView message={query.error instanceof CatalogError ? query.error.userMessage : `Could not load ${genre.name} titles. Check your connection and try again.`} onRetry={() => void query.refetch()} />
        : items.length ? <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          style={styles.flat}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
          ListFooterComponent={query.isFetching && !query.isRefetching ? <View style={styles.footer}><ActivityIndicator color={colors.accent} /><AppText variant="caption" muted>Loading more…</AppText></View> : !query.hasNextPage ? <AppText variant="caption" muted style={styles.end}>You have seen it all</AppText> : null}
          renderItem={({ item }) => <PosterCard title={item.title} subtitle={subtitleFor(item)} posterUri={item.posterUrl} width={cardWidth} onPress={() => openMedia(mediaRouteId(item))} />}
        />
        : <EmptyState
          icon="pricetags-outline"
          title={animeUntagged ? 'No anime here' : 'Nothing here yet'}
          message={animeUntagged ? `${genre.name} has no anime catalogue — anime is tagged by AniList genres. Try All, Movies, or Shows.` : `New ${genre.name} titles fill in when you're back online.`}
        />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title: { flex: 1, gap: spacing.xs },
  tabs: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { paddingBottom: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  active: { borderBottomColor: colors.accent },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  end: { textAlign: 'center', paddingVertical: spacing.xl },
});
