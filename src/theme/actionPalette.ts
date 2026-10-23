import type { ActionMotion } from '@/lib/pressMotion';

/**
 * Every media action has its own colour identity. The primary state colours
 * (Mark as Watched / Watching / Watched / upcoming) and the three Watch Later
 * priorities are deliberately separated so a glance is enough to tell what a
 * control will do.
 */
export type ActionTone =
  | 'mark-watched'
  | 'watching'
  | 'watched'
  | 'upcoming'
  | 'watch-later'
  | 'asap'
  | 'weekend'
  | 'someday'
  | 'favorite'
  | 'share'
  | 'trailer'
  | 'notify'
  | 'remove'
  | 'imdb'
  | 'neutral';

export interface ActionPalette {
  color: string;
  soft: string;
  border: string;
  gradient: readonly [string, string];
  /** Text/icon colour for a filled gradient surface. */
  onColor: string;
  motion: ActionMotion;
}

export const ACTION_PALETTES: Record<ActionTone, ActionPalette> = {
  'mark-watched': {
    color: '#2DD4BF',
    soft: 'rgba(45,212,191,0.13)',
    border: 'rgba(45,212,191,0.42)',
    gradient: ['#14B8A6', '#0F766E'],
    onColor: '#FFFFFF',
    motion: 'pop',
  },
  watching: {
    color: '#60A5FA',
    soft: 'rgba(96,165,250,0.13)',
    border: 'rgba(96,165,250,0.42)',
    gradient: ['#3B82F6', '#1D4ED8'],
    onColor: '#FFFFFF',
    motion: 'pulse',
  },
  watched: {
    color: '#4ADE80',
    soft: 'rgba(74,222,128,0.13)',
    border: 'rgba(74,222,128,0.42)',
    gradient: ['#22C55E', '#15803D'],
    onColor: '#FFFFFF',
    motion: 'bounce',
  },
  upcoming: {
    color: '#FBBF24',
    soft: 'rgba(251,191,36,0.13)',
    border: 'rgba(251,191,36,0.42)',
    gradient: ['#F59E0B', '#B45309'],
    onColor: '#FFFFFF',
    motion: 'wobble',
  },
  'watch-later': {
    color: '#C084FC',
    soft: 'rgba(192,132,252,0.12)',
    border: 'rgba(192,132,252,0.40)',
    gradient: ['#C084FC', '#7C3AED'],
    onColor: '#FFFFFF',
    motion: 'pop',
  },
  asap: {
    color: '#FF8A4C',
    soft: 'rgba(255,138,76,0.13)',
    border: 'rgba(255,138,76,0.44)',
    gradient: ['#FB923C', '#EA580C'],
    onColor: '#FFFFFF',
    motion: 'launch',
  },
  weekend: {
    color: '#F5C66E',
    soft: 'rgba(245,198,110,0.14)',
    border: 'rgba(245,198,110,0.46)',
    gradient: ['#FBBF24', '#CA8A04'],
    onColor: '#1C1405',
    motion: 'bounce',
  },
  someday: {
    color: '#7AC7E3',
    soft: 'rgba(122,199,227,0.13)',
    border: 'rgba(122,199,227,0.42)',
    gradient: ['#67E8F9', '#0284C7'],
    onColor: '#FFFFFF',
    motion: 'float',
  },
  favorite: {
    color: '#FB7185',
    soft: 'rgba(251,113,133,0.13)',
    border: 'rgba(251,113,133,0.44)',
    gradient: ['#FB7185', '#BE123C'],
    onColor: '#FFFFFF',
    motion: 'heartbeat',
  },
  share: {
    color: '#60A5FA',
    soft: 'rgba(96,165,250,0.15)',
    border: 'rgba(96,165,250,0.46)',
    gradient: ['#60A5FA', '#2563EB'],
    onColor: '#FFFFFF',
    motion: 'pop',
  },
  trailer: {
    color: '#FB923C',
    soft: 'rgba(251,146,60,0.15)',
    border: 'rgba(251,146,60,0.46)',
    gradient: ['#FB923C', '#C2410C'],
    onColor: '#FFFFFF',
    motion: 'pulse',
  },
  notify: {
    color: '#FACC15',
    soft: 'rgba(250,204,21,0.13)',
    border: 'rgba(250,204,21,0.44)',
    gradient: ['#FACC15', '#CA8A04'],
    onColor: '#1C1405',
    motion: 'wobble',
  },
  remove: {
    color: '#F87171',
    soft: 'rgba(248,113,113,0.12)',
    border: 'rgba(248,113,113,0.42)',
    gradient: ['#F87171', '#B91C1C'],
    onColor: '#FFFFFF',
    motion: 'shake',
  },
  imdb: {
    color: '#EAB308',
    soft: 'rgba(234,179,8,0.13)',
    border: 'rgba(234,179,8,0.44)',
    gradient: ['#FACC15', '#A16207'],
    onColor: '#1C1405',
    motion: 'bounce',
  },
  neutral: {
    color: '#C084FC',
    soft: 'rgba(192,132,252,0.12)',
    border: 'rgba(192,132,252,0.38)',
    gradient: ['#C084FC', '#7C3AED'],
    onColor: '#FFFFFF',
    motion: 'pop',
  },
};

export function actionPalette(tone: ActionTone = 'neutral'): ActionPalette {
  return ACTION_PALETTES[tone];
}
