import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '@/components/common/AppText';
import { PRIORITY_META, PRIORITY_ORDER } from '@/features/watchState/priority';
import type { WatchPriority } from '@/domain/models/watchState';
import { usePressMotion, type ActionMotion } from '@/lib/pressMotion';
import { actionPalette } from '@/theme/actionPalette';
import { colors, radius, spacing } from '@/theme';

interface WatchLaterSheetProps {
  visible: boolean;
  saved: boolean;
  currentPriority: WatchPriority | null;
  busy?: boolean;
  onSelect: (priority: WatchPriority) => void;
  onRemove: () => void;
  onClose: () => void;
}

const PRIORITY_MOTION: Record<WatchPriority, ActionMotion> = {
  asap: 'launch',
  weekend: 'bounce',
  someday: 'float',
};

function PriorityOption({ priority, selected, busy, onSelect }: {
  priority: WatchPriority;
  selected: boolean;
  busy?: boolean;
  onSelect: (priority: WatchPriority) => void;
}) {
  const meta = PRIORITY_META[priority];
  const palette = actionPalette(priority);
  const motion = usePressMotion(PRIORITY_MOTION[priority], 0.97);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${meta.label}, ${meta.description}`}
      accessibilityState={{ selected, disabled: busy }}
      disabled={busy}
      onPress={() => { motion.play(); onSelect(priority); }}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      style={({ pressed }) => [
        styles.option,
        { borderColor: selected ? palette.color : palette.border, backgroundColor: selected ? palette.soft : 'rgba(255,255,255,0.02)' },
        pressed && !busy && styles.pressed,
      ]}
    >
      <Animated.View style={[styles.optionInner, motion.pressMotionStyle]}>
        <View style={[styles.optionIcon, { backgroundColor: palette.soft, borderColor: palette.border }]}>
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={palette.color} />
        </View>
        <View style={styles.optionCopy}>
          <AppText variant="bodyMedium" style={selected ? { color: palette.color } : undefined}>{meta.label}</AppText>
          <AppText variant="bodySmall" muted>{meta.description}</AppText>
        </View>
        <View style={[styles.optionCheck, { borderColor: selected ? palette.color : colors.border, backgroundColor: selected ? palette.color : 'transparent' }]}>
          {selected ? <Ionicons name="checkmark" size={14} color={palette.onColor} /> : null}
        </View>
      </Animated.View>
      {selected ? <LinearGradient colors={palette.gradient} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.optionAccent} /> : null}
    </Pressable>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const motion = usePressMotion('wobble', 0.88);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close watch later options"
      onPress={() => { motion.play(); onClose(); }}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      hitSlop={10}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Animated.View style={motion.pressMotionStyle}>
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </Animated.View>
    </Pressable>
  );
}

function RemoveAction({ busy, onRemove }: { busy?: boolean; onRemove: () => void }) {
  const palette = actionPalette('remove');
  const motion = usePressMotion('shake', 0.97);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Remove from watchlist"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={() => { motion.play(); onRemove(); }}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      style={({ pressed }) => [styles.remove, { borderColor: palette.border, backgroundColor: palette.soft }, pressed && !busy && styles.pressed]}
    >
      <Animated.View style={[styles.removeContent, motion.pressMotionStyle]}>
        <Ionicons name="trash-outline" size={16} color={palette.color} />
        <AppText variant="button" style={[styles.removeText, { color: palette.color }]}>Remove from Watchlist</AppText>
      </Animated.View>
    </Pressable>
  );
}

export function WatchLaterSheet({ visible, saved, currentPriority, busy, onSelect, onRemove, onClose }: WatchLaterSheetProps) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss watch later options" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText variant="heading2">Watch Later</AppText>
            <CloseButton onClose={onClose} />
          </View>
          {PRIORITY_ORDER.map((priority) => (
            <PriorityOption
              key={priority}
              priority={priority}
              selected={currentPriority === priority}
              busy={busy}
              onSelect={onSelect}
            />
          ))}
          {saved ? <RemoveAction busy={busy} onRemove={onRemove} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingBottom: spacing['2xl'], gap: spacing.sm },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  option: { position: 'relative', overflow: 'hidden', paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.medium, borderWidth: 1 },
  optionInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  optionIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, gap: 2 },
  optionCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  remove: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.sm, borderRadius: radius.medium, borderWidth: 1 },
  removeContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  removeText: { color: colors.error },
  pressed: { opacity: 0.8 },
});
