import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { ErrorView, LoadingView } from '@/components/feedback/FeedbackViews';
import { SegmentedTabs } from '@/components/creator/editor/controls';
import { useCatalogSearch, useSuggestionPages } from '@/features/catalog/hooks';
import { GENRES } from '@/features/genres/catalog';
import { enrichTitleRefsWithImdb } from '@/features/creator/imdbEnrichment';
import { titleRefFromMedia } from '@/features/creator/titleRefs';
import { creatorTemplate } from '@/features/creator/templates';
import { formatMaxSlides } from '@/features/creator/validation';
import { creatorTitleKey, type CreatorFormat, type CreatorTemplateId, type CreatorTitleRef } from '@/domain/models/creator';
import type { PagedCatalog, SuggestionIndustry, SuggestionKind, SuggestionSource } from '@/domain/repositories/CatalogRepository';
import { useCustomList, useCustomLists, useWatchlist } from '@/features/watchState/hooks';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Multi-select title picker for the editor. It opens on suggestions, already
 * filled — a ranking source (popular / top rated / flops / new / upcoming)
 * narrowed by combinable filters (type, industry, year, genre) — so picking
 * a title never starts with a blank search box. Search, the watchlist, and
 * custom lists remain one tab away. Everything is one of the app's existing
 * cached reads; selections are snapshotted into `CreatorTitleRef`s on confirm
 * (with a real IMDb score attached when a match exists) so drafts stay fully
 * renderable offline.
 */

type PickerTab = 'suggestions' | 'search' | 'watchlist' | 'lists';

const TABS: { value: PickerTab; label: string }[] = [
  { value: 'suggestions', label: 'Suggestions' },
  { value: 'search', label: 'Search' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'lists', label: 'Lists' },
];

const SOURCES: { value: SuggestionSource; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'popular', label: 'Popular', icon: 'flame-outline' },
  { value: 'top-rated', label: 'Top rated', icon: 'star-outline' },
  { value: 'flops', label: 'Flops', icon: 'thumbs-down-outline' },
  { value: 'new', label: 'New', icon: 'sparkles-outline' },
  { value: 'upcoming', label: 'Upcoming', icon: 'calendar-outline' },
];

const KINDS: { value: SuggestionKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movies', label: 'Movies' },
  { value: 'shows', label: 'Shows' },
  { value: 'anime', label: 'Anime' },
];

const INDUSTRIES: { value: SuggestionIndustry; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hollywood', label: 'Hollywood' },
  { value: 'bollywood', label: 'Bollywood' },
];

const SUGGESTION_COPY: Record<SuggestionSource, { error: string; empty: string }> = {
  popular: { error: 'Couldn’t load what’s popular right now. Check your connection and try again.', empty: 'Popular titles are unavailable right now.' },
  'top-rated': { error: 'Couldn’t load top-rated titles. Check your connection and try again.', empty: 'Top-rated titles are unavailable right now.' },
  flops: { error: 'Couldn’t load the flop shelf. Check your connection and try again.', empty: 'The flop shelf is empty right now.' },
  new: { error: 'Couldn’t load new releases. Check your connection and try again.', empty: 'No fresh releases found right now.' },
  upcoming: { error: 'Couldn’t load upcoming releases. Check your connection and try again.', empty: 'No upcoming releases match these filters.' },
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 14 }, (_, index) => CURRENT_YEAR - index);

export function TitlePickerModal({ templateId, format, existingKeys, onClose, onConfirm }: {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  /** `creatorTitleKey`s already on the target slide (shown as "On this slide"). */
  existingKeys: string[];
  onClose: () => void;
  onConfirm: (refs: CreatorTitleRef[]) => void;
}) {
  const template = creatorTemplate(templateId);
  const [tab, setTab] = useState<PickerTab>('suggestions');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, CreatorTitleRef>>(() => new Map());
  const [activeListId, setActiveListId] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<SuggestionSource>('popular');
  const [kind, setKind] = useState<SuggestionKind>('all');
  const [industry, setIndustry] = useState<SuggestionIndustry>('all');
  const [year, setYear] = useState<number | undefined>(undefined);
  const [genreId, setGenreId] = useState<number | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const existing = useMemo(() => new Set(existingKeys), [existingKeys]);

  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }, []);

  const changeQuery = (value: string) => {
    setQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const next = value.trim();
    if (!next) { setDebouncedQuery(''); return; }
    if (next !== debouncedQuery) setDebouncedQuery('');
    debounceTimer.current = setTimeout(() => setDebouncedQuery(next), 320);
  };

  const onSuggestions = tab === 'suggestions';
  const filters = useMemo(() => ({ source, kind, industry, year, genreId }), [source, kind, industry, year, genreId]);

  // Only the active tab's sources run; every other hook is disabled. The
  // suggestion rail is one paged query carrying the whole filter set, so any
  // combination stays cached and instantly restorable. It is abortable via
  // the query signal when the modal closes.
  const search = useCatalogSearch(debouncedQuery, 'all', tab === 'search');
  const watchlist = useWatchlist(tab === 'watchlist');
  const lists = useCustomLists(tab === 'lists');
  const listDetail = useCustomList(activeListId, tab === 'lists');
  const suggestions = useSuggestionPages(filters, onSuggestions);

  const toggle = (ref: CreatorTitleRef) => {
    const key = creatorTitleKey(ref);
    if (existing.has(key)) return;
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, ref);
      return next;
    });
  };

  // Copy adapts to how narrow the rail is: a filtered rail that comes back
  // empty points at the filters instead of claiming the source itself is empty.
  const suggestionCopy = useMemo(() => {
    const base = SUGGESTION_COPY[source];
    const narrowed = kind !== 'all' || industry !== 'all' || year !== undefined || genreId !== undefined;
    return narrowed
      ? { error: base.error, empty: 'Nothing matches these filters — clear one and try again.' }
      : base;
  }, [source, kind, industry, year, genreId]);

  const pickerSource = useMemo<PickerSource>(() => {
    if (tab === 'suggestions') return pagedSource(suggestions, suggestionCopy);
    return resolveLocalSource({ tab, query, debouncedQuery, search, watchlist, lists, listDetail, activeListId });
  }, [tab, suggestions, suggestionCopy, query, debouncedQuery, search, watchlist, lists, listDetail, activeListId]);

  const selectedRefs = useMemo(() => [...selected.values()], [selected]);

  async function confirmSelection() {
    if (!selectedRefs.length || confirming) return;
    setConfirming(true);
    try {
      // Match real IMDb scores first (never throws, offline-safe) so saved
      // refs carry the score into the draft; TMDb stays the fallback badge.
      const enriched = await enrichTitleRefsWithImdb(selectedRefs);
      onConfirm(enriched);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <AppText variant="heading3" style={styles.headerTitle}>Add titles</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close title picker" onPress={onClose} style={styles.close} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <AppText variant="caption" muted style={styles.hint}>
          {template.name} · up to {template.maxTitles} per slide · {formatMaxSlides(format)} slide{formatMaxSlides(format) === 1 ? '' : 's'} max
        </AppText>
        <View style={styles.tabs}><SegmentedTabs options={TABS} value={tab} onChange={setTab} /></View>
        {tab === 'suggestions' ? (
          <View style={styles.rails}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent} keyboardShouldPersistTaps="handled">
              {SOURCES.map((entry) => {
                const active = source === entry.value;
                return (
                  <Pressable
                    key={entry.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Suggested: ${entry.label}`}
                    onPress={() => { triggerLightHaptic(); setSource(entry.value); }}
                    style={[styles.listChip, active && styles.listChipActive]}
                  >
                    <Ionicons name={entry.icon} size={13} color={active ? colors.accent : colors.textMuted} />
                    <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{entry.label}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent} keyboardShouldPersistTaps="handled">
              <AppText variant="caption" muted style={styles.railLabel}>TYPE</AppText>
              {KINDS.map((entry) => {
                const active = kind === entry.value;
                return (
                  <Pressable
                    key={entry.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Type: ${entry.label}`}
                    onPress={() => {
                      triggerLightHaptic();
                      setKind(entry.value);
                      // Anime carries no Hollywood/Bollywood split — the
                      // industry filter resets visibly so nothing stays
                      // hidden behind a disabled chip.
                      if (entry.value === 'anime') setIndustry('all');
                    }}
                    style={[styles.yearChip, active && styles.listChipActive]}
                  >
                    <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{entry.label}</AppText>
                  </Pressable>
                );
              })}
              <View style={styles.railDivider} />
              <AppText variant="caption" muted style={styles.railLabel}>INDUSTRY</AppText>
              {INDUSTRIES.map((entry) => {
                const disabled = kind === 'anime';
                const active = !disabled && industry === entry.value;
                return (
                  <Pressable
                    key={entry.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active, disabled }}
                    accessibilityLabel={`Industry: ${entry.label}${disabled ? ', unavailable for anime' : ''}`}
                    disabled={disabled}
                    onPress={() => { triggerLightHaptic(); setIndustry(entry.value); }}
                    style={[styles.yearChip, active && styles.listChipActive, disabled && styles.chipDisabled]}
                  >
                    <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{entry.label}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent} keyboardShouldPersistTaps="handled">
              <AppText variant="caption" muted style={styles.railLabel}>YEAR</AppText>
              {[{ value: undefined as number | undefined, label: 'Any' }, ...YEARS.map((value) => ({ value: value as number | undefined, label: String(value) }))].map((entry) => {
                const active = year === entry.value;
                return (
                  <Pressable
                    key={entry.label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={entry.value === undefined ? 'Year: any' : `Year ${entry.value}`}
                    onPress={() => { triggerLightHaptic(); setYear(active && entry.value !== undefined ? undefined : entry.value); }}
                    style={[styles.yearChip, active && styles.listChipActive]}
                  >
                    <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{entry.label}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent} keyboardShouldPersistTaps="handled">
              <AppText variant="caption" muted style={styles.railLabel}>GENRE</AppText>
              {[{ value: undefined as number | undefined, label: 'Any' }, ...GENRES.map((genre) => ({ value: genre.id as number | undefined, label: genre.name }))].map((entry) => {
                const active = genreId === entry.value;
                return (
                  <Pressable
                    key={entry.label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={entry.value === undefined ? 'Genre: any' : `Genre ${entry.label}`}
                    onPress={() => { triggerLightHaptic(); setGenreId(active && entry.value !== undefined ? undefined : entry.value); }}
                    style={[styles.yearChip, active && styles.listChipActive]}
                  >
                    <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{entry.label}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        {tab === 'search' ? (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={19} color={query ? colors.accent : colors.textMuted} />
            <TextInput
              accessibilityLabel="Search the catalog"
              placeholder="Search movies, shows and anime…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={changeQuery}
              autoFocus
              returnKeyType="search"
              selectionColor={colors.accent}
              style={styles.searchInput}
            />
            {query.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => changeQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={19} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {tab === 'lists' && lists.data?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.listChips} contentContainerStyle={styles.listChipsContent} keyboardShouldPersistTaps="handled">
            {lists.data.map((item) => {
              const active = item.id === activeListId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${item.name}, ${item.itemCount} titles`}
                  onPress={() => { triggerLightHaptic(); setActiveListId(item.id); }}
                  style={[styles.listChip, active && styles.listChipActive]}
                >
                  <Ionicons name={active ? 'bookmark' : 'bookmark-outline'} size={13} color={active ? colors.accent : colors.textMuted} />
                  <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{item.name}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <View style={styles.body}>
          <PickerBody source={pickerSource} onRetry={pickerSource.retry ?? (() => undefined)} onToggle={toggle} selected={selected} existing={existing} />
        </View>
        <View style={styles.footer}>
          <AppText variant="caption" muted>{confirming ? 'Matching IMDb scores…' : selected.size ? `${selected.size} selected` : 'Tap titles to select'}</AppText>
          <View style={styles.footerButton}>
            <AppButton
              label={selected.size === 1 ? 'Add 1 title' : `Add ${selected.size} titles`}
              disabled={selected.size === 0}
              loading={confirming}
              onPress={() => void confirmSelection()}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

interface PickerSource {
  kind: 'loading' | 'error' | 'empty' | 'rows';
  message?: string;
  retry?: () => void;
  rows: CreatorTitleRef[];
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/** Infinite-query shape shared by every paged suggestion rail. */
interface PagedQuery {
  data?: { pages: readonly PagedCatalog[] };
  isLoading: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
}

/** Flattens paged rows, dropping repeats that appeared on an earlier page. */
function refsFromPages(pages: readonly PagedCatalog[]): CreatorTitleRef[] {
  const seen = new Set<string>();
  const rows: CreatorTitleRef[] = [];
  for (const page of pages) {
    for (const media of page.items) {
      const ref = titleRefFromMedia(media);
      const key = creatorTitleKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(ref);
    }
  }
  return rows;
}

function pagedSource(query: PagedQuery, copy: { error: string; empty: string }): PickerSource {
  const rows = refsFromPages(query.data?.pages ?? []);
  if (!rows.length && query.isLoading) return { kind: 'loading', rows: [] };
  if (!rows.length && query.isError) return { kind: 'error', message: copy.error, retry: () => void query.refetch(), rows: [] };
  if (!rows.length) return { kind: 'empty', message: copy.empty, rows: [] };
  return {
    kind: 'rows',
    rows,
    loadingMore: query.isFetchingNextPage,
    onLoadMore: query.hasNextPage && !query.isFetchingNextPage ? () => void query.fetchNextPage() : undefined,
  };
}

function resolveLocalSource(input: {
  tab: PickerTab;
  query: string;
  debouncedQuery: string;
  search: ReturnType<typeof useCatalogSearch>;
  watchlist: ReturnType<typeof useWatchlist>;
  lists: ReturnType<typeof useCustomLists>;
  listDetail: ReturnType<typeof useCustomList>;
  activeListId: string | undefined;
}): PickerSource {
  const { tab } = input;
  if (tab === 'search') {
    if (!input.query.trim()) return { kind: 'empty', message: 'Type a title to search the catalog.', rows: [] };
    const items = input.search.data?.items ?? [];
    // Still inside the debounce window: show a spinner instead of claiming
    // "nothing matched" before the request has even started.
    if (!items.length && input.query.trim() !== input.debouncedQuery) return { kind: 'loading', rows: [] };
    if (!items.length && input.search.isLoading) return { kind: 'loading', rows: [] };
    if (!items.length && input.search.isError) return { kind: 'error', message: 'Couldn’t search the catalog. Check your connection and try again.', retry: () => void input.search.refetch(), rows: [] };
    if (!items.length) return { kind: 'empty', message: `Nothing matched “${input.query.trim()}”. Try another title.`, rows: [] };
    return { kind: 'rows', rows: items.map(titleRefFromMedia) };
  }
  if (tab === 'watchlist') {
    const entries = input.watchlist.data ?? [];
    if (!entries.length && input.watchlist.isLoading) return { kind: 'loading', rows: [] };
    if (!entries.length && input.watchlist.isError) return { kind: 'error', message: 'Couldn’t read your watchlist. Please try again.', retry: () => void input.watchlist.refetch(), rows: [] };
    const rows = entries.map((entry) => titleRefFromMedia(entry.media));
    return rows.length ? { kind: 'rows', rows } : { kind: 'empty', message: 'Your watchlist is empty. Save titles from Search and they can join a post.', rows: [] };
  }
  const lists = input.lists.data ?? [];
  if (!lists.length && input.lists.isLoading) return { kind: 'loading', rows: [] };
  if (!lists.length && input.lists.isError) return { kind: 'error', message: 'Couldn’t read your lists. Please try again.', retry: () => void input.lists.refetch(), rows: [] };
  if (!lists.length) return { kind: 'empty', message: 'You haven’t made any lists yet. Create one from the Watchlist tab’s “New list”.', rows: [] };
  if (!input.activeListId) return { kind: 'empty', message: 'Pick a list above to browse its titles.', rows: [] };
  const detail = input.listDetail.data;
  if (!detail && input.listDetail.isLoading) return { kind: 'loading', rows: [] };
  if (!detail) return { kind: 'error', message: 'Couldn’t open that list. Please try again.', retry: () => void input.listDetail.refetch(), rows: [] };
  const rows = detail.items.map((item) => titleRefFromMedia(item.media));
  return rows.length ? { kind: 'rows', rows } : { kind: 'empty', message: 'This list has no titles yet.', rows: [] };
}

function PickerBody({ source, selected, existing, onToggle, onRetry }: {
  source: PickerSource;
  selected: Map<string, CreatorTitleRef>;
  existing: Set<string>;
  onToggle: (ref: CreatorTitleRef) => void;
  onRetry: () => void;
}) {
  if (source.kind === 'loading') return <LoadingView label="Loading titles" />;
  if (source.kind === 'error') return <ErrorView message={source.message ?? 'Something went wrong.'} onRetry={onRetry} />;
  if (source.kind === 'empty') {
    return (
      <View style={styles.empty}>
        <Ionicons name="albums-outline" size={26} color={colors.textMuted} />
        <AppText variant="bodySmall" muted style={styles.emptyText}>{source.message}</AppText>
      </View>
    );
  }
  return (
    <FlatList
      data={source.rows}
      keyExtractor={(item) => creatorTitleKey(item)}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onEndReached={source.onLoadMore}
      onEndReachedThreshold={0.6}
      contentContainerStyle={styles.rowsContent}
      ListFooterComponent={source.loadingMore ? <View style={styles.more}><ActivityIndicator color={colors.accent} /></View> : null}
      renderItem={({ item }) => (
        <PickerRow titleRef={item} selected={selected.has(creatorTitleKey(item))} onSlide={existing.has(creatorTitleKey(item))} onToggle={() => { triggerLightHaptic(); onToggle(item); }} />
      )}
    />
  );
}

function PickerRow({ titleRef, selected, onSlide, onToggle }: {
  titleRef: CreatorTitleRef;
  selected: boolean;
  onSlide: boolean;
  onToggle: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const score = typeof titleRef.imdbRating === 'number' && titleRef.imdbRating > 0
    ? `IMDb ${titleRef.imdbRating.toFixed(1)}`
    : typeof titleRef.rating === 'number' && titleRef.rating > 0 ? `★ ${titleRef.rating.toFixed(1)}` : undefined;
  const meta = [titleRef.year, titleRef.mediaType === 'movie' ? 'Movie' : titleRef.mediaType === 'series' ? 'Series' : 'Anime', score].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: onSlide }}
      accessibilityLabel={`${titleRef.title}${titleRef.year ? `, ${titleRef.year}` : ''}${onSlide ? ', already on this slide' : ''}`}
      disabled={onSlide}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, onSlide && styles.rowDisabled]}
    >
      <View style={styles.poster}>
        {titleRef.posterUrl && !failed
          ? <Image source={{ uri: titleRef.posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
          : <View style={[StyleSheet.absoluteFill, styles.posterFallback]}><Ionicons name="film-outline" size={16} color="rgba(255,255,255,0.65)" /></View>}
      </View>
      <View style={styles.rowCopy}>
        <AppText variant="bodyMedium" numberOfLines={1}>{titleRef.title}</AppText>
        <AppText variant="caption" muted numberOfLines={1}>{meta || 'Metadata unavailable'}</AppText>
      </View>
      {onSlide
        ? <AppText variant="caption" muted>On slide</AppText>
        : <View style={[styles.check, selected && styles.checkOn]}>
          {selected ? <Ionicons name="checkmark" size={15} color={colors.background} /> : null}
        </View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  headerTitle: { flex: 1 },
  close: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs },
  tabs: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  rails: { gap: spacing.xs, paddingBottom: spacing.sm },
  railContent: { paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: 'center' },
  railLabel: { letterSpacing: 1, marginRight: spacing.xs },
  yearChip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipDisabled: { opacity: 0.4 },
  railDivider: { width: 1, alignSelf: 'stretch', marginVertical: 3, backgroundColor: colors.border, marginHorizontal: 2 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.textPrimary, ...typography.body, fontSize: 15 },
  listChips: { flexGrow: 0, marginBottom: spacing.sm },
  listChipsContent: { paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: 'center' },
  listChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  listChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(168,85,247,0.12)' },
  body: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { textAlign: 'center', maxWidth: 280, lineHeight: 21 },
  rowsContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  more: { paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.75 },
  rowDisabled: { opacity: 0.45 },
  poster: { width: 44, height: 62, borderRadius: radius.small, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  posterFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2547' },
  rowCopy: { flex: 1, gap: 2 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  footerButton: { flex: 1, maxWidth: 220 },
});
