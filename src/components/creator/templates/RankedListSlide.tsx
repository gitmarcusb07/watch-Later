import { StyleSheet, View } from 'react-native';
import type { CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, RankBadge, SlidePoster, SlideText, joinMeta } from '../primitives';
import { mediaTypeLabel, rowMeta } from '@/features/creator/slideText';

/**
 * Ranked recommendation list. Top 5 renders tall rows with posters; Top 10
 * splits into two compact columns of five so every entry stays legible on the
 * 4:5 canvas.
 */
export function RankedListSlide({ variant, slide, palette, showBranding }: {
  variant: 'top5' | 'top10';
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
}) {
  const compact = variant === 'top10';
  const refs = slide.titleRefs.slice(0, compact ? 10 : 5);
  const subtitle = slide.subtitle.trim() || (refs.length ? `${refs.length} picks, ranked` : '');
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{slide.headline.trim() || (compact ? 'TOP 10' : 'MY TOP 5')}</SlideText>
        {subtitle ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{subtitle}</SlideText> : null}
      </View>
      {!refs.length ? <EmptyHint palette={palette} /> : compact ? (
        <View style={styles.columns}>
          {[refs.slice(0, 5), refs.slice(5, 10)].map((column, columnIndex) => (
            <View key={columnIndex} style={styles.column}>
              {column.map((ref, index) => (
                <CompactRow key={`${ref.provider}:${ref.providerId}`} rank={columnIndex * 5 + index + 1} refItem={ref} slide={slide} palette={palette} />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.rows}>
          {refs.map((ref, index) => (
            <TallRow key={`${ref.provider}:${ref.providerId}`} rank={index + 1} refItem={ref} slide={slide} palette={palette} />
          ))}
        </View>
      )}
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} /> : null}
      </View>
    </View>
  );
}

function TallRow({ rank, refItem, slide, palette }: { rank: number; refItem: CreatorTitleRef; slide: CreatorSlide; palette: CreatorPalette }) {
  const meta = rowMeta(refItem, slide);
  return (
    <View style={styles.tallRow}>
      <RankBadge rank={rank} palette={palette} />
      <SlidePoster uri={refItem.posterUrl} title={refItem.title} style={styles.tallPoster} radius={8} />
      <View style={styles.stack}>
        <SlideText style={[styles.tallTitle, { color: palette.text }]} numberOfLines={2}>{refItem.title}</SlideText>
        {meta ? <SlideText style={[styles.tallMeta, { color: palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
      </View>
    </View>
  );
}

function CompactRow({ rank, refItem, slide, palette }: { rank: number; refItem: CreatorTitleRef; slide: CreatorSlide; palette: CreatorPalette }) {
  const meta = joinMeta([mediaTypeLabel(refItem), rowMeta(refItem, slide, { dateInsteadOfYear: false })]);
  return (
    <View style={styles.compactRow}>
      <RankBadge rank={rank} palette={palette} compact />
      <SlidePoster uri={refItem.posterUrl} title={refItem.title} style={styles.compactPoster} radius={5} />
      <View style={styles.stack}>
        <SlideText style={[styles.compactTitle, { color: palette.text }]} numberOfLines={1}>{refItem.title}</SlideText>
        {meta ? <SlideText style={[styles.compactMeta, { color: palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
      </View>
    </View>
  );
}

function EmptyHint({ palette }: { palette: CreatorPalette }) {
  return (
    <View style={styles.empty}>
      <SlideText style={[styles.emptyText, { color: palette.textMuted }]}>Add titles from your library to build this list</SlideText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  header: { gap: 3, marginBottom: 12 },
  heading: { fontSize: 25, lineHeight: 29, fontWeight: '800', letterSpacing: 0.4 },
  subheading: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  rows: { flex: 1, gap: 7, justifyContent: 'center' },
  tallRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tallPoster: { width: 38, height: 57 },
  stack: { flex: 1, minWidth: 0, gap: 1 },
  tallTitle: { fontSize: 14, lineHeight: 17, fontWeight: '700' },
  tallMeta: { fontSize: 10, lineHeight: 13, fontWeight: '500' },
  columns: { flex: 1, flexDirection: 'row', gap: 10 },
  column: { flex: 1, gap: 7 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactPoster: { width: 25, height: 37.5 },
  compactTitle: { fontSize: 11.5, lineHeight: 14, fontWeight: '700' },
  compactMeta: { fontSize: 9, lineHeight: 11.5, fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, minHeight: 16 },
  closing: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
});
