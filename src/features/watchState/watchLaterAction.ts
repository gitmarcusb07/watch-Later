import type { ActionMotion } from '@/lib/pressMotion';
import type { ActionTone } from '@/theme/actionPalette';
import type { WatchPriority } from '@/domain/models/watchState';
import { PRIORITY_META } from './priority';

const PRIORITY_MOTION: Record<WatchPriority, ActionMotion> = {
  asap: 'launch',
  weekend: 'bounce',
  someday: 'float',
};

export interface WatchLaterActionPresentation {
  label: string;
  icon: string;
  activeIcon: string;
  tone: ActionTone;
  motion: ActionMotion;
  accessibilityLabel: string;
}

/**
 * The Watch Later pill normally shows the saved priority. Once a show has
 * episode progress, the priority is no longer the most useful label: the user
 * is actively watching it, so the pill becomes a blue "Watching now" status
 * while still opening the priority sheet.
 */
export function getWatchLaterActionPresentation(input: {
  saved: boolean;
  priority: WatchPriority | null;
  watching: boolean;
}): WatchLaterActionPresentation {
  if (input.saved && input.watching) {
    return {
      label: 'Watching now',
      icon: 'play-circle',
      activeIcon: 'play-circle',
      tone: 'watching',
      motion: 'pulse',
      accessibilityLabel: 'Currently watching. Open Watch Later options',
    };
  }

  if (input.saved && input.priority) {
    const meta = PRIORITY_META[input.priority];
    return {
      label: meta.label,
      icon: meta.icon,
      activeIcon: 'checkmark',
      tone: input.priority,
      motion: PRIORITY_MOTION[input.priority],
      accessibilityLabel: `Watch Later priority ${meta.label}. Open Watch Later options`,
    };
  }

  if (input.saved) {
    return {
      label: 'Watchlisted',
      icon: 'bookmark',
      activeIcon: 'checkmark',
      tone: 'watch-later',
      motion: 'pop',
      accessibilityLabel: 'Saved to Watch Later. Open Watch Later options',
    };
  }

  return {
    label: 'Watch Later',
    icon: 'time-outline',
    activeIcon: 'checkmark',
    tone: 'watch-later',
    motion: 'pop',
    accessibilityLabel: 'Open watch later options',
  };
}
