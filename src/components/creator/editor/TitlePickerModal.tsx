import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { ErrorView, LoadingView } from '@/components/feedback/FeedbackViews';
import { SegmentedTabs } from '@/components/creator/editor/controls';
import { useCatalogSearch, useTrending } from '@/features/catalog/hooks';
import { titleRefFromMedia } from '@/features/creator/titleRefs';
import { creatorTemplate } from '@/features/creator/templates';
import { formatMaxSlides } from '@/features/creator/validation';
import { creatorTitleKey, type CreatorFormat, type CreatorTemplateId, type CreatorTitleRef } from '@/domain/models/creator';
import { useCustomList, useCustomLists, useWatchlist } from '@/features/watchState/hooks';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Multi-select title picker for the editor. Every source is one of the app's
 * existing cached reads (catalog search, watchlist, custom lists, trending)
 * and only the visible tab is fetched. Selections are snapshotted into
 * `CreatorTitleRef`s on confirm so drafts stay renderable offline.
 */

type PickerTab = 'search' | 'watchlist' | 'lists' | 'picks';

const TABS: { value: PickerTab; label: string }[] = [
  { value: 'search', label: 'Search' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'lists', label: 'Lists' },
  { value: 'picks', label: 'Top picks' },
];

export function TitlePickerModal({ templateId, format, existingKeys, onClose, onConfirm }: {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  /** `creatorTitleKey`s already on the target slide (shown as "On this slide"). */
  existingKeys: string[];
  onClose: () => void;
  onConfirm: (refs: CreatorTitleRef[]) => void;
}) {
  const template = creatorTemplate(templateId);
  const [tab, setTab] = useState<PickerTab>(template.maxTitles > 1 ? 'watchlist' : 'search');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, CreatorTitleRef>>(() => new Map());
  const [activeListId, setActiveListId] = useState<string | undefined>(undefined);
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

  // Only the active tab's source runs; every other hook is disabled.
  const search = useCatalogSearch(debouncedQuery, 'all', tab === 'search');
  const watchlist = useWatchlist(tab === 'watchlist');
  const lists = useCustomLists(tab === 'lists');
  const listDetail = useCustomList(activeListId, tab === 'lists');
  const trending = useTrending(tab === 'picks');

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

  const source = resolveSource({
    tab,
    query,
    debouncedQuery,
    search,
    watchlist,
    lists,
    listDetail,
    trending,
    activeListId,
  });

  const selectedRefs = useMemo(() => [...selected.values()], [selected]);

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
          <FlatList
            horizontal
            data={lists.data}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            style={styles.listChips}
            contentContainerStyle={styles.listChipsContent}
            renderItem={({ item }) => {
              const active = item.id === activeListId;
              return (
                <Pressable
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
            }}
          />
        ) : null}
        <View style={styles.body}>
          <PickerBody source={source} onRetry={source.retry ?? (() => undefined)} onToggle={toggle} selected={selected} existing={existing} />
        </View>
        <View style={styles.footer}>
          <AppText variant="caption" muted>{selected.size ? `${selected.size} selected` : 'Tap titles to select'}</AppText>
          <View style={styles.footerButton}>
            <AppButton
              label={selected.size === 1 ? 'Add 1 title' : `Add ${selected.size} titles`}
              disabled={selected.size === 0}
              onPress={() => onConfirm(selectedRefs)}
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
}

function resolveSource(input: {
  tab: PickerTab;
  query: string;
  debouncedQuery: string;
  search: ReturnType<typeof useCatalogSearch>;
  watchlist: ReturnType<typeof useWatchlist>;
  lists: ReturnType<typeof useCustomLists>;
  listDetail: ReturnType<typeof useCustomList>;
  trending: ReturnType<typeof useTrending>;
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
  if (tab === 'lists') {
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
  const trending = input.trending.data ?? [];
  if (!trending.length && input.trending.isLoading) return { kind: 'loading', rows: [] };
  if (!trending.length && input.trending.isError) return { kind: 'error', message: 'Couldn’t load trending titles. Check your connection and try again.', retry: () => void input.trending.refetch(), rows: [] };
  const rows = trending.map(titleRefFromMedia);
  return rows.length ? { kind: 'rows', rows } : { kind: 'empty', message: 'Trending titles are unavailable right now.', rows: [] };
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
      contentContainerStyle={styles.rowsContent}
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
  const meta = [titleRef.year, titleRef.mediaType === 'movie' ? 'Movie' : titleRef.mediaType === 'series' ? 'Series' : 'Anime', typeof titleRef.rating === 'number' ? `★ ${titleRef.rating.toFixed(1)}` : undefined].filter(Boolean).join(' · ');
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.textPrimary, ...typography.body, fontSize: 15 },
  listChips: { flexGrow: 0, marginBottom: spacing.sm },
  listChipsContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  listChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  listChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(168,85,247,0.12)' },
  body: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { textAlign: 'center', maxWidth: 280, lineHeight: 21 },
  rowsContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
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
