import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlidePoster, SlideText, slideTitleOf } from '../primitives';
import { rowMeta } from '@/features/creator/slideText';

/** Head-to-head: two posters, one "VS" marker, editable closer. */
export function ComparisonSlide({ slide, palette, showBranding, branding }: { slide: CreatorSlide; palette: CreatorPalette; showBranding: boolean; branding: CreatorBranding }) {
  const [left, right] = slide.titleRefs;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{slide.headline.trim() || 'THIS OR THAT'}</SlideText>
        {slide.subtitle ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{slide.subtitle}</SlideText> : null}
      </View>
      <View style={styles.cards}>
        <Card refItem={left} slot={1} slide={slide} palette={palette} />
        <View style={[styles.vs, { backgroundColor: palette.accent.primary }]}>
          <SlideText style={[styles.vsText, { color: palette.accent.ink }]}>VS</SlideText>
        </View>
        <Card refItem={right} slot={2} slide={slide} palette={palette} />
      </View>
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={2}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} label={branding.name} /> : null}
      </View>
    </View>
  );
}

function Card({ refItem, slot, slide, palette }: { refItem: CreatorTitleRef | undefined; slot: number; slide: CreatorSlide; palette: CreatorPalette }) {
  const title = slideTitleOf(refItem, slot === 1 ? 'First movie' : 'Second movie');
  const meta = refItem ? rowMeta(refItem, slide) : undefined;
  return (
    <View style={styles.card}>
      <SlidePoster uri={refItem?.posterUrl} title={title} style={styles.poster} radius={12} />
      <SlideText style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>{title}</SlideText>
      {meta ? <SlideText style={[styles.cardMeta, { color: palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  header: { gap: 3, marginBottom: 12, alignItems: 'center' },
  heading: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: 0.6, textAlign: 'center' },
  subheading: { fontSize: 11, lineHeight: 14, fontWeight: '500', textAlign: 'center' },
  cards: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  card: { flex: 1, maxWidth: 142, gap: 6, alignItems: 'center' },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
  cardTitle: { fontSize: 13, lineHeight: 16, fontWeight: '700', textAlign: 'center' },
  cardMeta: { fontSize: 9.5, lineHeight: 12, fontWeight: '500', textAlign: 'center' },
  vs: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: -30 },
  vsText: { fontSize: 12, lineHeight: 14, fontWeight: '900', letterSpacing: 0.5 },
  footer: { alignItems: 'center', gap: 8, marginTop: 10 },
  closing: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
});
