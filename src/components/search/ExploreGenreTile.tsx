import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

/**
 * The poster-style category tile used by the Explore search screen. It keeps
 * the app's vivid genre gradients as the fallback and layers real artwork on
 * top when the catalog already has a matching title cached.
 */
export function ExploreGenreTile({ name, imageUrl, gradient, onPress, style }: {
  name: string;
  imageUrl?: string;
  gradient: readonly [string, string];
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Explore ${name}`}
      onPress={() => {
        triggerLightHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.tile, style, pressed && styles.pressed]}
    >
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {imageUrl ? <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <LinearGradient
        colors={['rgba(5,6,10,0.02)', 'rgba(5,6,10,0.32)', 'rgba(5,6,10,0.92)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.corner}>
        <Ionicons name="arrow-up-outline" size={14} color={colors.white} style={styles.cornerIcon} />
      </View>
      <View style={styles.copy}>
        <AppText style={styles.name} numberOfLines={2}>{name}</AppText>
        <AppText style={styles.label}>GENRE</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: 116,
    borderRadius: radius.large,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'flex-end',
  },
  corner: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,6,14,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cornerIcon: { transform: [{ rotate: '45deg' }] },
  copy: { padding: spacing.md, gap: 2 },
  name: { color: colors.white, fontSize: 14, lineHeight: 17, fontWeight: '700' },
  label: { color: 'rgba(255,255,255,0.62)', fontSize: 8.5, lineHeight: 11, fontWeight: '700', letterSpacing: 1.5 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});
