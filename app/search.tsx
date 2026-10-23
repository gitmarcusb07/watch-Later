import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { openURL } from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { IconButton } from '@/components/buttons/IconButton';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { EmptyState, ErrorView, SearchResultSkeleton } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { CustomEntryDialog } from '@/components/media/CustomEntryDialog';
import { SearchResultCard } from '@/components/media/SearchResultCard';
import { ExploreGenreTile } from '@/components/search/ExploreGenreTile';
import { prefetchMedia, useCatalogSearch, useTrending } from '@/features/catalog/hooks';
import { CatalogError } from '@/domain/errors/CatalogError';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { genreById } from '@/features/genres/catalog';
import type { CatalogFilter } from '@/domain/models/media';
import { useCreateCustomEntry, useLibraryStatuses, useWatchedLibrary, useWatchlist } from '@/features/watchState/hooks';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { triggerLightHaptic } from '@/lib/haptics';
import { suggestCorrection } from '@/lib/localSearch';
import { colors, radius, spacing, typography } from '@/theme';

const filters: { label: string; value: CatalogFilter }[] = [
  { label: 'All', value: 'all' }, { label: 'Movies', value: 'movies' },
  { label: 'Shows', value: 'series' }, { label: 'Anime', value: 'anime' },
  { label: 'Upcoming', value: 'upcoming' },
];

const suggestions = ['Dune', 'Breaking Bad', 'Spirited Away', 'The Batman'];

const THEMES: { label: string; genreId: number; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Mind-bending', genreId: 9648, icon: 'eye-outline' },
  { label: 'Feel-good', genreId: 35, icon: 'happy-outline' },
  { label: 'Dark & gritty', genreId: 80, icon: 'skull-outline' },
  { label: 'Epic worlds', genreId: 14, icon: 'planet-outline' },
  { label: 'True stories', genreId: 99, icon: 'book-outline' },
  { label: 'Anime essentials', genreId: 16, icon: 'sparkles-outline' },
  { label: 'Date night', genreId: 10749, icon: 'heart-outline' },
  { label: 'Adrenaline', genreId: 28, icon: 'flash-outline' },
];

const CATEGORY_IDS = [28, 10749, 27, 35, 878, 14, 9648, 16, 53];

const CATEGORIES = CATEGORY_IDS.flatMap((id) => {
  const genre = genreById(id);
  if (!genre) return [];
  return [{ ...genre, displayName: genre.name === 'Science Fiction' ? 'Sci-Fi' : genre.name }];
});

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const normalized = query.trim();
  const search = useCatalogSearch(debouncedQuery, filter, Boolean(normalized && normalized === debouncedQuery));
  const libraryStatuses = useLibraryStatuses(search.data?.items ?? []);
  const createCustomEntry = useCreateCustomEntry();
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const trendingTitles = useTrending();
  const watchlistTitles = useWatchlist();
  const watchedTitles = useWatchedLibrary();
  const didYouMean = useMemo(() => {
    if (!debouncedQuery || search.data?.items.length || search.isLoading) return undefined;
    const corpus = [
      ...((trendingTitles.data ?? []).map((item) => item.title)),
      ...((watchlistTitles.data ?? []).map(({ media }) => media.title)),
      ...((watchedTitles.data ?? []).map((entry) => entry.kind === 'movie' ? entry.media.title : entry.progress.media.title)),
    ];
    return suggestCorrection(debouncedQuery, corpus);
  }, [debouncedQuery, search.data, search.isLoading, trendingTitles.data, watchlistTitles.data, watchedTitles.data]);
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }, []);
  const searching = Boolean(normalized) && (normalized !== debouncedQuery || search.isLoading);
  const openResult = (id: string) => { Keyboard.dismiss(); prefetchMedia(id); router.push({ pathname: '/media/[id]', params: { id } }); };
  const openGenre = (genreId: number) => { Keyboard.dismiss(); router.push({ pathname: '/genre/[id]', params: { id: String(genreId) } }); };
  const changeQuery = (value: string) => {
    setQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const next = value.trim();
    if (!next) { setDebouncedQuery(''); return; }
    if (next !== debouncedQuery) setDebouncedQuery('');
    debounceTimer.current = setTimeout(() => setDebouncedQuery(next), 320);
  };
  const categoryImages = useMemo(() => {
    const images: Record<number, string | undefined> = {};
    for (const category of CATEGORIES) {
      const match = (trendingTitles.data ?? []).find((item) =>
        item.genres.some((genre) => genre.id === category.id || genre.name.toLowerCase() === category.name.toLowerCase()),
      );
      images[category.id] = match?.backdropUrl ?? match?.posterUrl;
    }
    return images;
  }, [trendingTitles.data]);
  const errorMessage = search.error instanceof CatalogError ? search.error.userMessage : 'Could not load catalog results. Check your connection and try again.';
  const resultCount = search.data?.items.length ?? 0;

  return <Screen scroll>
    <FadeInView>
      <View style={styles.topRow}>
        <IconButton name="arrow-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={styles.header}>
          <AppText variant="caption" style={styles.eyebrow}>SEARCH</AppText>
          <AppText style={styles.heroTitle}>Find your next{'\n'}obsession.</AppText>
          <AppText variant="bodySmall" muted style={styles.heroSubtitle}>What are you in the mood for?</AppText>
        </View>
      </View>
    </FadeInView>
    <View style={styles.searchArea}>
      <View style={[styles.inputWrap, normalized.length > 0 && styles.inputFilled]}>
        <Ionicons name="search" size={22} color={normalized.length > 0 ? colors.accent : colors.textMuted} />
        <TextInput accessibilityLabel="Search movies, shows and anime" placeholder="Search titles, genres, people…" placeholderTextColor={colors.textMuted} value={query} onChangeText={changeQuery} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} maxLength={120} style={styles.input} selectionColor={colors.accent} />
        {query.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => changeQuery('')} hitSlop={12}><Ionicons name="close-circle" size={20} color={colors.textSecondary} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
        {filters.map((item) => {
          const selected = item.value === filter;
          return <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { if (!selected) triggerLightHaptic(); setFilter(item.value); }} style={[styles.filter, selected && styles.filterActive]}><AppText variant="label" style={selected ? styles.filterTextActive : styles.filterText}>{item.label}</AppText></Pressable>;
        })}
      </ScrollView>
    </View>
    {!normalized ? <View style={styles.explore}>
      <FadeInView delay={80}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <AppText style={styles.sectionKicker}>EXPLORE BY THEME</AppText>
            <AppText variant="heading3">Start with a feeling</AppText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Browse all genres" onPress={() => { triggerLightHaptic(); router.push('/genres'); }} hitSlop={10}><AppText variant="caption" style={styles.seeAll}>See all</AppText></Pressable>
        </View>
        <View style={styles.themeWrap}>
          {THEMES.map((theme) => (
            <Pressable key={theme.label} accessibilityRole="button" accessibilityLabel={`Explore ${theme.label} titles`} onPress={() => openGenre(theme.genreId)} style={({ pressed }) => [styles.themeChip, pressed && styles.pressed]}>
              <Ionicons name={theme.icon} size={15} color={colors.accent} />
              <AppText variant="label" style={styles.themeLabel}>{theme.label}</AppText>
            </Pressable>
          ))}
        </View>
      </FadeInView>

      <FadeInView delay={140}>
        <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
          <View style={styles.sectionHeaderCopy}>
            <AppText style={styles.sectionKicker}>EXPLORE POPULAR CATEGORIES</AppText>
            <AppText variant="heading3">Go straight to a shelf</AppText>
          </View>
        </View>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((category) => (
            <ExploreGenreTile
              key={category.id}
              name={category.displayName}
              imageUrl={categoryImages[category.id]}
              gradient={category.gradient}
              onPress={() => openGenre(category.id)}
              style={styles.categoryTile}
            />
          ))}
        </View>
      </FadeInView>

      <FadeInView delay={200}>
        <Pressable accessibilityRole="button" accessibilityLabel="Browse new releases and upcoming titles" onPress={() => { triggerLightHaptic(); router.push('/browse'); }} style={({ pressed }) => [styles.browseCard, pressed && styles.pressed]}>
          <View style={styles.browseIcon}><Ionicons name="compass-outline" size={24} color={colors.accent} /></View>
          <View style={styles.browseCopy}>
            <AppText style={styles.browseKicker}>BROWSE 2026</AppText>
            <AppText variant="heading3" style={styles.browseTitle}>New releases and upcoming drops</AppText>
            <AppText variant="caption" muted>Trending now, fresh releases, and what’s coming next.</AppText>
          </View>
          <View style={styles.browseArrow}><Ionicons name="arrow-forward" size={17} color={colors.white} /></View>
        </Pressable>
      </FadeInView>

      <FadeInView delay={260}>
        <View style={styles.suggestBlock}>
          <AppText style={styles.sectionKicker}>POPULAR SEARCHES</AppText>
          <View style={styles.suggestRow}>{suggestions.map((suggestion) => <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={`Search for ${suggestion}`} onPress={() => changeQuery(suggestion)} style={styles.suggestChip}><Ionicons name="sparkles-outline" size={14} color={colors.accent} /><AppText variant="label" style={styles.suggestText}>{suggestion}</AppText></Pressable>)}</View>
        </View>
      </FadeInView>
    </View>
      : searching && !search.data?.items.length ? <View style={styles.results}><AppText variant="heading3" style={styles.resultTitle}>Searching the catalog</AppText>{[0, 1, 2].map((index) => <SearchResultSkeleton key={index} />)}</View>
      : search.isError && !search.data?.items.length ? <View style={styles.error}><ErrorView message={errorMessage} onRetry={() => void search.refetch()} /></View>
      : !search.data?.items.length ? <View style={styles.empty}><EmptyState icon="search-outline" title="No results found" message={`Nothing matched “${debouncedQuery}”. Try another title or add it as a custom entry.`} actionLabel="Clear search" onAction={() => changeQuery('')} />{didYouMean ? <AppButton variant="text" label={`Did you mean “${didYouMean}”?`} onPress={() => changeQuery(didYouMean)} /> : null}<AppButton variant="text" label="Can't find it? Add a custom entry" onPress={() => setCustomEntryOpen(true)} /><AppButton variant="text" label="Report a missing title" onPress={() => void openURL(`https://thetvdb.com/search?query=${encodeURIComponent(debouncedQuery)}`)} /></View>
      : <View style={styles.results}>
        <View style={styles.resultHeader}><AppText style={styles.sectionKicker}>RESULTS</AppText><AppText variant="heading3">{resultCount} {resultCount === 1 ? 'result' : 'results'}</AppText><AppText variant="caption" muted>Tap + for watchlist · ✓ for watched</AppText></View>
        {search.isError ? <Pressable accessibilityRole="button" accessibilityLabel="Reconnect and refresh results" onPress={() => void search.refetch()} style={styles.staleBanner}><AppText variant="caption" muted>Showing saved results — tap to refresh.</AppText></Pressable> : null}
        {search.data.unavailableProviders.length ? <AppText variant="caption" muted style={styles.partial}>Some results are temporarily unavailable.</AppText> : null}
        <View style={styles.resultCard}>{search.data.items.map((item) => <SearchResultCard key={item.id} media={item} status={libraryStatuses.data?.[item.id]} onPress={() => openResult(mediaRouteId(item))} />)}</View>
      </View>}
    {customEntryOpen ? <CustomEntryDialog visible={customEntryOpen} initialTitle={debouncedQuery} onClose={() => setCustomEntryOpen(false)} onSave={(input) => createCustomEntry.mutate(input, {
      onSuccess: (media) => { setCustomEntryOpen(false); showToast('Custom entry added to your watchlist', 'success'); openResult(mediaRouteId(media)); },
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t add your entry', message: friendlyErrorMessage(error) }),
    })} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  header: { flex: 1, gap: 2 },
  eyebrow: { color: colors.accent, letterSpacing: 2.2, fontWeight: '700' },
  heroTitle: { color: colors.white, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.9 },
  heroSubtitle: { marginTop: spacing.xs },
  searchArea: { paddingBottom: spacing.sm },
  inputWrap: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.sm },
  inputFilled: { borderColor: colors.accent, backgroundColor: colors.surface },
  input: { flex: 1, color: colors.textPrimary, ...typography.body, fontSize: 16 },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.lg, paddingRight: spacing.sm },
  filter: { alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.white },
  explore: { paddingTop: spacing.xl, gap: spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  sectionHeaderSpaced: { marginTop: spacing.sm },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  sectionKicker: { color: colors.textMuted, fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 1.8 },
  seeAll: { color: colors.accent, fontWeight: '700' },
  themeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  themeChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  themeLabel: { color: colors.textPrimary, fontSize: 13 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  categoryTile: { width: '31.5%', flexGrow: 1 },
  browseCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg },
  browseIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(168,85,247,0.12)' },
  browseCopy: { flex: 1, gap: 2 },
  browseKicker: { color: colors.accent, fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 1.8 },
  browseTitle: { fontSize: 17, lineHeight: 21 },
  browseArrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  suggestBlock: { gap: spacing.xs },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  suggestText: { color: colors.textPrimary },
  staleBanner: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.medium, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginBottom: spacing.md, alignItems: 'center' },
  error: { minHeight: 360 },
  results: { paddingTop: spacing.lg },
  resultHeader: { gap: spacing.xs, marginBottom: spacing.md },
  resultTitle: { marginBottom: spacing.lg },
  resultCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  partial: { marginBottom: spacing.md },
  empty: { minHeight: 330 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});
