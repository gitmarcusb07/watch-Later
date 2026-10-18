import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '@/components/creator/palette';

/**
 * Low-level building blocks for slide canvases. Everything is authored for
 * the fixed 360 x 450 slide surface (see exportPlan.ts); the canvas scales as
 * one unit, so these primitives never take size props.
 */

/** Canvas text with full style control (the app typography scale is too coarse here). */
export function SlideText({ children, style, numberOfLines, adjustsFontSizeToFit }: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      ellipsizeMode="tail"
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={adjustsFontSizeToFit ? 0.72 : undefined}
      style={style}
    >
      {children}
    </Text>
  );
}

/** Poster image with a graceful gradient fallback (never an empty hole). */
export function SlidePoster({ uri, title, style, radius = 12, children }: {
  uri?: string;
  title: string;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri) && !failed;
  return (
    <View style={[styles.posterShell, { borderRadius: radius }, style]}>
      {showImage ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <LinearGradient colors={['#51416C', '#2B2547', '#1A1626']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.posterFallback}>
          <Ionicons name="sparkles" size={13} color="rgba(255,255,255,0.65)" />
          <SlideText
            style={styles.posterFallbackTitle}
            numberOfLines={4}
            adjustsFontSizeToFit
          >
            {title.toUpperCase()}
          </SlideText>
        </LinearGradient>
      )}
      {children}
    </View>
  );
}

/** Small rounded label. `tone` picks the fill and ink. */
export function SlideChip({ label, palette, tone = 'surface', icon }: {
  label: string;
  palette: CreatorPalette;
  tone?: 'surface' | 'accent';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const accentTone = tone === 'accent';
  return (
    <View style={[styles.chip, { backgroundColor: accentTone ? palette.accent.primary : palette.surface, borderColor: accentTone ? 'transparent' : palette.surfaceBorder }]}>
      {icon ? <Ionicons name={icon} size={9} color={accentTone ? palette.accent.ink : palette.textSecondary} /> : null}
      <SlideText style={[styles.chipText, { color: accentTone ? palette.accent.ink : palette.textSecondary }]} numberOfLines={1}>{label}</SlideText>
    </View>
  );
}

/** Small uppercase eyebrow above the main heading. */
export function SlideKicker({ text, palette, style }: { text: string; palette: CreatorPalette; style?: StyleProp<ViewStyle> }) {
  if (!text.trim()) return null;
  return (
    <View style={[styles.kickerRow, style]}>
      <View style={[styles.kickerDot, { backgroundColor: palette.accent.primary }]} />
      <SlideText style={[styles.kickerText, { color: palette.accent.primary }]} numberOfLines={1}>{text.toUpperCase()}</SlideText>
    </View>
  );
}

/** The optional brand wordmark burned into the slide. Label defaults to the app name. */
export function BrandMark({ palette, style, label }: { palette: CreatorPalette; style?: StyleProp<ViewStyle>; label?: string }) {
  const text = (label?.trim() || 'Watch Later').toUpperCase();
  return (
    <View style={[styles.brandRow, style]} accessibilityElementsHidden>
      <View style={[styles.brandDot, { backgroundColor: palette.accent.primary }]} />
      <SlideText style={[styles.brandText, { color: palette.textMuted }]} numberOfLines={1}>{text}</SlideText>
    </View>
  );
}

/**
 * Compact score pill used on photo-row templates. `imdb` renders the yellow
 * IMDb chip (only when a real matched score exists); `score` renders the
 * neutral TMDb star chip. Both sit on photography, so colors are fixed.
 */
export function RatingBadge({ variant, value }: { variant: 'imdb' | 'score'; value: string }) {
  return (
    <View style={[styles.ratingBadge, variant === 'imdb' ? styles.ratingBadgeImdb : styles.ratingBadgeScore]}>
      {variant === 'imdb'
        ? <SlideText style={styles.ratingBadgeImdbText}>{`IMDb ${value}`}</SlideText>
        : <SlideText style={styles.ratingBadgeScoreText}>{`★ ${value}`}</SlideText>}
    </View>
  );
}

/** Numbered rank marker used by ranked list templates. */
export function RankBadge({ rank, palette, compact }: { rank: number; palette: CreatorPalette; compact?: boolean }) {
  const label = compact ? `${rank}` : String(rank).padStart(2, '0');
  return (
    <View style={[styles.rankBadge, compact && styles.rankBadgeCompact, { backgroundColor: palette.accentSoft }]}>
      <SlideText style={[styles.rankText, compact && styles.rankTextCompact, { color: palette.accent.primary }]}>{label}</SlideText>
    </View>
  );
}

/** Title/meta stack shown next to list posters. */
export function SlideTitleStack({ title, meta, palette, titleSize = 14, metaSize = 10.5, titleLines = 1, style, metaColor }: {
  title: string;
  meta?: string;
  palette: CreatorPalette;
  titleSize?: number;
  metaSize?: number;
  titleLines?: number;
  style?: StyleProp<ViewStyle>;
  metaColor?: string;
}) {
  return (
    <View style={[styles.stack, style]}>
      <SlideText style={[styles.stackTitle, { fontSize: titleSize, lineHeight: titleSize * 1.22, color: palette.text }]} numberOfLines={titleLines}>{title}</SlideText>
      {meta ? <SlideText style={[styles.stackMeta, { fontSize: metaSize, lineHeight: metaSize * 1.3, color: metaColor ?? palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
    </View>
  );
}

/** Joined meta parts, or undefined when nothing should render. */
export function joinMeta(parts: (string | undefined)[]): string | undefined {
  const clean = parts.filter((part): part is string => Boolean(part && part.trim()));
  return clean.length ? clean.join('  ·  ') : undefined;
}

export function slideTitleOf(ref: CreatorTitleRef | undefined, fallback: string): string {
  return ref?.title?.trim() || fallback;
}

const styles = StyleSheet.create({
  posterShell: { overflow: 'hidden', backgroundColor: '#241F36' },
  posterFallback: { flex: 1, padding: 8, justifyContent: 'space-between', alignItems: 'flex-start' },
  posterFallbackTitle: { color: 'rgba(255,255,255,0.92)', fontSize: 10.5, lineHeight: 12.5, fontWeight: '700', letterSpacing: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3.5, maxWidth: 220 },
  chipText: { fontSize: 9.5, lineHeight: 12, fontWeight: '600', letterSpacing: 0.4 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerDot: { width: 5, height: 5, borderRadius: 2.5 },
  kickerText: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 2.2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brandDot: { width: 5, height: 5, borderRadius: 2.5 },
  brandText: { fontSize: 9, lineHeight: 11, fontWeight: '700', letterSpacing: 2.6 },
  rankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rankBadgeCompact: { width: 22, height: 22, borderRadius: 11 },
  rankText: { fontSize: 14, lineHeight: 17, fontWeight: '800' },
  rankTextCompact: { fontSize: 11, lineHeight: 13 },
  stack: { flex: 1, minWidth: 0, gap: 1 },
  stackTitle: { fontWeight: '700' },
  stackMeta: { fontWeight: '500', letterSpacing: 0.2 },
  ratingBadge: { borderRadius: 5, paddingHorizontal: 5.5, paddingVertical: 2.5 },
  ratingBadgeImdb: { backgroundColor: '#F5C518' },
  ratingBadgeScore: { backgroundColor: 'rgba(10,6,18,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  ratingBadgeImdbText: { fontSize: 9.5, lineHeight: 12, fontWeight: '800', color: '#151021', letterSpacing: 0.2 },
  ratingBadgeScoreText: { fontSize: 9.5, lineHeight: 12, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 },
});
