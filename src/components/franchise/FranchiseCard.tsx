import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

interface FranchiseCardProps {
  title: string;
  itemCount: number;
  backdropUri?: string;
  width?: number;
  onPress?: () => void;
}

/** Wide collection tile: franchise art, title and member count (browse grid). */
export const FranchiseCard = memo(function FranchiseCard({ title, itemCount, backdropUri, width = 160, onPress }: FranchiseCardProps) {
  const [failedUri, setFailedUri] = useState<string>();
  const posterFailed = failedUri === backdropUri;
  const showImage = Boolean(backdropUri) && !posterFailed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${itemCount} ${itemCount === 1 ? 'title' : 'titles'}`}
      accessibilityHint="Opens the franchise collection"
      onPress={() => {
        triggerLightHaptic();
        onPress?.();
      }}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <View style={[styles.art, { height: width * 0.58 }]}>
        {showImage ? (
          <RemoteImage
            uri={backdropUri}
            style={styles.image}
            onError={() => backdropUri && setFailedUri(backdropUri)}
          />
        ) : (
          <View style={styles.fallback} />
        )}
        <View style={styles.countBadge}>
          <AppText variant="caption" style={styles.countText}>{itemCount}</AppText>
        </View>
      </View>
      <AppText variant="label" numberOfLines={2} style={styles.title}>{title}</AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  pressed: { opacity: 0.75 },
  art: { width: '100%', borderRadius: radius.medium, overflow: 'hidden', backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  image: { width: '100%', height: '100%' },
  fallback: { flex: 1, backgroundColor: colors.surfaceElevated },
  countBadge: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(5, 6, 10, 0.78)' },
  countText: { color: colors.white },
  title: { color: colors.textPrimary },
});
