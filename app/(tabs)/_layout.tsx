import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEpisodeScheduleBackfill } from '@/features/watchState/hooks';

const icons = {
  index: ['home-outline', 'home'],
  upcoming: ['calendar-outline', 'calendar'],
  watchlist: ['bookmark-outline', 'bookmark'],
  watched: ['checkmark-circle-outline', 'checkmark-circle'],
  more: ['grid-outline', 'grid'],
} as const;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // Warms every in-progress show's schedule in the background so the Watching
  // tab can show future episode dates without a spinner on open.
  useEpisodeScheduleBackfill();
  return (
    <Tabs backBehavior="history" screenOptions={({ route }) => ({
      headerShown: false,
      freezeOnBlur: true,
      tabBarHideOnKeyboard: true,
      tabBarActiveTintColor: colors.white,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarLabelStyle: { ...typography.caption, fontSize: 10, marginTop: 2, marginBottom: 3 },
      tabBarStyle: { height: 64 + insets.bottom, backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: Math.max(8, insets.bottom), elevation: 0 },
      tabBarItemStyle: { borderRadius: radius.medium, marginHorizontal: spacing.xs },
      tabBarAccessibilityLabel: `${route.name} tab`,
      tabBarIcon: ({ color, focused, size }) => {
        const pair = icons[route.name as keyof typeof icons];
        return <Ionicons name={pair?.[focused ? 1 : 0] ?? 'ellipse-outline'} size={size + 2} color={color} />;
      },
    })}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="upcoming" options={{ title: 'Upcoming' }} />
      <Tabs.Screen name="watchlist" options={{ title: 'Watchlist' }} />
      <Tabs.Screen name="watched" options={{ title: 'Watched' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
