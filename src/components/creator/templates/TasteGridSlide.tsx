import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlidePoster, SlideText } from '../primitives';

/**
 * The share-your-taste grid: nine fixed, opinion-led slots (favorite, most
 * underrated, comfort watch, …). Empty slots are shown as prompts rather than
 * omitted, so a half-built grid still reads as a grid and the editor can see
 * exactly how many picks remain.
 */
export const TASTE_GRID_LABELS = [
  'Favorite',
  'Most underrated',
  'Most overrated',
  'Comfort watch',
  'Best story',
  'Best visuals',
  'Guilty pleasure',
  'Hidden gem',
  'Wildcard',
] as const;

export function TasteGridSlide({ slide, palette, showBranding, branding }: { slide: CreatorSlide; palette: CreatorPalette; showBranding: boolean; branding: CreatorBranding }) {
  const refs = slide.titleRefs.slice(0, TASTE_GRID_LABELS.length);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {slide.headline.trim() || 'MY TASTE'}
        </SlideText>
        {slide.subtitle.trim() ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{slide.subtitle}</SlideText> : null}
      </View>
      <View style={styles.grid}>
        {TASTE_GRID_LABELS.map((label, index) => {
          const ref = refs[index];
          if (!ref) {
            return (
              <View key={label} style={[styles.emptyTile, { backgroundColor: palette.surface, borderColor: palette.surfaceBorder }]}>
                <View style={[styles.emptyPlus, { backgroundColor: palette.accentSoft }]}>
                  <Ionicons name="add" size={13} color={palette.accent.primary} />
                </View>
                <SlideText style={[styles.emptyLabel, { color: palette.textMuted }]} numberOfLines={2}>{label}</SlideText>
              </View>
            );
          }
          return (
            <SlidePoster key={`${ref.provider}:${ref.providerId}`} uri={ref.posterUrl} title={ref.title} style={styles.tile} radius={9}>
              <LinearGradient colors={['rgba(8,5,16,0.88)', 'rgba(8,5,16,0)']} style={styles.topScrim} />
              <LinearGradient colors={['rgba(8,5,16,0)', 'rgba(8,5,16,0.90)']} style={styles.bottomScrim} />
              <View style={styles.tileLabel}><SlideText style={[styles.tileLabelText, { color: palette.accent.primary }]} numberOfLines={1}>{label.toUpperCase()}</SlideText></View>
              <View style={styles.tileCopy}><SlideText style={styles.tileTitle} numberOfLines={1}>{ref.title}</SlideText></View>
            </SlidePoster>
          );
        })}
      </View>
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} label={branding.name} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 },
  header: { gap: 2, marginBottom: 10 },
  heading: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: 0.4 },
  subheading: { fontSize: 10.5, lineHeight: 14, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tile: { width: '31.5%', height: 108 },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: '42%' },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '48%' },
  tileLabel: { position: 'absolute', top: 5, left: 6, right: 6 },
  tileLabelText: { fontSize: 6.6, lineHeight: 8.4, fontWeight: '800', letterSpacing: 0.55 },
  tileCopy: { position: 'absolute', left: 6, right: 6, bottom: 5 },
  tileTitle: { color: '#FFFFFF', fontSize: 8.7, lineHeight: 10.4, fontWeight: '700' },
  emptyTile: { width: '31.5%', height: 108, borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  emptyPlus: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emptyLabel: { fontSize: 7.2, lineHeight: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, minHeight: 14 },
  closing: { fontSize: 9.8, lineHeight: 12, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1, marginRight: 8 },
});
