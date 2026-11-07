import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { openURL } from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { PosterBackdrop } from '@/components/onboarding/PosterBackdrop';
import { SupabaseAuthService } from '@/features/auth/SupabaseAuthService';
import { PRIVACY_POLICY_URL } from '@/lib/legal';
import { showFriendlyError } from '@/lib/friendlyError';
import { colors, radius, shadows, spacing } from '@/theme';
import { persistSession } from '@/store/app/sessionPersistence';
import { useSessionStore } from '@/store/app/sessionStore';

const authService = new SupabaseAuthService();

const HERO_POSTERS = [
  { uri: 'https://image.tmdb.org/t/p/w342/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', label: 'Dune: Part Two' },
  { uri: 'https://image.tmdb.org/t/p/w342/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', label: 'Spirited Away' },
  { uri: 'https://image.tmdb.org/t/p/w342/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', label: 'Breaking Bad' },
];

interface TourPage {
  eyebrow: string;
  titleA: string;
  titleB: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  visual: 'posters' | 'medallion';
}

const PAGES: TourPage[] = [
  {
    eyebrow: 'WATCH LATER',
    titleA: 'Stories worth',
    titleB: 'remembering.',
    description: 'Track what you want to watch and remember everything you’ve watched.',
    icon: 'bookmark',
    visual: 'posters',
  },
  {
    eyebrow: 'YOUR WATCHLIST',
    titleA: 'Save it',
    titleB: 'for later.',
    description: 'Bookmark movies, shows and anime into your watchlist, in the order you want them.',
    icon: 'bookmark',
    visual: 'medallion',
  },
  {
    eyebrow: 'SEASONS & EPISODES',
    titleA: 'Pick up where',
    titleB: 'you stopped.',
    description: 'Track series season by season and episode by episode — progress, rewatch counts and all.',
    icon: 'tv',
    visual: 'medallion',
  },
  {
    eyebrow: 'BROWSE & DISCOVER',
    titleA: 'Find what’s',
    titleB: 'next.',
    description: 'Browse upcoming releases, franchises in order, new arrivals and all-time top lists.',
    icon: 'compass',
    visual: 'medallion',
  },
];

function FloatingPoster({ uri, label, rotate, size, delay, duration, distance, enterDelay }: {
  uri: string;
  label: string;
  rotate: string;
  size: { width: number; height: number };
  delay: number;
  duration: number;
  distance: number;
  enterDelay: number;
}) {
  const [failed, setFailed] = useState(false);
  const bob = useSharedValue(0);

  useEffect(() => {
    bob.value = withDelay(
      delay,
      withRepeat(withTiming(-distance, { duration, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [bob, delay, distance, duration]);

  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));

  return (
    <Animated.View entering={FadeIn.delay(enterDelay).duration(600)} style={[{ transform: [{ rotate }] }]}>
      <Animated.View style={[styles.poster, size, bobStyle]} accessibilityLabel={label}>
        {failed ? (
          <LinearGradient colors={['#3B2A63', '#1B1233']} style={[StyleSheet.absoluteFill, styles.posterFallback]}>
            <Ionicons name="film-outline" size={30} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        ) : (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
        )}
        <LinearGradient colors={['transparent', 'rgba(7,3,18,0.55)']} style={styles.posterShade} />
      </Animated.View>
    </Animated.View>
  );
}

function GlowOrb() {
  const glow = useSharedValue(0.55);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View pointerEvents="none" style={[styles.orb, style]} />;
}

export default function WelcomeScreen() {
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const { setSession, setOnboardingComplete } = useSessionStore();
  const last = page === PAGES.length - 1;
  const content = PAGES[page];

  async function finish() {
    setLoading(true);
    try {
      const session = await authService.continueAsGuest();
      await persistSession(session, true);
      setSession(session);
      setOnboardingComplete(true);
      router.replace('/(tabs)');
    } catch (cause) {
      // A prompt, not a line of text nobody notices under the buttons.
      await showFriendlyError(cause, 'Couldn’t start', { message: 'We couldn’t open your library. Your data is safe — please try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <PosterBackdrop rowCount={3} opacity={0.5} />

      <Animated.View key={`hero-${page}`} entering={FadeInUp.duration(650)} style={styles.hero}>
        <GlowOrb />
        {content.visual === 'posters' ? (
          <View style={styles.fan}>
            <FloatingPoster uri={HERO_POSTERS[0].uri} label={HERO_POSTERS[0].label} rotate="-10deg" size={styles.posterSide} delay={200} duration={3400} distance={10} enterDelay={120} />
            <FloatingPoster uri={HERO_POSTERS[1].uri} label={HERO_POSTERS[1].label} rotate="0deg" size={styles.posterCenter} delay={0} duration={3000} distance={12} enterDelay={0} />
            <FloatingPoster uri={HERO_POSTERS[2].uri} label={HERO_POSTERS[2].label} rotate="10deg" size={styles.posterSide} delay={500} duration={3700} distance={9} enterDelay={240} />
          </View>
        ) : (
          <View style={styles.medallionWrap}>
            <Animated.View entering={FadeIn.delay(120).duration(600)} style={styles.medallionRing}>
              <View style={styles.medallion}>
                <Ionicons name={content.icon} size={64} color={colors.accent} />
              </View>
            </Animated.View>
          </View>
        )}
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}><Ionicons name="bookmark" size={18} color={colors.background} /></View>
          <AppText variant="label" style={styles.brand}>watch Later</AppText>
        </View>
        <View style={styles.badge}><Ionicons name="sparkles" size={13} color={colors.accent} /><AppText variant="caption" style={styles.badgeText}>MOVIES · SHOWS · ANIME</AppText></View>
      </Animated.View>

      <Animated.View key={`copy-${page}`} entering={FadeInDown.delay(160).duration(700)} style={styles.copy}>
        <AppText variant="caption" style={styles.eyebrow}>{content.eyebrow}</AppText>
        <AppText variant="display" style={styles.title}>{content.titleA}{'\n'}<AppText variant="display" style={styles.titleAccent}>{content.titleB}</AppText></AppText>
        <AppText variant="body" muted style={styles.description}>{content.description}</AppText>
        <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
          {PAGES.map((_, index) => (
            <View key={index} style={[styles.dot, index === page && styles.dotActive]} />
          ))}
        </View>
      </Animated.View>

      <Animated.View key={`actions-${page}`} entering={FadeInDown.delay(300).duration(700)} style={styles.actions}>
        {last ? (
          <AppButton label="Start watching" onPress={() => void finish()} loading={loading} icon={<Ionicons name="arrow-forward" size={19} color={colors.background} />} />
        ) : (
          <AppButton label="Next" onPress={() => setPage(page + 1)} icon={<Ionicons name="arrow-forward" size={19} color={colors.background} />} />
        )}
        {last ? null : (
          <View style={styles.secondaryRow}>
            {page > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => setPage(page - 1)} style={styles.secondaryButton}>
                <AppText variant="bodySmall" style={styles.secondaryText}>Back</AppText>
              </Pressable>
            ) : <View style={styles.secondarySpacer} />}
            <Pressable accessibilityRole="button" accessibilityLabel="Skip tour" onPress={() => void finish()} style={styles.secondaryButton}>
              <AppText variant="bodySmall" style={styles.secondaryText}>Skip</AppText>
            </Pressable>
          </View>
        )}
        <View style={styles.privacy}><Ionicons name="lock-closed-outline" size={13} color={colors.textMuted} /><Pressable accessibilityRole="button" accessibilityLabel="Read our privacy policy" onPress={() => void openURL(PRIVACY_POLICY_URL)}><AppText variant="caption" muted style={styles.privacyText}>Your collection stays yours</AppText></Pressable></View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md, overflow: 'hidden' },
  hero: { height: '46%', minHeight: 300, maxHeight: 420, justifyContent: 'flex-end' },
  orb: { position: 'absolute', top: 24, left: '18%', width: 260, height: 240, borderRadius: 160, backgroundColor: 'rgba(168,85,247,0.16)' },
  fan: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.xl },
  poster: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(236,221,255,0.4)', backgroundColor: '#241A3D', ...shadows.card },
  posterSide: { width: 96, height: 140, marginBottom: 14 },
  posterCenter: { width: 122, height: 178, borderColor: 'rgba(242,229,255,0.55)' },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  posterShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 64 },
  medallionWrap: { flexDirection: 'row', justifyContent: 'center', paddingTop: spacing.xl },
  medallionRing: { padding: 10, borderRadius: 58, borderWidth: 1, borderColor: 'rgba(168,85,247,0.35)', backgroundColor: 'rgba(168,85,247,0.08)' },
  medallion: { width: 168, height: 168, borderRadius: 48, backgroundColor: 'rgba(22,22,28,0.94)', borderWidth: 1, borderColor: 'rgba(236,221,255,0.4)', alignItems: 'center', justifyContent: 'center', ...shadows.card },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  brandIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  brand: { letterSpacing: 2.4, color: '#E9E2F5', fontSize: 11 },
  badge: { position: 'absolute', top: spacing.xl, right: 0, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', backgroundColor: 'rgba(15,15,23,0.62)', paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.pill, borderColor: 'rgba(255,255,255,0.13)', borderWidth: 1 },
  badgeText: { color: '#F0EAFB', fontSize: 10, letterSpacing: 1.1, fontWeight: '600' },
  copy: { flex: 1, justifyContent: 'center', paddingTop: spacing.md },
  eyebrow: { color: colors.accent, letterSpacing: 2.4 },
  title: { fontSize: 37, lineHeight: 43, letterSpacing: -1.4 },
  titleAccent: { color: colors.accent },
  description: { maxWidth: 310, marginTop: spacing.md, color: '#AAA9B7', lineHeight: 23 },
  dots: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotActive: { width: 26, backgroundColor: colors.accent },
  actions: { paddingBottom: spacing.md, gap: spacing.sm },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secondaryButton: { minHeight: 44, minWidth: 96, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  secondarySpacer: { minWidth: 96 },
  secondaryText: { color: '#D2CFDB', fontWeight: '500' },
  privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  privacyText: { color: colors.textMuted, fontSize: 11 },
});
