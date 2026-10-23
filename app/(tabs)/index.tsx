import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { AppTopBar } from '@/components/common/AppTopBar';
import { FadeInView } from '@/components/common/FadeInView';
import { ErrorView, LoadingView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { ContinueWatchingCard } from '@/components/media/ContinueWatchingCard';
import { PosterCard } from '@/components/media/PosterCard';
import { FranchiseCard } from '@/components/franchise/FranchiseCard';
import { GenreCard } from '@/components/genres/GenreCard';
import { SectionHeader } from '@/components/common/SectionHeader';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { homeFranchises } from '@/features/franchises/catalog';
import { GENRES } from '@/features/genres/catalog';
import { useContinueWatching, useWatchedLibrary, useWatchlist, watchKeys } from '@/features/watchState/hooks';
import { useImdbTop, useRecentlyReleased } from '@/features/catalog/hooks';
import { mixImdbTops } from '@/data/remote/supabase/imdbRatings';
import { triggerLightHaptic } from '@/lib/haptics';
import { maybePromptNotificationPermission } from '@/features/notifications/permissionGate';
import type { CatalogMedia } from '@/domain/models/media';
import { colors, radius, spacing } from '@/theme';

function subtitleFor(media: CatalogMedia): string {
  const kind = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime';
  return [media.year, kind].filter(Boolean).join(' · ');
}

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const continueQuery = useContinueWatching();
  const watchlistQuery = useWatchlist();
  const watchedQuery = useWatchedLibrary();
  const recentQuery = useRecentlyReleased();
  const topMoviesQuery = useImdbTop('movie');
  const topSeriesQuery = useImdbTop('series');
  const topItems = mixImdbTops(topMoviesQuery.data ?? [], topSeriesQuery.data ?? []).slice(0, 6);
  const topLoading = topMoviesQuery.isLoading || topSeriesQuery.isLoading;
  const topFailed = (topMoviesQuery.isError || topSeriesQuery.isError) && !topItems.length;
  const refetchTop = () => { void Promise.all([topMoviesQuery.refetch(), topSeriesQuery.refetch()]); };

  const watchlistCount = watchlistQuery.data?.length ?? 0;
  const watchedCount = (watchedQuery.data ?? []).length;
  const continueCount = continueQuery.data?.length ?? 0;

  const openMedia = (id: string) => router.push({ pathname: '/media/[id]', params: { id } });
  // First home open after onboarding: offer notification permission once so
  // release reminders can actually fire. Never blocks the screen.
  useEffect(() => {
    void maybePromptNotificationPermission();
  }, []);
  const onRefresh = () => {
    triggerLightHaptic();
    setRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: watchKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['catalog'] }),
    ]).finally(() => setRefreshing(false));
  };

  return <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
    <AppTopBar />
    <FadeInView>
    <View style={styles.hero}>
      <View style={styles.heroCopy}>
        <AppText variant="caption" style={styles.eyebrow}>YOUR LIBRARY</AppText>
        <AppText variant="heading1" style={styles.title}>What are we watching?</AppText>
        <AppText variant="bodySmall" muted>
          {watchlistCount} to watch · {watchedCount} watched{continueCount ? ` · ${continueCount} in progress` : ''}
        </AppText>
      </View>
      <View style={styles.stats}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open watchlist, ${watchlistCount} titles`} onPress={() => { triggerLightHaptic(); router.push('/(tabs)/watchlist'); }} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
          <Ionicons name="bookmark" size={18} color={colors.accent} />
          <AppText variant="heading2">{watchlistCount}</AppText>
          <AppText variant="caption" muted>To watch</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open watched, ${watchedCount} titles`} onPress={() => { triggerLightHaptic(); router.push({ pathname: '/(tabs)/watched', params: { tab: 'completed' } } as never); }} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <AppText variant="heading2">{watchedCount}</AppText>
          <AppText variant="caption" muted>Watched</AppText>
        </Pressable>
      </View>
    </View>
    </FadeInView>

    {/* Section order by importance: resume what you were watching, this week's
        new drops, the all-time best, then browse by mood, and the franchise
        deep-dive (most specialized) last. */}
    <FadeInView delay={90}>
    <View style={styles.section}><SectionHeader title="Continue Watching" subtitle="Pick up right where you left off" />
      {continueQuery.isLoading ? <LoadingView label="Loading your progress" /> : continueQuery.isError ? <ErrorView message="Couldn't load your progress. Try again." onRetry={() => void continueQuery.refetch()} /> : continueQuery.data?.length ? continueQuery.data.slice(0, 2).map((item) => <ContinueWatchingCard key={item.media.id} title={item.media.title} posterUri={item.media.posterUrl} subtitle={item.nextEpisode ? `S${item.nextEpisode.seasonNumber} E${item.nextEpisode.episodeNumber} · ${item.nextEpisode.title}` : `Continue with Season ${item.nextSeasonNumber}`} progress={item.progress} palette={['#2A2438', '#1F1F26']} onPress={() => router.push({ pathname: '/media/[id]', params: { id: mediaRouteId(item.media), season: String(item.nextEpisode?.seasonNumber ?? item.nextSeasonNumber) } })} />) : <Pressable accessibilityRole="button" accessibilityLabel="Find a series to track" onPress={() => router.push('/search')} style={({ pressed }) => [styles.emptyRow, pressed && styles.pressed]}><View style={styles.emptyIcon}><Ionicons name="play-circle-outline" size={20} color={colors.accent} /></View><View style={styles.emptyCopy}><AppText variant="bodyMedium">Nothing in progress</AppText><AppText variant="caption" muted numberOfLines={1}>Track a series to pick up here</AppText></View><Ionicons name="chevron-forward" size={18} color={colors.accent} /></Pressable>}
    </View>
    </FadeInView>

    <FadeInView delay={160}>
    <View style={styles.section}>
      <View style={styles.rowHeader}>
        <SectionHeader title="New Releases" />
        <Pressable accessibilityRole="button" accessibilityLabel="See all new releases" onPress={() => router.push('/new-releases')} style={styles.seeAll}><AppText variant="label" style={styles.seeAllText}>See all</AppText><Ionicons name="chevron-forward" size={15} color={colors.accent} /></Pressable>
      </View>
      {recentQuery.isLoading ? <View style={styles.skeletonRow}>{[0, 1, 2, 3].map((index) => <PosterSkeleton key={index} />)}</View>
        : recentQuery.isError ? <ErrorView message="Couldn't load new releases." onRetry={() => void recentQuery.refetch()} />
        : (recentQuery.data ?? []).length ? <FlatList horizontal data={(recentQuery.data ?? []).slice(0, 6)} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel} renderItem={({ item }) =>
          <PosterCard title={item.title} subtitle={subtitleFor(item)} posterUri={item.posterUrl} onPress={() => openMedia(mediaRouteId(item))} />
        } />
        : null}
    </View>
    </FadeInView>

    <FadeInView delay={220}>
    <View style={styles.section}>
      <View style={styles.rowHeader}>
        <SectionHeader title="Top 100" subtitle="IMDb's highest-rated of all time" />
        <Pressable accessibilityRole="button" accessibilityLabel="See all top 100" onPress={() => router.push('/top-100')} style={styles.seeAll}><AppText variant="label" style={styles.seeAllText}>See all</AppText><Ionicons name="chevron-forward" size={15} color={colors.accent} /></Pressable>
      </View>
      {topLoading ? <View style={styles.skeletonRow}>{[0, 1, 2, 3].map((index) => <PosterSkeleton key={index} />)}</View>
        : topFailed ? <ErrorView message="Couldn't load the top 100." onRetry={refetchTop} />
        : topItems.length ? <FlatList horizontal data={topItems} keyExtractor={(item) => `${item.mediaType}:${item.tmdbId}`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel} renderItem={({ item, index }) =>
          <PosterCard title={item.title} subtitle={`IMDb ★ ${item.rating.toFixed(1)}${item.year ? ` · ${item.year}` : ''}`} posterUri={item.posterUrl} badge={`#${index + 1}`} onPress={() => openMedia(`tmdb:${item.mediaType}:${item.tmdbId}`)} />
        } />
        : null}
    </View>
    </FadeInView>

    <FadeInView delay={280}>
    <View style={styles.section}>
      <View style={styles.rowHeader}>
        <SectionHeader title="Genres" subtitle="Movies, shows, and anime by vibe" />
        <Pressable accessibilityRole="button" accessibilityLabel="See all genres" onPress={() => router.push('/genres' as never)} style={styles.seeAll}><AppText variant="label" style={styles.seeAllText}>See all</AppText><Ionicons name="chevron-forward" size={15} color={colors.accent} /></Pressable>
      </View>
      <FlatList horizontal data={GENRES} keyExtractor={(entry) => entry.slug} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel} renderItem={({ item }) =>
        <GenreCard
          name={item.name}
          gradient={item.gradient}
          width={200}
          onPress={() => router.push({ pathname: '/genre/[id]', params: { id: String(item.id) } } as never)}
        />
      } />
    </View>
    </FadeInView>

    <FadeInView delay={340}>
    <View style={styles.section}>
      <View style={styles.rowHeader}>
        <SectionHeader title="Franchises" subtitle="Movie & show universes, in order" />
        <Pressable accessibilityRole="button" accessibilityLabel="See all franchise collections" onPress={() => router.push('/franchises' as never)} style={styles.seeAll}><AppText variant="label" style={styles.seeAllText}>See all</AppText><Ionicons name="chevron-forward" size={15} color={colors.accent} /></Pressable>
      </View>
      <FlatList horizontal data={homeFranchises} keyExtractor={(entry) => entry.slug} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel} renderItem={({ item }) =>
        <FranchiseCard
          title={item.title}
          itemCount={item.items.length}
          backdropUri={item.backdropPath ? `https://image.tmdb.org/t/p/w780${item.backdropPath}` : undefined}
          width={200}
          onPress={() => router.push({ pathname: '/franchise/[slug]', params: { slug: item.slug } } as never)}
        />
      } />
    </View>
    </FadeInView>
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.lg },
  heroCopy: { gap: spacing.xs },
  eyebrow: { color: colors.accent, letterSpacing: 2 },
  title: { color: colors.white },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, alignItems: 'flex-start' },
  pressed: { opacity: 0.85 },
  section: { marginBottom: spacing.lg },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: spacing.sm, minHeight: 40, paddingLeft: spacing.md },
  seeAllText: { color: colors.accent },
  emptyCard: { minHeight: 160, borderRadius: radius.card, backgroundColor: colors.surface, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, paddingRight: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, marginBottom: spacing.sm },
  emptyIcon: { width: 52, height: 52, borderRadius: radius.small, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  emptyCopy: { flex: 1, gap: 2 },
  skeletonRow: { flexDirection: 'row', gap: spacing.md, overflow: 'hidden' },
  carousel: { gap: spacing.md, paddingRight: spacing.xl },
});
