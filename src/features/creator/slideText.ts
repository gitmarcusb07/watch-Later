import type { CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';

/**
 * Pure text formatting for slide canvases. Dates are presented exactly as the
 * provider reported them: a `YYYY-MM-DD` value renders a real date, a
 * year-only value renders the year, and a missing value renders nothing (the
 * upcoming template substitutes an explicit "TBA" itself — never a guess).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_ONLY = /^\d{4}$/;

export function formatSlideDate(value?: string): string | undefined {
  if (!value) return undefined;
  if (YEAR_ONLY.test(value)) return value;
  const match = DATE_ONLY.exec(value);
  if (!match) return undefined;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (day > new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate()) return undefined;
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}

/** Day/month split for the upcoming-release date pill. */
export function splitSlideDate(value?: string): { top: string; bottom: string } | undefined {
  if (!value) return undefined;
  const full = DATE_ONLY.exec(value);
  if (full) {
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (month < 1 || month > 12) return undefined;
    return { top: String(day), bottom: MONTHS[month - 1].toUpperCase() };
  }
  if (YEAR_ONLY.test(value)) return { top: value, bottom: 'YEAR' };
  return undefined;
}

export function formatSlideRating(value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return `★ ${value.toFixed(1)}`;
}

export function seasonsLabel(count?: number): string | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return count === 1 ? '1 Season' : `${count} Seasons`;
}

/** Media-type label used on list rows. */
export function mediaTypeLabel(ref: CreatorTitleRef): string {
  return ref.mediaType === 'movie' ? 'Movie' : ref.mediaType === 'series' ? 'Series' : 'Anime';
}

/**
 * The single meta line under a spotlight title, honoring the slide's metadata
 * toggles. Date wins over year (they say the same thing), rating and genres
 * follow in that order.
 */
export function spotlightMeta(ref: CreatorTitleRef | undefined, slide: CreatorSlide): string | undefined {
  if (!ref) return undefined;
  const parts: string[] = [];
  const date = slide.showReleaseDate ? formatSlideDate(ref.releaseDate) : undefined;
  if (date) parts.push(date);
  else if (ref.year && slide.showReleaseDate) parts.push(String(ref.year));
  if (slide.showRating) {
    const rating = formatSlideRating(ref.rating);
    if (rating) parts.push(rating);
  }
  if (slide.showGenres && ref.genres.length) parts.push(ref.genres.join(' · '));
  return parts.length ? parts.join('   ·   ') : undefined;
}

/** Compact meta for list rows: year, rating, and one genre at most. */
export function rowMeta(ref: CreatorTitleRef, slide: CreatorSlide, options?: { dateInsteadOfYear?: boolean }): string | undefined {
  const parts: string[] = [];
  if (slide.showReleaseDate) {
    const date = (options?.dateInsteadOfYear ? formatSlideDate(ref.releaseDate) : undefined) ?? (ref.year ? String(ref.year) : undefined);
    if (date) parts.push(date);
  }
  if (slide.showRating) {
    const rating = formatSlideRating(ref.rating);
    if (rating) parts.push(rating);
  }
  if (slide.showGenres && ref.genres[0]) parts.push(ref.genres[0]);
  return parts.length ? parts.join(' · ') : undefined;
}

/** "NOW STREAMING ON" row support: names only, from live provider snapshots. */
export function streamingProviders(ref: CreatorTitleRef | undefined, slide: CreatorSlide): string[] | undefined {
  if (!ref || !slide.showProviders) return undefined;
  if (!ref.providers?.length) return undefined;
  return ref.providers.slice(0, 3);
}
