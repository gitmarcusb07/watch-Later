import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { actionPalette, type ActionTone } from '@/theme/actionPalette';
import { AppText } from '@/components/common/AppText';
import { usePressMotion, type ActionMotion } from '@/lib/pressMotion';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'text' | 'ghost';
  tone?: ActionTone;
  motion?: ActionMotion;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function AppButton({ label, onPress, variant = 'primary', tone, motion, loading = false, disabled = false, icon }: AppButtonProps) {
  const primary = variant === 'primary';
  const secondary = variant === 'secondary' || variant === 'ghost';
  const palette = tone ? actionPalette(tone) : undefined;
  const press = usePressMotion(motion ?? 'pop', 0.97);
  const surface = palette
    ? primary
      ? { backgroundColor: palette.color, borderColor: palette.color, shadowColor: palette.color }
      : { backgroundColor: palette.soft, borderColor: palette.border }
    : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={() => { press.play(); onPress(); }}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : secondary ? styles.secondary : styles.textButton,
        variant === 'ghost' && styles.ghost,
        primary && shadows.glow,
        surface,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.scaler, press.pressMotionStyle]}>
        {loading ? <ActivityIndicator color={primary ? (palette?.onColor ?? colors.background) : (palette?.color ?? colors.accent)} /> : (
          <View style={styles.content}>
            {icon}
            <AppText variant="button" style={primary ? [styles.primaryLabel, palette && { color: palette.onColor }] : [styles.secondaryLabel, palette && { color: palette.color }]}>{label}</AppText>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 56, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  textButton: { backgroundColor: 'transparent' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  scaler: { alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: colors.background, ...typography.button },
  secondaryLabel: { color: colors.textPrimary },
  pressed: { opacity: 0.84 },
  disabled: { opacity: 0.55 },
});

type NamedButtonProps = Omit<AppButtonProps, 'variant'>;
export const PrimaryButton = (props: NamedButtonProps) => <AppButton {...props} variant="primary" />;
export const SecondaryButton = (props: NamedButtonProps) => <AppButton {...props} variant="secondary" />;
export const GhostButton = (props: NamedButtonProps) => <AppButton {...props} variant="ghost" />;
