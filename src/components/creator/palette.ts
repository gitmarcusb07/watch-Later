import type { CreatorAccentId, CreatorTheme } from '@/domain/models/creator';

/**
 * Creator Studio palettes. Independent from the app theme: exported slides
 * carry their own dark/light variants and accent choice, while the editor
 * chrome keeps using `src/theme`.
 */

export interface CreatorAccent {
  id: CreatorAccentId;
  label: string;
  primary: string;
  secondary: string;
  /** Contrasting text color for accent-filled chips. */
  ink: string;
}

export const CREATOR_ACCENTS: readonly CreatorAccent[] = [
  { id: 'lavender', label: 'Lavender', primary: '#A855F7', secondary: '#7C3AED', ink: '#FFFFFF' },
  { id: 'coral', label: 'Coral', primary: '#FF7A6B', secondary: '#E23E57', ink: '#2B0A0E' },
  { id: 'gold', label: 'Gold', primary: '#F5C451', secondary: '#D08A00', ink: '#2A1B02' },
  { id: 'mint', label: 'Mint', primary: '#5EEAD4', secondary: '#0F9B86', ink: '#06231E' },
  { id: 'sky', label: 'Sky', primary: '#6AA6FF', secondary: '#2A6BDB', ink: '#071D3A' },
  { id: 'rose', label: 'Rose', primary: '#F472B6', secondary: '#D4378F', ink: '#300A1C' },
];

const ACCENT_BY_ID = new Map<CreatorAccentId, CreatorAccent>(CREATOR_ACCENTS.map((accent) => [accent.id, accent]));

export function creatorAccent(id: CreatorAccentId): CreatorAccent {
  return ACCENT_BY_ID.get(id) ?? CREATOR_ACCENTS[0];
}

export interface CreatorPalette {
  theme: CreatorTheme;
  accent: CreatorAccent;
  background: string;
  /** Soft accent glow for the corner gradient (rgba). */
  glow: string;
  surface: string;
  surfaceBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accentSoft: string;
  /** Bottom-to-top gradient over full-bleed posters, ending on the canvas bg. */
  scrim: readonly [string, string, string, string];
  shadow: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized;
  const value = Number.parseInt(full.slice(0, 6), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function creatorPalette(theme: CreatorTheme, accentId: CreatorAccentId): CreatorPalette {
  const accent = creatorAccent(accentId);
  if (theme === 'light') {
    return {
      theme,
      accent,
      background: '#F6F4FB',
      glow: hexToRgba(accent.primary, 0.28),
      surface: 'rgba(255,255,255,0.92)',
      surfaceBorder: 'rgba(21,14,33,0.10)',
      text: '#151021',
      textSecondary: '#494358',
      textMuted: '#847E96',
      accentSoft: hexToRgba(accent.primary, 0.16),
      scrim: ['rgba(246,244,251,0)', 'rgba(246,244,251,0.86)', 'rgba(246,244,251,0.98)', '#F6F4FB'],
      shadow: 'rgba(21,14,33,0.18)',
    };
  }
  return {
    theme,
    accent,
    background: '#0B0714',
    glow: hexToRgba(accent.primary, 0.34),
    surface: 'rgba(255,255,255,0.07)',
    surfaceBorder: 'rgba(255,255,255,0.14)',
    text: '#FFFFFF',
    textSecondary: '#C7C1D8',
    textMuted: '#8B85A0',
    accentSoft: hexToRgba(accent.primary, 0.16),
    scrim: ['rgba(11,7,20,0)', 'rgba(11,7,20,0.55)', 'rgba(11,7,20,0.94)', '#0B0714'],
    shadow: 'rgba(0,0,0,0.5)',
  };
}
