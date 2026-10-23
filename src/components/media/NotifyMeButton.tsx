import { Animated, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from '@/components/common/AppText';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import type { CatalogMedia } from '@/domain/models/media';
import { useInterestedMutation, useInterestedStatus } from '@/features/watchState/hooks';
import { setUpcomingReminder } from '@/features/notifications/upcomingReminders';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { usePressMotion } from '@/lib/pressMotion';
import { actionPalette } from '@/theme/actionPalette';
import { colors, radius, spacing } from '@/theme';

/**
 * Bell + short label for upcoming titles ("Notify me on release"). Tapping
 * flips the interest mark instantly and arms (or cancels) the branded
 * release-day alert.
 */
export function NotifyMeButton({ media }: { media: CatalogMedia }) {
  const identity = { provider: media.provider, mediaType: media.mediaType, providerId: media.providerId } as const;
  const status = useInterestedStatus(identity);
  const mutation = useInterestedMutation(media, status.data ?? false);
  const active = status.data ?? false;
  const palette = actionPalette('notify');
  const motion = usePressMotion('wobble', 0.96);

  async function toggle() {
    if (status.isLoading || mutation.isPending) return;
    const next = !active;
    triggerLightHaptic();
    mutation.mutate(undefined, {
      onSuccess: () => {
        void setUpcomingReminder(media, next).then((result) => {
          if (result.status === 'scheduled') {
            triggerSuccessHaptic();
            showToast('We’ll notify you on release day', 'success');
          } else if (result.status === 'saved') {
            showToast('Marked interested', 'info');
          } else if (result.status === 'denied') {
            void showDialog({ type: 'warning', title: 'Notifications are blocked', message: 'Your interest is saved, but the release alert can’t appear until notifications are allowed in system settings.' });
          } else if (result.status === 'unavailable') {
            void showDialog({
              type: 'error',
              title: 'Couldn’t set the reminder',
              message: result.reason === 'expo-go'
                ? 'You’re previewing in Expo Go, which can’t fire reminder alerts. Your interest is saved — open this project in the Watch Later dev build and tap the bell again to arm the alert.'
                : 'Your interest is saved. Please try the reminder again later.',
            });
          } else {
            showToast('Release reminder removed', 'info');
          }
        });
      },
    });
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `Stop notifying about ${media.title}` : `Notify me about ${media.title} on release`}
      accessibilityState={{ selected: active, busy: mutation.isPending, disabled: status.isLoading }}
      onPress={() => { motion.play(); void toggle(); }}
      onPressIn={motion.pressIn}
      onPressOut={motion.pressOut}
      disabled={status.isLoading || mutation.isPending}
      style={({ pressed }) => [styles.button, { borderColor: active ? palette.color : palette.border, backgroundColor: active ? 'transparent' : palette.soft }, pressed && styles.pressed]}
    >
      {active ? <LinearGradient colors={palette.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} /> : null}
      <Animated.View style={[styles.content, motion.pressMotionStyle]}>
        <Ionicons name={active ? 'notifications' : 'notifications-outline'} size={17} color={active ? palette.onColor : palette.color} />
        <AppText variant="button" style={[styles.label, { color: active ? palette.onColor : palette.color }]} numberOfLines={1}>
          {active ? 'Reminder on' : 'Notify me on release'}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 50, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, marginTop: spacing.md,
    overflow: 'hidden',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { color: colors.accent, fontSize: 14 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
