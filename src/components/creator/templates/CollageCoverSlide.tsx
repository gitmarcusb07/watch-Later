import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
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

/** "3 MOVIES · 2 SHOWS" — counted from the refs actually fanned on the cover. */
function refsMix(refs: readonly CreatorTitleRef[]): string | undefined {
  const counts = { movie: 0, series: 0, anime: 0 };
  for (const ref of refs) counts[ref.mediaType] += 1;
  const parts: string[] = [];
  if (counts.movie) parts.push(`${counts.movie} ${counts.movie === 1 ? 'MOVIE' : 'MOVIES'}`);
  if (counts.series) parts.push(`${counts.series} ${counts.series === 1 ? 'SHOW' : 'SHOWS'}`);
  if (counts.anime) parts.push(`${counts.anime} ANIME`);
  return parts.length ? parts.join('  ·  ') : undefined;
}

/**
 * Carousel cover: a fanned poster deck up top, a between-the-lines feature
 * strip (how many picks, what kind) bridging the middle, and a giant stacked
 * headline burning through the scrim below. The `closing` line doubles as the
 * swipe cue ("Swipe for the full list"); clear it for a standalone cover
 * post — a trailing arrow in the copy is dropped so the cue never doubles it.
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
  const closing = slide.closing.trim().replace(/[\s→➜>-]+$/u, '');
  const mix = refsMix(refs);
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
      {refs.length ? (
        <View style={styles.detail} pointerEvents="none">
          <LinearGradient
            colors={[palette.accentSoft, 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.glow}
          />
          <View style={styles.ornament}>
            <View style={[styles.ornamentLine, { backgroundColor: palette.accent.primary }]} />
            <View style={[styles.ornamentDot, { borderColor: palette.accent.primary }]} />
          </View>
          <View style={styles.detailRow}>
            <SlideText style={[styles.detailCount, { color: palette.text }]} numberOfLines={1}>{String(refs.length).padStart(2, '0')}</SlideText>
            <View style={styles.detailLabels}>
              <SlideText style={[styles.detailLabel, { color: palette.accent.primary }]} numberOfLines={1}>FEATURED</SlideText>
              {mix ? <SlideText style={[styles.detailMix, { color: palette.textSecondary }]} numberOfLines={1}>{mix}</SlideText> : null}
            </View>
          </View>
        </View>
      ) : null}
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
  detail: { position: 'absolute', left: 18, right: 18, top: 222, gap: 8 },
  glow: { position: 'absolute', left: -20, right: -20, top: -34, height: 150, borderRadius: 999 },
  ornament: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ornamentLine: { width: 30, height: 2, borderRadius: 1 },
  ornamentDot: { width: 5, height: 5, borderRadius: 2.5, borderWidth: 1.5 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  detailCount: { fontSize: 36, lineHeight: 40, fontWeight: '900', letterSpacing: 0.5 },
  detailLabels: { flex: 1, minWidth: 0, gap: 1 },
  detailLabel: { fontSize: 10, lineHeight: 12.5, fontWeight: '800', letterSpacing: 2.2 },
  detailMix: { fontSize: 9.5, lineHeight: 12, fontWeight: '600', letterSpacing: 1.1 },
  content: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  headline: { fontSize: 30, lineHeight: 31, fontWeight: '900', letterSpacing: 0.6 },
  subtitle: { fontSize: 12, lineHeight: 16, marginTop: 6, fontWeight: '500' },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  cue: { fontSize: 10.5, lineHeight: 13, fontWeight: '800', letterSpacing: 1.6 },
});
