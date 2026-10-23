import { FlatList, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { EmptyState, ErrorView, PosterSkeleton } from '@/components/feedback/FeedbackViews';
import { PosterCard } from '@/components/media/PosterCard';
import type { HitReportItem } from '@/features/hits/types';
import type { ImdbRating } from '@/data/remote/supabase/imdbRatings';
import { formatCompactCount } from '@/lib/format';
import { spacing } from '@/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-06` → `Aug 6`. Falls back to the raw value when malformed. */
export function formatHitDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return value;
  return `${MONTHS[month - 1]} ${Number(match[3])}`;
}

export function hitSubtitle(item: HitReportItem): string {
  const rating = item.voteAverage == null ? '★ –' : `★ ${item.voteAverage.toFixed(1)}`;
  const votes = item.voteCount == null ? '' : ` (${item.voteCount})`;
  return `${formatHitDate(item.releaseDate)} · ${rating}${votes}`;
}

export function hitMeta(item: HitReportItem, imdb?: ImdbRating): string | undefined {
  const popularity = item.popularity == null ? undefined : `Popularity ${item.popularity.toFixed(1)}`;
  const imdbText = imdb == null ? undefined : `IMDb ★ ${imdb.rating.toFixed(1)}${formatCompactCount(imdb.votes) ? ` (${formatCompactCount(imdb.votes)})` : ''}`;
  return [popularity, imdbText].filter(Boolean).join(' · ') || undefined;
}

interface HitsGridProps {
  items: HitReportItem[];
  loading: boolean;
  loadError: boolean;
  emptyTitle: string;
  emptyMessage: string;
  cardWidth: number;
  /** IMDb scores keyed `mediaType:tmdbId`. Absent scores simply hide. */
  imdbRatings?: Map<string, ImdbRating>;
  onRetry: () => void;
  onOpen: (item: HitReportItem) => void;
}

/** Ranked poster grid with loading skeletons, error+retry, and empty states. Pure presentational. */
export function HitsGrid({ items, loading, loadError, emptyTitle, emptyMessage, cardWidth, imdbRatings, onRetry, onOpen }: HitsGridProps) {

  if (loading && !items.length) {
    return <View accessibilityRole="progressbar" accessibilityLabel="Loading rankings"><FlatList data={[0, 1, 2, 3, 4, 5]} keyExtractor={(item) => String(item)} numColumns={2} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.grid} style={styles.flat} renderItem={() => <PosterSkeleton width={cardWidth} />} showsVerticalScrollIndicator={false} /></View>;
  }
  if (loadError && !items.length) {
    return <ErrorView message="Could not load these rankings. Check your connection and try again." onRetry={onRetry} />;
  }
  if (!items.length) {
    return <EmptyState icon="trophy-outline" title={emptyTitle} message={emptyMessage} />;
  }
  return <FlatList
    data={items}
    keyExtractor={(item) => `${item.mediaType}:${item.tmdbId}`}
    numColumns={2}
    columnWrapperStyle={styles.gridRow}
    contentContainerStyle={styles.grid}
    style={styles.flat}
    showsVerticalScrollIndicator={false}
    renderItem={({ item }) => (
      <PosterCard
        title={item.title}
        subtitle={hitSubtitle(item)}
        meta={hitMeta(item, imdbRatings?.get(`${item.mediaType}:${item.tmdbId}`))}
        badge={`#${item.rank}`}
        posterUri={item.posterPath ?? undefined}
        width={cardWidth}
        onPress={() => onOpen(item)}
      />
    )}
  />;
}

export function HitsFootnote({ text }: { text: string }) {
  return <View style={styles.footnote}><AppText variant="caption" muted style={styles.footnoteText}>{text}</AppText></View>;
}

const styles = StyleSheet.create({
  flat: { flex: 1 },
  grid: { paddingBottom: spacing['2xl'], gap: spacing.md },
  gridRow: { gap: spacing.md },
  footnote: { paddingVertical: spacing.md },
  footnoteText: { textAlign: 'center', lineHeight: 18 },
});
