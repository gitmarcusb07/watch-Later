import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { SlidePoster, SlideText } from '../primitives';

const APP_ICON = require('../../../../assets/icon.png');

/** `watchlater` and `@watchlater` both render as `@watchlater`. */
function handleLabel(handle: string): string | undefined {
  const clean = handle.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : undefined;
}

/** The follow CTA the card falls back to when its closing note is just the cover's swipe cue. */
const DEFAULT_CTA = 'Don’t miss the next drop';
/** Swipe copy belongs to the cover slide, never to the follow card. */
const SWIPE_CUE = /^swipe\b/i;

/**
 * Closing slide: brand profile card over a backdrop (or the accent gradient
 * when no title is attached) with a follow call-to-action — the "if you like
 * this, follow the page" card of a carousel. The page identity comes from the
 * project's branding fields; nothing here is invented. A closing note that is
 * still the cover's swipe cue ("Swipe for the full list") reads wrong on the
 * final slide of the carousel, so the card substitutes its own follow CTA.
 */
export function PagePromoSlide({ slide, palette, showBranding, branding }: {
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
  branding: CreatorBranding;
}) {
  const ref = slide.titleRefs[0];
  const name = branding.name.trim() || 'Watch Later';
  const handle = handleLabel(branding.handle);
  const tagline = branding.tagline.trim();
  const closing = slide.closing.trim();
  const cta = !closing ? undefined : SWIPE_CUE.test(closing) ? DEFAULT_CTA : closing;
  const subtitle = slide.subtitle.trim();
  return (
    <View style={styles.root}>
      {ref ? (
        <SlidePoster uri={ref.backdropUrl ?? ref.posterUrl} title={ref.title} radius={0} style={StyleSheet.absoluteFill} />
      ) : (
        <LinearGradient
          colors={[palette.accent.secondary, palette.accent.primary, palette.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.theme === 'dark' ? 'rgba(11,7,20,0.64)' : 'rgba(246,244,251,0.74)' }]} pointerEvents="none" />
      <View style={styles.content}>
        <SlideText style={[styles.headline, { color: palette.text }]} numberOfLines={3} adjustsFontSizeToFit>{slide.headline.trim() || 'FOLLOW FOR MORE'}</SlideText>
        {subtitle ? <SlideText style={[styles.subtitle, { color: palette.textSecondary }]} numberOfLines={2}>{subtitle}</SlideText> : null}
        {showBranding ? (
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.surfaceBorder, shadowColor: palette.shadow }]}>
            <Image source={APP_ICON} style={styles.avatar} />
            <View style={styles.cardText}>
              <SlideText style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>{name}</SlideText>
              <SlideText style={[styles.cardLine, { color: palette.textMuted }]} numberOfLines={1}>
                {handle ?? (tagline || 'Movie & show picks, straight from the watchlist')}
              </SlideText>
              {handle && tagline ? <SlideText style={[styles.cardLine, { color: palette.textMuted }]} numberOfLines={1}>{tagline}</SlideText> : null}
            </View>
          </View>
        ) : null}
        {cta ? (
          <View style={[styles.cta, { backgroundColor: palette.accent.primary, shadowColor: palette.shadow }]}>
            <Ionicons name="notifications-outline" size={13} color={palette.accent.ink} />
            <SlideText style={[styles.ctaText, { color: palette.accent.ink }]} numberOfLines={1} adjustsFontSizeToFit>{cta.toUpperCase()}</SlideText>
            <Ionicons name="arrow-forward" size={13} color={palette.accent.ink} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center' },
  content: { paddingHorizontal: 26, alignItems: 'center', gap: 0 },
  headline: { fontSize: 29, lineHeight: 32, fontWeight: '900', letterSpacing: 0.4, textAlign: 'center' },
  subtitle: { fontSize: 12, lineHeight: 16.5, fontWeight: '500', textAlign: 'center', marginTop: 7 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16, minWidth: 250, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  avatar: { width: 42, height: 42, borderRadius: 12 },
  cardText: { flex: 1, minWidth: 0, gap: 1 },
  cardName: { fontSize: 15, lineHeight: 18, fontWeight: '800' },
  cardLine: { fontSize: 10.5, lineHeight: 13.5, fontWeight: '500' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 11, marginTop: 18, minWidth: 250, justifyContent: 'center', shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  ctaText: { fontSize: 12, lineHeight: 15, fontWeight: '800', letterSpacing: 1.2, flexShrink: 1 },
});
