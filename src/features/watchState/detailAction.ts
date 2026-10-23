import type { ActionMotion } from '@/lib/pressMotion';
import type { ActionTone } from '@/theme/actionPalette';
import type { CatalogMedia } from '@/domain/models/media';

export type DetailPrimaryIcon = 'eye' | 'eye-outline' | 'calendar-outline' | 'play-circle';

export interface DetailPrimaryAction {
  label: string;
  icon: DetailPrimaryIcon;
  tone: ActionTone;
  motion: ActionMotion;
  active: boolean;
  /** Tapping Watching reverses progress and returns the title to Mark as Watched. */
  clearsProgress: boolean;
}

interface DetailPrimaryActionInput {
  mediaType: CatalogMedia['mediaType'];
  upcoming: boolean;
  releaseLabel?: string;
  watched?: boolean;
  tracking: boolean;
}

/**
 * One primary action per title state. A weekly show with some aired episodes
 * watched is "Watching", not "Watched" and no longer offers a redundant
 * "Mark as Watched" tap; only a complete series earns the green Watched state.
 */
export function getDetailPrimaryAction(input: DetailPrimaryActionInput): DetailPrimaryAction {
  if (input.upcoming) {
    return {
      label: input.releaseLabel ? `Coming ${input.releaseLabel}` : 'Not released yet',
      icon: 'calendar-outline',
      tone: 'upcoming',
      motion: 'wobble',
      active: false,
      clearsProgress: false,
    };
  }
  if (input.watched) {
    return { label: 'Watched', icon: 'eye', tone: 'watched', motion: 'bounce', active: true, clearsProgress: false };
  }
  if (input.mediaType !== 'movie' && input.tracking) {
    return { label: 'Watching', icon: 'play-circle', tone: 'watching', motion: 'pulse', active: false, clearsProgress: true };
  }
  return { label: 'Mark as Watched', icon: 'eye-outline', tone: 'mark-watched', motion: 'pop', active: false, clearsProgress: false };
}
