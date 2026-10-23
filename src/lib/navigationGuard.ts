import { router } from 'expo-router';

/**
 * Double taps are a fact of phones: a slow first paint makes people tap a
 * card twice, and Expo Router happily pushes the same screen twice. The
 * second push is invisible at first, then the user has to press back twice.
 *
 * This guard is installed once at app start and wraps the imperative router
 * so a repeat push to the same target inside `TAP_WINDOW_MS` is swallowed.
 * Pushes to a different target still go through immediately, so normal rapid
 * navigation (for example opening another card) is never blocked.
 */
const TAP_WINDOW_MS = 800;
const BACK_WINDOW_MS = 600;

export type TapGuard = (key: string, now?: number) => boolean;

export function createTapGuard(windowMs: number): TapGuard {
  let lastKey: string | null = null;
  let lastAt = 0;
  return (key, now = Date.now()) => {
    if (key === lastKey && now - lastAt < windowMs) return false;
    lastKey = key;
    lastAt = now;
    return true;
  };
}

/** Stable-enough key for a router target (string or `{ pathname, params }`). */
export function navigationTargetKey(href: unknown): string {
  if (typeof href === 'string') return href;
  if (!href || typeof href !== 'object') return String(href);
  const target = href as { pathname?: unknown; params?: unknown };
  const pathname = typeof target.pathname === 'string' ? target.pathname : '';
  const params = target.params && typeof target.params === 'object'
    ? Object.entries(target.params as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
        .join('&')
    : '';
  return params ? `${pathname}?${params}` : pathname;
}

let installed = false;

export function installNavigationGuard(): void {
  if (installed) return;
  installed = true;

  const allowPush = createTapGuard(TAP_WINDOW_MS);
  const allowBack = createTapGuard(BACK_WINDOW_MS);
  const originalPush = router.push;
  const originalBack = router.back;

  router.push = ((href: Parameters<typeof router.push>[0], options?: Parameters<typeof router.push>[1]) => {
    if (!allowPush(navigationTargetKey(href))) return;
    originalPush(href, options);
  }) as typeof router.push;

  router.back = (() => {
    if (!allowBack('back')) return;
    originalBack();
  }) as typeof router.back;
}
