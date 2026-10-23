import { memo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

interface PosterCardProps {
  title: string;
  posterUri?: string;
  subtitle?: string;
  /** Optional second caption line (e.g. a popularity figure). */
  meta?: string;
  badge?: string;
  progress?: number;
  userRating?: number | null;
  width?: number;
  palette?: readonly [string, string];
  onPress?: () => void;
}

export const PosterCard = memo(function PosterCard({ title, posterUri, subtitle, meta, badge, progress, userRating, width = 132, palette = ['#51416C', '#202637'], onPress }: PosterCardProps) {
  const [failedUri, setFailedUri] = useState<string>();
  const posterFailed = failedUri === posterUri;
  const poster = <View style={[styles.poster, { width, height: width * 1.46 }]}>
    {posterUri && !posterFailed ? <RemoteImage uri={posterUri} style={StyleSheet.absoluteFill} onError={() => setFailedUri(posterUri)} /> : <LinearGradient colors={[...palette]} style={styles.art}>
      <View style={styles.artTop}><Ionicons name="sparkles" size={14} color="rgba(255,255,255,0.7)" /></View>
      <AppText variant="caption" style={styles.artTitle} numberOfLines={3}>{title.toUpperCase()}</AppText>
      <View style={styles.artMark}><View style={styles.artMarkInner} /></View>
    </LinearGradient>}
    {badge ? <View style={styles.badge}><AppText variant="caption" style={styles.badgeText}>{badge}</AppText></View> : null}
    {userRating !== null && userRating !== undefined ? <View style={styles.ratingBadge} accessibilityLabel={`Your rating ${userRating.toFixed(1)} out of 10`}><Ionicons name="star" size={9} color={colors.accent} /><AppText style={styles.ratingText}>{userRating.toFixed(1)}</AppText></View> : null}
    {typeof progress === 'number' ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} /></View> : null}
  </View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`} onPress={() => { triggerLightHaptic(); onPress?.(); }} style={({ pressed }) => [styles.container, { width }, pressed && styles.pressed]}>
    {poster}
    <AppText variant="bodyMedium" numberOfLines={1} style={styles.title}>{title}</AppText>
    {subtitle ? <AppText variant="caption" numberOfLines={1} style={styles.subtitle}>{subtitle}</AppText> : null}
    {meta ? <AppText variant="caption" numberOfLines={1} style={styles.meta}>{meta}</AppText> : null}
  </Pressable>;
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs }, poster: { overflow: 'hidden', borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  art: { flex: 1, padding: spacing.md, justifyContent: 'space-between' }, artTop: { alignItems: 'flex-end' }, artTitle: { color: colors.white, letterSpacing: 1.1, textShadowColor: '#000', textShadowRadius: 8 },
  artMark: { width: 30, height: 30, borderRadius: 15, borderColor: 'rgba(255,255,255,0.48)', borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }, artMarkInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.8)' },
  badge: { position: 'absolute', left: spacing.sm, top: spacing.sm, backgroundColor: 'rgba(10,10,12,0.78)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }, badgeText: { fontSize: 10, color: colors.white },
  ratingBadge: { position: 'absolute', right: spacing.sm, bottom: 7, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(10,10,12,0.78)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }, ratingText: { fontSize: 10, color: colors.white },
  progressTrack: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.26)' }, progressFill: { height: 3, backgroundColor: colors.accent }, title: { marginTop: spacing.xs, color: colors.white }, subtitle: { color: colors.textMuted }, meta: { color: colors.textMuted }, pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
