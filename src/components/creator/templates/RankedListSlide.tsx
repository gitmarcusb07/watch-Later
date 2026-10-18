import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, RankBadge, SlidePoster, SlideText } from '../primitives';
import { rowMeta } from '@/features/creator/slideText';

/**
 * Ranked recommendation list (max five tall rows). Rank markers are the only
 * ordering anywhere in the studio, so a ranked five stays instantly readable
 * on the 4:5 canvas. A carousel of ranked slides numbers continuously:
 * `rankOffset` carries the ranks consumed by earlier slides (07–11, not a
 * restart at 01).
 */
export function RankedListSlide({ slide, palette, showBranding, branding, rankOffset = 0 }: {
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
  branding: CreatorBranding;
  rankOffset?: number;
}) {
  const refs = slide.titleRefs.slice(0, 5);
  const subtitle = slide.subtitle.trim() || (refs.length ? `${refs.length} picks, ranked` : '');
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{slide.headline.trim() || 'MY TOP 5'}</SlideText>
        {subtitle ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{subtitle}</SlideText> : null}
      </View>
      {!refs.length ? (
        <View style={styles.empty}>
          <SlideText style={[styles.emptyText, { color: palette.textMuted }]}>Add titles from your library to build this list</SlideText>
        </View>
      ) : (
        <View style={styles.rows}>
          {refs.map((ref, index) => (
            <TallRow key={`${ref.provider}:${ref.mediaType}:${ref.providerId}`} rank={rankOffset + index + 1} refItem={ref} slide={slide} palette={palette} />
          ))}
        </View>
      )}
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} label={branding.name} /> : null}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, minHeight: 16 },
  closing: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
});
