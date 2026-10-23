import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

/**
 * Slim continue-watching row: thumbnail, title, next-episode line, and a
 * thin progress bar — two fit beside the hero so the next shelf peeks
 * above the fold.
 */
export function ContinueWatchingCard({ title, subtitle, progress, palette = ['#51416C', '#202637'], posterUri, onPress }: { title: string; subtitle: string; progress: number; palette?: readonly [string, string]; posterUri?: string; onPress?: () => void }) {
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Continue watching ${title}`} onPress={() => { triggerLightHaptic(); onPress?.(); }} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <LinearGradient colors={[...palette]} style={styles.poster}>
      {posterUri ? <RemoteImage uri={posterUri} style={StyleSheet.absoluteFill} /> : <Ionicons name="play" size={20} color={colors.white} />}
    </LinearGradient>
    <View style={styles.copy}>
      <AppText variant="bodyMedium" numberOfLines={1}>{title}</AppText>
      <AppText variant="caption" muted numberOfLines={1}>{subtitle}</AppText>
      <View style={styles.progressRow}>
        <View style={styles.track}><View style={[styles.fill, { width: `${percent}%` }]} /></View>
        <AppText variant="caption" muted>{percent}%</AppText>
      </View>
    </View>
    <View style={styles.go}><Ionicons name="chevron-forward" size={18} color={colors.accent} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, paddingRight: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, marginBottom: spacing.sm },
  poster: { width: 52, height: 72, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  copy: { flex: 1, gap: 2, justifyContent: 'center' },
  progressRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: 2 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.accent },
  go: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(182,156,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
});
