import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { CreatorSlide } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlidePoster, SlideText } from '../primitives';

/**
 * Watchlist-style collection: a 3 x 2 poster mosaic with titles burned into
 * each tile. Six tiles keep every poster readable on the 4:5 canvas; longer
 * collections continue on the next slide (distribution handles the split).
 */
export function CollectionGridSlide({ slide, palette, showBranding }: { slide: CreatorSlide; palette: CreatorPalette; showBranding: boolean }) {
  const refs = slide.titleRefs.slice(0, 6);
  const subtitle = slide.subtitle.trim() || (refs.length ? `${refs.length} ${refs.length === 1 ? 'title' : 'titles'} saved` : '');
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{slide.headline.trim() || 'MY WATCHLIST'}</SlideText>
        {subtitle ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{subtitle}</SlideText> : null}
      </View>
      {refs.length ? (
        <View style={styles.grid}>
          {refs.map((ref) => (
            <View key={`${ref.provider}:${ref.providerId}`} style={styles.tile}>
              <SlidePoster uri={ref.posterUrl} title={ref.title} style={styles.tilePoster} radius={10}>
                <LinearGradient
                  colors={['rgba(8,5,16,0)', 'rgba(8,5,16,0.86)']}
                  style={styles.tileScrim}
                  start={{ x: 0.5, y: 0.4 }}
                  end={{ x: 0.5, y: 1 }}
                />
                <View style={styles.tileCopy}>
                  <SlideText style={styles.tileTitle} numberOfLines={2}>{ref.title}</SlideText>
                  {ref.year ? <SlideText style={styles.tileYear} numberOfLines={1}>{ref.year}</SlideText> : null}
                </View>
              </SlidePoster>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <SlideText style={[styles.emptyText, { color: palette.textMuted }]}>Pick titles from your watchlist to fill this grid</SlideText>
        </View>
      )}
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  header: { gap: 3, marginBottom: 10 },
  heading: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: 0.5 },
  subheading: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%' },
  tilePoster: { width: '100%', aspectRatio: 2 / 3 },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },
  tileCopy: { position: 'absolute', left: 6, right: 6, bottom: 5, gap: 1 },
  tileTitle: { color: '#FFFFFF', fontSize: 9.5, lineHeight: 11.5, fontWeight: '700' },
  tileYear: { color: 'rgba(255,255,255,0.75)', fontSize: 8, lineHeight: 10, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, minHeight: 14 },
  closing: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
});
