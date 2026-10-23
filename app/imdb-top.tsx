import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import { useImdbTop } from '@/features/catalog/hooks';
import type { ImdbTopItem } from '@/data/remote/supabase/imdbRatings';
import { formatCompactCount } from '@/lib/format';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

type ImdbMedia = 'movie' | 'series';

function subtitleFor(item: ImdbTopItem): string {
  const votes = formatCompactCount(item.votes);
  return `IMDb ★ ${item.rating.toFixed(1)}${votes ? ` · ${votes} votes` : ''}`;
}

export default function ImdbTopScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [media, setMedia] = useState<ImdbMedia>('movie');
  const query = useImdbTop(media);
  const items = query.data ?? [];
  const cardWidth = Math.max(120, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openMedia = (item: ImdbTopItem) => router.push({ pathname: '/media/[id]', params: { id: `tmdb:${item.mediaType}:${item.tmdbId}` } });

  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /><View style={styles.title}><AppText variant="heading1">Top 250</AppText></View></View></FadeInView>
    <View style={styles.pills}>
      {(['movie', 'series'] as ImdbMedia[]).map((option) => {
        const selected = option === media;
        return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Show IMDb top ${option === 'movie' ? 'movies' : 'series'}`} onPress={() => { if (!selected) { triggerLightHaptic(); setMedia(option); } }} style={[styles.pill, selected && styles.pillActive]}><AppText variant="label" style={selected ? styles.pillTextActive : styles.pillText}>{option === 'movie' ? 'Movies' : 'Series'}</AppText></Pressable>;
      })}
    </View>
    {query.isLoading ? <FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} />
      : query.isError ? <ErrorView message="Could not load Top 250. Check your connection and try again." onRetry={() => void query.refetch()} />
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
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
        renderItem={({ item }) => <PosterCard title={item.title} subtitle={item.year ? String(item.year) : undefined} meta={subtitleFor(item)} posterUri={item.posterUrl} badge={`#${item.rank}`} width={cardWidth} onPress={() => openMedia(item)} />}
      />
      : <EmptyState icon="star-outline" title="Top 250 not published yet" message="The weekly IMDb snapshot has not been generated yet. Check back soon." />}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, gap: spacing.xs },
  pills: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.md },
  pill: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.textSecondary },
  pillTextActive: { color: colors.white },
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
});
