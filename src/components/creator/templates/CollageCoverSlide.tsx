import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlidePoster, SlideText } from '../primitives';

const TILE_WIDTH = 118;
const TILE_HEIGHT = 164;

/** Fanned-deck positions: computed from the tile count so any 1–5 reads intentional. */
function tileStyle(index: number, count: number) {
  if (count <= 1) {
    return { left: (360 - TILE_WIDTH) / 2, top: 22, transform: [{ rotate: '-4deg' }] };
  }
  const step = (360 - 12 - TILE_WIDTH) / (count - 1);
  return {
    left: 6 + index * step,
    top: 18 + (index % 2) * 16,
    transform: [{ rotate: `${-10 + index * (24 / (count - 1))}deg` }],
  };
}

/**
 * Carousel cover: a fanned poster deck up top with a giant stacked headline
 * burning through the scrim below. The `closing` line doubles as the swipe
 * cue ("Swipe for the full list →"); clear it for a standalone cover post.
 */
export function CollageCoverSlide({ slide, palette, showBranding, branding }: {
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
  branding: CreatorBranding;
}) {
  const refs = slide.titleRefs.slice(0, 5);
  const headline = slide.headline.trim() || 'MOST ICONIC PICKS';
  const subtitle = slide.subtitle.trim();
  const closing = slide.closing.trim();
  return (
    <View style={styles.root}>
      <View style={styles.collage} pointerEvents="none">
        {refs.length ? refs.map((ref, index) => (
          <View
            key={`${ref.provider}:${ref.mediaType}:${ref.providerId}`}
            style={[styles.tile, tileStyle(index, refs.length), { borderColor: palette.surfaceBorder }]}
          >
            <SlidePoster uri={ref.posterUrl} title={ref.title} radius={12} style={StyleSheet.absoluteFill} />
          </View>
        )) : (
          <View style={[styles.placeholder, { borderColor: palette.surfaceBorder, backgroundColor: palette.surface }]}>
            <Ionicons name="images-outline" size={20} color={palette.textMuted} />
            <SlideText style={[styles.placeholderText, { color: palette.textMuted }]}>Add up to 5 posters to build the collage</SlideText>
          </View>
        )}
      </View>
      <LinearGradient
        colors={[...palette.scrim]}
        locations={[0, 0.45, 0.8, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.scrim}
        pointerEvents="none"
      />
      {showBranding ? <BrandMark palette={palette} label={branding.name} style={styles.brand} /> : null}
      <View style={styles.content}>
        <SlideText style={[styles.headline, { color: palette.text }]} numberOfLines={3} adjustsFontSizeToFit>{headline}</SlideText>
        {subtitle ? <SlideText style={[styles.subtitle, { color: palette.textSecondary }]} numberOfLines={2}>{subtitle}</SlideText> : null}
        {closing ? (
          <View style={styles.cueRow}>
            <SlideText style={[styles.cue, { color: palette.accent.primary }]} numberOfLines={1}>{closing.toUpperCase()}</SlideText>
            <Ionicons name="arrow-forward" size={12} color={palette.accent.primary} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  collage: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },
  tile: { position: 'absolute', width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 14, borderWidth: 1, overflow: 'hidden', backgroundColor: '#241F36' },
  placeholder: { position: 'absolute', left: 40, right: 40, top: 40, height: 172, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  placeholderText: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 96, bottom: 0 },
  brand: { position: 'absolute', top: 16, left: 18 },
  content: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  headline: { fontSize: 30, lineHeight: 31, fontWeight: '900', letterSpacing: 0.6 },
  subtitle: { fontSize: 12, lineHeight: 16, marginTop: 6, fontWeight: '500' },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  cue: { fontSize: 10.5, lineHeight: 13, fontWeight: '800', letterSpacing: 1.6 },
});
