import { useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import type { CatalogMedia } from '@/domain/models/media';
import { triggerLightHaptic } from '@/lib/haptics';
import { usePressMotion, type ActionMotion } from '@/lib/pressMotion';
import { actionPalette, type ActionTone } from '@/theme/actionPalette';
import { colors, spacing } from '@/theme';
export function TrackedMediaRow({ media, subtitle, badge, badgeTone, highlight, progress, userRating, hideOverview, actionLabel, actionIcon, actionTone, actionMotion, onPress, onAction, actionDisabled = false }: {
  media: CatalogMedia; subtitle?: string; badge?: string; badgeTone?: 'accent' | 'success'; highlight?: { text: string; color: string }; progress?: number; userRating?: number | null; hideOverview?: boolean;
  actionLabel?: string; actionIcon?: keyof typeof Ionicons.glyphMap; actionTone?: ActionTone; actionMotion?: ActionMotion;
  onPress: () => void; onAction?: () => void; actionDisabled?: boolean;
}) {
  const [posterFailed, setPosterFailed] = useState(false);
  const actionPaletteTone = actionTone ?? (actionIcon === 'heart' ? 'favorite' : actionIcon === 'checkmark-circle' ? 'watched' : actionIcon === 'bookmark' ? 'watch-later' : 'neutral');
  const palette = actionPalette(actionPaletteTone);
  const actionPress = usePressMotion(actionMotion ?? palette.motion, 0.9);
  const meta = subtitle ?? [media.year, media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime', media.runtimeMinutes ? `${media.runtimeMinutes} min` : undefined, media.language ? media.language.toUpperCase() : undefined].filter(Boolean).join(' · ');
  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${media.title}`} accessibilityHint="Opens title details" onPress={() => { triggerLightHaptic(); onPress(); }} style={({ pressed }) => [styles.content, pressed && styles.pressed]}>
      {media.posterUrl && !posterFailed ? <RemoteImage uri={media.posterUrl} style={styles.poster} onError={() => setPosterFailed(true)} /> : <View style={[styles.poster, styles.posterFallback]}><Ionicons name="film-outline" size={23} color={colors.accent} /></View>}
      <View style={styles.copy}><AppText variant="bodyMedium" numberOfLines={1}>{media.title}</AppText><AppText variant="caption" muted numberOfLines={1}>{meta}</AppText>{highlight ? <AppText variant="caption" numberOfLines={1} style={{ color: highlight.color }}>{highlight.text}</AppText> : null}{media.overview && !hideOverview ? <AppText variant="caption" muted numberOfLines={1}>{media.overview}</AppText> : null}<View style={styles.metaRow}>{badge ? <AppText variant="caption" numberOfLines={1} style={[styles.badge, badgeTone === 'success' && styles.badgeSuccess]}>{badge}</AppText> : null}{userRating !== null && userRating !== undefined ? <View style={styles.rating}><Ionicons name="star" size={11} color={colors.accent} /><AppText variant="caption" muted>{userRating.toFixed(1)}</AppText></View> : null}</View>{typeof progress === 'number' ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} /></View> : null}</View>
    </Pressable>
    {actionLabel && onAction ? <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} accessibilityState={{ disabled: actionDisabled }} disabled={actionDisabled} onPress={() => { actionPress.play(); onAction(); }} onPressIn={actionPress.pressIn} onPressOut={actionPress.pressOut} style={({ pressed }) => [styles.action, { backgroundColor: palette.soft, borderColor: palette.border }, pressed && styles.pressed, actionDisabled && styles.disabled]}><Animated.View style={actionPress.pressMotionStyle}><Ionicons name={actionIcon ?? 'close'} size={20} color={palette.color} /></Animated.View></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', minHeight: 88, gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, content: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, poster: { width: 54, height: 78, borderRadius: 10, backgroundColor: colors.surfaceElevated }, posterFallback: { alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 2 }, badge: { color: colors.accent }, badgeSuccess: { color: colors.success }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rating: { flexDirection: 'row', alignItems: 'center', gap: 3 }, progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden', marginTop: spacing.xs }, progressFill: { height: 4, backgroundColor: colors.accent }, action: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, borderWidth: 1 }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.4 } });
