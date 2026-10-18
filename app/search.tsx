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
import { useCatalogSearch, useTrending } from '@/features/catalog/hooks';
import { CatalogError } from '@/domain/errors/CatalogError';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
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
  const openResult = (id: string) => { Keyboard.dismiss(); router.push({ pathname: '/media/[id]', params: { id } }); };
  const changeQuery = (value: string) => {
    setQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const next = value.trim();
    if (!next) { setDebouncedQuery(''); return; }
    if (next !== debouncedQuery) setDebouncedQuery('');
    debounceTimer.current = setTimeout(() => setDebouncedQuery(next), 320);
  };
  const errorMessage = search.error instanceof CatalogError ? search.error.userMessage : 'Could not load catalog results. Check your connection and try again.';
  const resultCount = search.data?.items.length ?? 0;

  return <Screen scroll>
    <FadeInView>
    <View style={styles.topRow}>
      <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
      <View style={styles.header}>
        <AppText variant="caption" style={styles.eyebrow}>DISCOVER</AppText>
        <AppText variant="heading1" style={styles.title}>Search</AppText>
        <AppText variant="bodySmall" muted>Add movies and shows straight to your watchlist or mark them watched.</AppText>
      </View>
    </View>
    </FadeInView>
    <View style={[styles.inputWrap, normalized.length > 0 && styles.inputFilled]}>
      <Ionicons name="search" size={22} color={normalized.length > 0 ? colors.accent : colors.textMuted} />
      <TextInput accessibilityLabel="Search movies, shows and anime" placeholder="Try a title…" placeholderTextColor={colors.textMuted} value={query} onChangeText={changeQuery} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={styles.input} selectionColor={colors.accent} />
      {query.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => changeQuery('')} hitSlop={12}><Ionicons name="close-circle" size={20} color={colors.textSecondary} /></Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
      {filters.map((item) => {
        const selected = item.value === filter;
        return <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { if (!selected) triggerLightHaptic(); setFilter(item.value); }} style={[styles.filter, selected && styles.filterActive]}><AppText variant="label" style={selected ? styles.filterTextActive : styles.filterText}>{item.label}</AppText></Pressable>;
      })}
    </ScrollView>
    {!normalized ? <View style={styles.empty}><EmptyState icon="search-outline" title="What are you in the mood for?" message="Search the catalog, then tap + to save to your watchlist or ✓ to mark watched." /><View style={styles.suggestRow}>{suggestions.map((suggestion) => <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={`Search for ${suggestion}`} onPress={() => changeQuery(suggestion)} style={styles.suggestChip}><Ionicons name="sparkles-outline" size={14} color={colors.accent} /><AppText variant="label" style={styles.suggestText}>{suggestion}</AppText></Pressable>)}</View></View>
      : searching && !search.data?.items.length ? <View style={styles.results}><AppText variant="heading3" style={styles.resultTitle}>Searching the catalog</AppText>{[0, 1, 2].map((index) => <SearchResultSkeleton key={index} />)}</View>
      : search.isError && !search.data?.items.length ? <View style={styles.error}><ErrorView message={errorMessage} onRetry={() => void search.refetch()} /></View>
      : !search.data?.items.length ? <View style={styles.empty}><EmptyState icon="search-outline" title="No results found" message={`Nothing matched “${debouncedQuery}”. Try another title or add it as a custom entry.`} actionLabel="Clear search" onAction={() => changeQuery('')} />{didYouMean ? <AppButton variant="text" label={`Did you mean “${didYouMean}”?`} onPress={() => changeQuery(didYouMean)} /> : null}<AppButton variant="text" label="Can't find it? Add a custom entry" onPress={() => setCustomEntryOpen(true)} /><AppButton variant="text" label="Report a missing title" onPress={() => void openURL(`https://thetvdb.com/search?query=${encodeURIComponent(debouncedQuery)}`)} /></View>
      : <View style={styles.results}>
        <View style={styles.resultHeader}><AppText variant="heading3">{resultCount} {resultCount === 1 ? 'result' : 'results'}</AppText><AppText variant="caption" muted>Tap + for watchlist · ✓ for watched</AppText></View>
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
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  header: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.accent, letterSpacing: 2 },
  title: { color: colors.white },
  inputWrap: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.md },
  inputFilled: { borderColor: colors.accent },
  input: { flex: 1, color: colors.textPrimary, ...typography.body, fontSize: 17 },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.lg, paddingRight: spacing.sm },
  filter: { alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.white },
  empty: { minHeight: 330 },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  suggestText: { color: colors.textPrimary },
  staleBanner: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.medium, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginBottom: spacing.md, alignItems: 'center' },
  error: { minHeight: 360 },
  results: { paddingTop: spacing.sm },
  resultHeader: { gap: spacing.xs, marginBottom: spacing.md },
  resultTitle: { marginBottom: spacing.lg },
  resultCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  partial: { marginBottom: spacing.md },
});
