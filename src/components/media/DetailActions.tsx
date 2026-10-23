import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '@/components/common/AppText';
import { usePressMotion, type ActionMotion } from '@/lib/pressMotion';
import { actionPalette, type ActionTone } from '@/theme/actionPalette';
import { colors, radius, spacing } from '@/theme';

export interface DetailSecondaryAction {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon?: keyof typeof Ionicons.glyphMap;
  active?: boolean;
  busy?: boolean;
  tone?: ActionTone;
  motion?: ActionMotion;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface DetailExtraAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: ActionTone;
  motion?: ActionMotion;
  onPress: () => void;
  accessibilityLabel: string;
}

interface DetailActionsProps {
  primaryLabel: string;
  primaryIcon: keyof typeof Ionicons.glyphMap;
  primaryTone?: ActionTone;
  primaryMotion?: ActionMotion;
  primaryActive?: boolean;
  primaryBusy?: boolean;
  onPrimary: () => void;
  /** A shorter partner action beside the primary pill (for example Trailer). */
  extra?: DetailExtraAction;
  secondary: DetailSecondaryAction[];
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

/**
 * Each library action has its own identity: watched pops green, watch-later
 * glows violet, favorite bursts pink, tracking flashes orange. Activating
 * any of them plays a springy pop in its color; every tap also gets the
 * minimal press-down scale plus a signature motion.
 */
function ActionPill({ action }: { action: DetailSecondaryAction }) {
  const palette = actionPalette(action.tone ?? (action.id === 'favorite' ? 'favorite' : 'watch-later'));
  const { pressMotionStyle, pressIn, pressOut, play } = usePressMotion(action.motion ?? palette.motion, 0.94);
  const popStyle = useActivationPop(action.active);
  const icon = action.active && action.activeIcon ? action.activeIcon : action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      accessibilityState={{ selected: action.active, disabled: action.busy }}
      onPress={() => { play(); action.onPress(); }}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={action.busy}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: action.active ? palette.color : palette.border, backgroundColor: action.active ? palette.soft : 'rgba(255,255,255,0.02)' },
        pressed && !action.busy && styles.pressed,
      ]}
    >
      <Animated.View style={[styles.pillContent, pressMotionStyle, popStyle]}>
        <Ionicons name={icon} size={17} color={palette.color} />
        <AppText variant="button" style={[styles.pillLabel, action.active && { color: palette.color }]} numberOfLines={1}>
          {action.label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

function ExtraAction({ extra }: { extra: DetailExtraAction }) {
  const palette = actionPalette(extra.tone ?? 'trailer');
  const { pressMotionStyle, pressIn, pressOut, play } = usePressMotion(extra.motion ?? palette.motion, 0.95);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={extra.accessibilityLabel}
      onPress={() => { play(); extra.onPress(); }}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={({ pressed }) => [styles.extra, { borderColor: palette.border, backgroundColor: palette.soft }, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.extraContent, pressMotionStyle]}>
        <Ionicons name={extra.icon} size={18} color={palette.color} />
        <AppText variant="button" style={[styles.extraLabel, { color: palette.color }]} numberOfLines={1}>{extra.label}</AppText>
      </Animated.View>
    </Pressable>
  );
}

/** Every title action in one compact cluster: full-width primary plus small half-width pills. */
export function DetailActions({ primaryLabel, primaryIcon, primaryTone, primaryMotion, primaryActive, primaryBusy, onPrimary, extra, secondary }: DetailActionsProps) {
  const palette = actionPalette(primaryTone ?? (primaryActive ? 'watched' : 'watch-later'));
  const { pressMotionStyle, pressIn, pressOut, play } = usePressMotion(primaryMotion ?? palette.motion, 0.97);
  const primaryPop = useActivationPop(primaryActive);
  return (
    <View style={styles.root}>
      <View style={styles.primaryRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: primaryBusy, selected: primaryActive }}
          onPress={() => { play(); onPrimary(); }}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={primaryBusy}
          style={({ pressed }) => [styles.primaryWrap, primaryBusy && styles.primaryDisabled, pressed && !primaryBusy && styles.pressed]}
        >
          <Animated.View style={[pressMotionStyle, primaryPop]}>
            <LinearGradient
              colors={palette.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primary}
            >
              <Ionicons name={primaryIcon} size={19} color={palette.onColor} />
              <AppText variant="button" style={[styles.primaryLabel, { color: palette.onColor }]} numberOfLines={1}>
                {primaryLabel}
              </AppText>
            </LinearGradient>
          </Animated.View>
        </Pressable>
        {extra ? <ExtraAction extra={extra} /> : null}
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
  extraContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  extraLabel: { color: colors.textPrimary, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  pillContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pillLabel: { color: colors.textPrimary, fontSize: 14 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
