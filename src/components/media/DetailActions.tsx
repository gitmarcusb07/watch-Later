import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '@/components/common/AppText';
import { usePressScale } from '@/lib/pressScale';
import { colors, radius, spacing } from '@/theme';

export interface DetailSecondaryAction {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon?: keyof typeof Ionicons.glyphMap;
  active?: boolean;
  busy?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface DetailExtraAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}

interface DetailActionsProps {
  primaryLabel: string;
  primaryIcon: keyof typeof Ionicons.glyphMap;
  primaryActive?: boolean;
  primaryBusy?: boolean;
  onPrimary: () => void;
  /** A shorter partner action beside the primary pill (for example Trailer). */
  extra?: DetailExtraAction;
  secondary: DetailSecondaryAction[];
}

/**
 * Each library action has its own identity: watched pops green, watch-later
 * glows violet, favorite bursts pink, tracking flashes orange. Activating
 * any of them plays a springy pop in its color; every tap also gets the
 * minimal press-down scale.
 */
const TONES: Record<string, string> = {
  'watch-later': colors.accent,
  favorite: colors.error,
  tracking: colors.warning,
};

function toneFor(id: string): string {
  return TONES[id] ?? colors.accent;
}

/** Springy scale burst fired when `active` flips on. Core Animated: Jest-safe. */
function useActivationPop(active?: boolean) {
  const [pop] = useState(() => new Animated.Value(0));
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      Animated.sequence([
        Animated.timing(pop, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(pop, { toValue: 0, damping: 9, stiffness: 320, useNativeDriver: true }),
      ]).start();
    }
    wasActive.current = active;
  }, [active, pop]);
  return { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] } as const;
}

function ActionPill({ action }: { action: DetailSecondaryAction }) {
  const tone = toneFor(action.id);
  const { pressScaleStyle, pressIn, pressOut } = usePressScale(0.95);
  const popStyle = useActivationPop(action.active);
  const icon = action.active && action.activeIcon ? action.activeIcon : action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      accessibilityState={{ selected: action.active, disabled: action.busy }}
      onPress={action.onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={action.busy}
      style={({ pressed }) => [
        styles.pill,
        action.active && { borderColor: tone, backgroundColor: `${tone}1F` },
        pressed && !action.busy && styles.pressed,
      ]}
    >
      <Animated.View style={[styles.pillContent, pressScaleStyle, popStyle]}>
        <Ionicons name={icon} size={17} color={action.active ? tone : colors.textPrimary} />
        <AppText variant="button" style={[styles.pillLabel, action.active && { color: tone }]} numberOfLines={1}>
          {action.label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

/** Every title action in one compact cluster: full-width primary plus small half-width pills. */
export function DetailActions({ primaryLabel, primaryIcon, primaryActive, primaryBusy, onPrimary, extra, secondary }: DetailActionsProps) {
  const { pressScaleStyle, pressIn, pressOut } = usePressScale(0.98);
  const primaryPop = useActivationPop(primaryActive);
  return (
    <View style={styles.root}>
      <View style={styles.primaryRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: primaryBusy, selected: primaryActive }}
          onPress={onPrimary}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={primaryBusy}
          style={({ pressed }) => [styles.primaryWrap, primaryBusy && styles.primaryDisabled, pressed && !primaryBusy && styles.pressed]}
        >
          <Animated.View style={[pressScaleStyle, primaryPop]}>
            <LinearGradient
              colors={primaryActive ? ['#4ADE80', '#16A34A'] : ['#B45CFF', '#8B3DFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primary}
            >
              <Ionicons name={primaryIcon} size={19} color={colors.white} />
              <AppText variant="button" style={styles.primaryLabel} numberOfLines={1}>
                {primaryLabel}
              </AppText>
            </LinearGradient>
          </Animated.View>
        </Pressable>
        {extra ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={extra.accessibilityLabel}
            onPress={extra.onPress}
            style={({ pressed }) => [styles.extra, pressed && styles.pressed]}
          >
            <Ionicons name={extra.icon} size={18} color={colors.textPrimary} />
            <AppText variant="button" style={styles.extraLabel} numberOfLines={1}>{extra.label}</AppText>
          </Pressable>
        ) : null}
      </View>
      {secondary.length ? (
        <View style={styles.grid}>
          {secondary.map((action) => <ActionPill key={action.id} action={action} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  primaryRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  primaryWrap: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  primaryDisabled: { opacity: 0.75 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 54, paddingHorizontal: spacing.lg },
  primaryLabel: { color: colors.white },
  extra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 54, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  extraLabel: { color: colors.textPrimary, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  pillContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pillLabel: { color: colors.textPrimary, fontSize: 14 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
