import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, shadows, spacing } from '@/theme';

const SEEN_KEY = 'watch-later.coachmarks.v1';

export async function hasSeenCoachMarks(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markCoachMarksSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, '1');
  } catch { /* best effort */ }
}

interface CoachStep {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
}

const STEPS: CoachStep[] = [
  {
    icon: 'bookmark',
    title: 'Your Watchlist',
    message: 'Everything you save lives on the Watchlist tab, in the order you want it.',
  },
  {
    icon: 'checkmark-done',
    title: 'Watched & episodes',
    message: 'Mark titles watched, track series season by season, and rate what you love.',
  },
  {
    icon: 'calendar',
    title: 'Upcoming & discover',
    message: 'The Upcoming tab lists what’s next. Home has new releases, genres and franchises.',
  },
  {
    icon: 'download',
    title: 'Back it up',
    message: 'Your library lives on this device. Export a backup from More so a reinstall never loses it.',
  },
];

/**
 * First-run feature tour on the home screen. One card at a time with a dim
 * backdrop, animated like onboarding; skippable and shown only once.
 */
export function CoachMarks({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const content = STEPS[step];

  function next() {
    triggerLightHaptic();
    if (last) onDone();
    else setStep(step + 1);
  }

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.overlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="Skip tour" onPress={onDone} style={styles.skip}>
        <AppText variant="bodySmall" style={styles.skipText}>Skip</AppText>
      </Pressable>
      <Animated.View key={`coach-${step}`} entering={FadeInDown.duration(450)} style={styles.card}>
        <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.iconWrap}>
          <Ionicons name={content.icon} size={40} color={colors.accent} />
        </Animated.View>
        <AppText variant="heading2" style={styles.title}>{content.title}</AppText>
        <AppText variant="bodySmall" muted style={styles.message}>{content.message}</AppText>
        <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={`Tip ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, index) => (
            <View key={index} style={[styles.dot, index === step && styles.dotActive]} />
          ))}
        </View>
        <AppButton label={last ? 'Got it' : 'Next'} onPress={next} icon={<Ionicons name="arrow-forward" size={18} color={colors.background} />} />
        {step > 0 && !last ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Previous tip" onPress={() => setStep(step - 1)} style={styles.back}>
            <AppText variant="bodySmall" style={styles.backText}>Back</AppText>
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 50, backgroundColor: 'rgba(4,2,10,0.78)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  skip: { position: 'absolute', top: spacing.lg, right: spacing.xl, minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: '#D2CFDB', fontWeight: '500' },
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing.xl, gap: spacing.md, alignItems: 'center', ...shadows.card },
  iconWrap: { width: 88, height: 88, borderRadius: 28, backgroundColor: 'rgba(168,85,247,0.12)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.35)', alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', lineHeight: 21 },
  dots: { flexDirection: 'row', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotActive: { width: 26, backgroundColor: colors.accent },
  back: { alignItems: 'center', paddingVertical: spacing.xs },
  backText: { color: '#D2CFDB', fontWeight: '500' },
});
