import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Haptics from "expo-haptics";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { queryClient } from "@/lib/query/queryClient";
import { installNavigationGuard } from "@/lib/navigationGuard";
import { colors } from "@/theme";
import { logger } from "@/lib/logger";
import { hydrateSession, persistSession } from "@/store/app/sessionPersistence";
import { useSessionStore } from "@/store/app/sessionStore";
import { useSyncStore } from "@/store/app/syncStore";
import { useAppearanceStore } from "@/store/app/appearanceStore";
import { useNotificationStore } from "@/store/app/notificationStore";
import { useRatingSettings } from "@/store/app/ratingSettings";
import { useTvPreferences } from "@/store/app/tvPreferences";
import { SqliteDatabaseRepository } from "@/data/local/repositories/SqliteDatabaseRepository";
import { LoadingView } from "@/components/feedback/FeedbackViews";
import SplashScreenView from "@/components/SplashScreen";
import { AppErrorBoundary } from "@/components/feedback/AppErrorBoundary";
import { DialogProvider } from "@/components/feedback/AppDialog";
import { supabase } from "@/data/remote/supabase/client";
import {
  handleAutoSyncForeground,
  scheduleAutoSync,
  startAutoSync,
} from "@/features/sync/autoSync";
import {
  refreshRemindersOnForeground,
  setupNotificationHandler,
} from "@/features/notifications/scheduler";
import { Notifications } from "@/lib/notifications";
import notifee from "@notifee/react-native";
import "@/features/notifications/releaseDayBackground";
import { refreshOttReminders } from "@/features/ott/ottReminders";
import {
  ensureReleasesChannel,
  handleMoveToAsap,
  interpretReleaseDayEvent,
  isReleaseDayData,
  refreshUpcomingReminders,
  resolveNotificationTarget,
} from "@/features/notifications/upcomingReminders";
import { watchStateRepository, watchStateSyncRepository } from "@/data/local/repositories/SqliteWatchStateRepository";
import { ClerkSupabaseBridge } from "@/features/auth/ClerkSupabaseBridge";
import { isAuthFlowInFlight } from "@/features/auth/SupabaseAuthService";
import { showFriendlyError } from "@/lib/friendlyError";
import {
  isLocalLibraryPrepFailure,
  LOCAL_LIBRARY_PREP_NOTICE,
  LOCAL_LIBRARY_PREP_TITLE,
} from "@/lib/localLibraryNotice";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

if (!publishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Add your key to .env.\nRun: 1) clerk auth login  2) clerk link  3) clerk env pull — then restart the dev server.",
  );
}

const database = new SqliteDatabaseRepository();

// One-time router wrapper: double taps on cards/buttons must open a screen once.
installNavigationGuard();

// Keep the native splash up until the JS splash has rendered its first frame.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Cold start only: foreground resumes never remount the root layout, and this
// guard also keeps Fast Refresh from replaying the splash in development.
let splashShownThisLaunch = false;

export default function RootLayout() {
  const hydrated = useSessionStore((state) => state.hasHydrated);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [splashDone, setSplashDone] = useState(splashShownThisLaunch);
  const nativeHidden = useRef(false);

  // Native splash → animated splash handoff (same logo + background, no flicker).
  const handleRootLayout = () => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  };

  useEffect(() => {
    setupNotificationHandler();
    void ensureReleasesChannel();
    void hydrateSession();
    void useAppearanceStore.getState().hydrate();
    void useNotificationStore.getState().hydrate();
    void useRatingSettings.getState().hydrate();
    void useTvPreferences.getState().hydrate();
    void database
      .initialize()
      .then(async () => {
        // Older builds marked future weekly episodes when finishing a show.
        // Repair once before the UI reads progress so those titles no longer
        // appear completed; the queue keeps sync from restoring them.
        try {
          await watchStateRepository.repairUnairedEpisodeWatches();
        } catch (error) {
          logger.error("Episode progress repair failed", error);
        }
        setDatabaseReady(true);
      })
      .catch((error: unknown) => {
        logger.error("Database startup failed", error);
        setStartupError(true);
      });
  }, []);

  useEffect(() => {
    const authClient = supabase;
    if (!authClient) return;
    const { data: subscription } = authClient.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          const authenticated = {
            mode: "authenticated" as const,
            userId: session.user.id,
            email: session.user.email ?? "",
          };
          setTimeout(() => {
            void watchStateSyncRepository
              .bindAccount(session.user.id)
              .then(async () => {
                const current = useSessionStore.getState();
                current.setSession(authenticated);
                await persistSession(authenticated, current.onboardingComplete);
                // Only a NEW sign-in starts from a clean sync slate. A token
                // refresh (hourly, and on foreground) re-attests the same
                // account — resetting there masked a real 'pending'/'error'
                // status the profile screen must keep showing until the next
                // sync attempt (which auto-sync may still owe behind backoff).
                if (event === "SIGNED_IN") useSyncStore.getState().reset();
                if (
                  event === "SIGNED_IN" ||
                  event === "INITIAL_SESSION" ||
                  event === "TOKEN_REFRESHED"
                )
                  scheduleAutoSync("auth");
              })
              .catch((error: unknown) => {
                // Never force a sign-out here. The auth screens own device-link
                // recovery ("Clear & continue") with the session kept alive;
                // ripping the session out from under them leaves the app
                // showing an account with no live Supabase session — which sync
                // then reports as "Sign in again to sync this library".
                logger.error("Account binding failed during auth event", error);
                // "Couldn't prepare this account's local library." must never
                // pass silently (prompt rule). While an interactive sign-in /
                // sign-up / Google flow is running, that flow's own screen
                // already reports the same failure — stay quiet here so the
                // user gets ONE prompt, not two.
                if (!isAuthFlowInFlight() && isLocalLibraryPrepFailure(error)) {
                  // Same title + copy as the auth screen's notice dialog, so
                  // showFriendlyError collapses any overlap into ONE prompt.
                  void showFriendlyError(error, LOCAL_LIBRARY_PREP_TITLE, {
                    message: LOCAL_LIBRARY_PREP_NOTICE,
                  });
                }
              });
          }, 0);
        } else if (event === "SIGNED_OUT") {
          // A Clerk session has no Supabase session behind it: INITIAL_SESSION
          // (null) and sign-outs of the untouched Supabase client must never
          // flip a Clerk user back to guest.
          const current = useSessionStore.getState().session;
          if (current.mode !== "authenticated" || current.provider === "clerk") return;
          const store = useSessionStore.getState();
          const guest = {
            mode: "guest" as const,
            userId: `guest-${Date.now()}`,
          };
          store.setSession(guest);
          useSyncStore.getState().reset();
          void persistSession(guest, store.onboardingComplete);
        }
      },
    );
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void queryClient.resumePausedMutations();
        const session = useSessionStore.getState().session;
        if (session.mode === "authenticated") handleAutoSyncForeground();
        void refreshRemindersOnForeground();
        void refreshOttReminders();
        void refreshUpcomingReminders();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => startAutoSync(), []);

  // expo-notifications taps (OTT premieres + watchlist reminders). Guarded:
  // Expo Go has no native notification module, so subscribing must never
  // crash startup.
  useEffect(() => {
    try {
      const subscription =
        Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as {
            route?: string;
            mediaId?: string;
          } | null;
          const target = resolveNotificationTarget(data);
          if (target) router.replace(target);
        });
      return () => subscription.remove();
    } catch {
      return undefined;
    }
  }, []);

  // Release-day taps + "Move to ASAP" via Notifee (foreground). The action
  // button carries no launchActivity, so it never opens the app — it saves
  // to ASAP and dismisses. Guarded for Expo Go like above.
  useEffect(() => {
    try {
      return notifee.onForegroundEvent(async ({ type, detail }) => {
        const outcome = interpretReleaseDayEvent({ type, detail });
        if (outcome.kind === "open") {
          router.replace({
            pathname: "/media/[id]",
            params: { id: outcome.mediaId },
          });
        } else if (outcome.kind === "move") {
          await handleMoveToAsap({
            data: outcome.data,
            notificationId: outcome.notificationId,
          });
        }
      });
    } catch {
      return undefined;
    }
  }, []);

  // Killed-state body tap: Notifee opens the app; route to the title once the
  // initial notification is consumed. Action presses never open the app, so
  // anything initial here is always a body tap.
  useEffect(() => {
    void (async () => {
      try {
        const initial = await notifee.getInitialNotification();
        const data: unknown = initial?.notification?.data ?? null;
        if (isReleaseDayData(data)) {
          router.replace({
            pathname: "/media/[id]",
            params: { id: data.mediaId },
          });
        }
      } catch {
        // No native module or no initial notification: nothing to route.
      }
    })();
  }, []);

  // Ready = local init only (session restore + SQLite). Network sync always runs in the background.
  const appReady = hydrated && (databaseReady || startupError);

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkSupabaseBridge />
      <AppErrorBoundary>
        <GestureHandlerRootView style={styles.root} onLayout={handleRootLayout}>
          <DialogProvider>
            <SafeAreaProvider>
              <QueryClientProvider client={queryClient}>
                <StatusBar style="light" />
                {appReady ? (
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.background },
                      animation: "slide_from_right",
                    }}
                  >
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(onboarding)/welcome" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen
                      name="(auth)/login"
                      options={{ presentation: "modal" }}
                    />
                    <Stack.Screen
                      name="(auth)/create-account"
                      options={{ presentation: "modal" }}
                    />
                  </Stack>
                ) : (
                  <View style={styles.startup}>
                    <LoadingView label="Getting things ready" />
                  </View>
                )}
                {!splashDone ? (
                  <SplashScreenView
                    isReady={appReady}
                    minDuration={3500}
                    onClap={() =>
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
                    }
                    onFinish={() => {
                      splashShownThisLaunch = true;
                      setSplashDone(true);
                    }}
                  />
                ) : null}
              </QueryClientProvider>
            </SafeAreaProvider>
          </DialogProvider>
        </GestureHandlerRootView>
      </AppErrorBoundary>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070312" },
  startup: { flex: 1, backgroundColor: colors.background },
});
