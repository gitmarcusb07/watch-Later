import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { CreatorSlide } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlideChip, SlideKicker, SlidePoster, SlideText, joinMeta, slideTitleOf } from '../primitives';
import { seasonsLabel, spotlightMeta, streamingProviders } from '@/features/creator/slideText';

/**
 * Full-bleed poster spotlight for one movie or one series. The bottom 60% is
 * a scrim carrying the editable copy; missing metadata simply drops its row,
 * and a missing poster falls back to the branded gradient tile.
 */
export function SpotlightSlide({ variant, slide, palette, showBranding }: {
  variant: 'movie' | 'series';
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
}) {
  const ref = slide.titleRefs[0];
  const title = slideTitleOf(ref, variant === 'movie' ? 'Your movie night pick' : 'Your next binge');
  const kindLabel = variant === 'movie' ? 'MOVIE' : ref?.mediaType === 'anime' ? 'ANIME' : 'SERIES';
  const meta = joinMeta([
    variant === 'series' ? seasonsLabel(ref?.seasons) : undefined,
    spotlightMeta(ref, slide),
  ]);
  const providers = streamingProviders(ref, slide);
  return (
    <View style={styles.root}>
      <SlidePoster uri={ref?.posterUrl} title={title} style={StyleSheet.absoluteFill} radius={0} />
      <LinearGradient
        colors={[...palette.scrim]}
        locations={[0, 0.42, 0.78, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.topRow}>
        {ref ? <SlideChip label={kindLabel} palette={palette} /> : null}
      </View>
      <View style={styles.content}>
        <SlideKicker text={slide.headline} palette={palette} />
        <SlideText style={[styles.title, { color: palette.text }]} numberOfLines={2} adjustsFontSizeToFit>{title}</SlideText>
        {slide.subtitle ? <SlideText style={[styles.subtitle, { color: palette.textSecondary }]} numberOfLines={2}>{slide.subtitle}</SlideText> : null}
        {meta ? <SlideText style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
        {slide.description ? <SlideText style={[styles.description, { color: palette.textSecondary }]} numberOfLines={3}>{slide.description}</SlideText> : null}
        {providers ? (
          <View style={styles.providers}>
            <SlideText style={[styles.providersLabel, { color: palette.textMuted }]} numberOfLines={1}>STREAMING ON</SlideText>
            {providers.map((provider) => <SlideChip key={provider} label={provider} palette={palette} />)}
          </View>
        ) : null}
        {slide.closing ? (
          <View style={[styles.closingPill, { backgroundColor: palette.accentSoft }]}>
            <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText>
          </View>
        ) : null}
        {showBranding ? <BrandMark palette={palette} style={styles.brand} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  topRow: { position: 'absolute', top: 18, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between' },
  content: { paddingHorizontal: 20, paddingBottom: 14, gap: 6 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 2 },
  subtitle: { fontSize: 13, lineHeight: 17, fontWeight: '500' },
  meta: { fontSize: 10.5, lineHeight: 13, fontWeight: '600', letterSpacing: 0.3 },
  description: { fontSize: 11.5, lineHeight: 15.5, fontWeight: '400', marginTop: 2 },
  providers: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 2 },
  providersLabel: { fontSize: 8.5, lineHeight: 11, fontWeight: '800', letterSpacing: 1.6 },
  closingPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4.5, marginTop: 4 },
  closing: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4 },
  brand: { marginTop: 6 },
});
