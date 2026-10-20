import type { CatalogMediaType, MediaIdentity, MediaProvider } from './media';

/**
 * Creator Studio domain: Instagram-ready posts and carousels built from the
 * app's own catalog metadata. Projects are validated plain data (stored as
 * versioned JSON on-device) so drafts never depend on a live catalog fetch
 * and a malformed row can never crash the editor.
 */

export const CREATOR_TEMPLATE_IDS = [
  'collage-cover',
  'stacked-ranking',
  'page-promo',
  'movie-spotlight',
  'series-spotlight',
  'top5',
  'stacked-ranking',
  'page-promo',
  'movie-comparison',
  'watchlist-collection',
  'upcoming-releases',
  'taste-grid',
] as const;
export type CreatorTemplateId = (typeof CREATOR_TEMPLATE_IDS)[number];

export const CREATOR_FORMATS = ['post', 'carousel'] as const;
export type CreatorFormat = (typeof CREATOR_FORMATS)[number];

/** Instagram portrait feed. The only export size the MVP supports. */
export const CREATOR_ASPECT_RATIO = '4:5' as const;
export type CreatorAspectRatio = typeof CREATOR_ASPECT_RATIO;

export const CREATOR_THEMES = ['dark', 'light'] as const;
export type CreatorTheme = (typeof CREATOR_THEMES)[number];

export const CREATOR_ACCENT_IDS = ['lavender', 'coral', 'gold', 'mint', 'sky', 'rose'] as const;
export type CreatorAccentId = (typeof CREATOR_ACCENT_IDS)[number];

/** Bumped only when the persisted `slide_data` shape changes incompatibly. */
export const CREATOR_DATA_VERSION = 2 as const;

export const CREATOR_MAX_SLIDES = 10;
export const CREATOR_MAX_TITLES_PER_SLIDE = 5;
export const CREATOR_MAX_HEADLINE = 60;
export const CREATOR_MAX_SUBTITLE = 90;
export const CREATOR_MAX_DESCRIPTION = 220;
export const CREATOR_MAX_CLOSING = 80;
export const CREATOR_MAX_CAPTION = 2000;
export const CREATOR_MAX_NAME = 60;
export const CREATOR_MAX_TITLE_REFS = 60;
export const CREATOR_MAX_BRAND_NAME = 30;
export const CREATOR_MAX_BRAND_HANDLE = 40;
export const CREATOR_MAX_BRAND_TAGLINE = 90;

/** Page identity rendered on cover/promo slides. Defaults to the app's own. */
export interface CreatorBranding {
  /** Page / channel name, e.g. "Watch Later". */
  name: string;
  /** Social handle without decoration, e.g. "watchlater". May be empty. */
  handle: string;
  /** One-line bio/tagline. May be empty. */
  tagline: string;
}

export const CREATOR_DEFAULT_BRANDING: CreatorBranding = {
  name: 'Watch Later',
  handle: '',
  tagline: '',
};

/**
 * A bounded snapshot of one catalog title, captured at selection time. Missing
 * fields stay absent (never guessed): templates hide whatever is unavailable.
 */
export interface CreatorTitleRef {
  provider: MediaProvider;
  mediaType: CatalogMediaType;
  providerId: string;
  title: string;
  year?: number;
  /** `YYYY-MM-DD` (or year-only) release date, as the provider reported it. */
  releaseDate?: string;
  posterUrl?: string;
  /** Wide artwork when the provider offered one; rows prefer it over the poster. */
  backdropUrl?: string;
  /** Provider rating on its native scale (TMDb 0–10). Never derived. */
  rating?: number;
  /** IMDb rating (0–10) when a real, matched IMDb snapshot exists. Never derived. */
  imdbRating?: number;
  language?: string;
  overview?: string;
  /** Season count reported by the provider (series/anime). Never estimated. */
  seasons?: number;
  /** Episode count reported by the provider (series/anime), when known. */
  episodes?: number;
  /** First genre names reported by the provider, at most 2. */
  genres: string[];
  /** Streaming platform names from live watch-provider data, at most 3. */
  providers?: string[];
}

/** One editable slide. `titleRefs` length is bounded by the slide's layout. */
export interface CreatorSlide {
  id: string;
  /**
   * Per-slide template override. Absent slides fall back to the project's
   * template, so mixed carousels (cover → lists → promo) stay possible.
   */
  layout?: CreatorTemplateId;
  titleRefs: CreatorTitleRef[];
  /** Eyebrow/kicker above the main heading (e.g. "NOW SHOWING"). */
  headline: string;
  subtitle: string;
  description: string;
  closing: string;
  showRating: boolean;
  showReleaseDate: boolean;
  showGenres: boolean;
  showProviders: boolean;
}

/** The validated JSON payload stored with a draft. */
export interface CreatorProjectData {
  version: typeof CREATOR_DATA_VERSION;
  theme: CreatorTheme;
  accentId: CreatorAccentId;
  showBranding: boolean;
  branding: CreatorBranding;
  slides: CreatorSlide[];
}

export interface CreatorProject {
  id: string;
  /** No longer set: drafts are device-local and ownerless. */
  userId?: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  aspectRatio: CreatorAspectRatio;
  caption: string;
  data: CreatorProjectData;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight row for the studio home drafts list. */
export interface CreatorProjectSummary {
  id: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  updatedAt: string;
}

export function creatorTitleKey(ref: Pick<CreatorTitleRef, 'provider' | 'mediaType' | 'providerId'>): string {
  return `${ref.provider}:${ref.mediaType}:${encodeURIComponent(ref.providerId)}`;
}

export function creatorTitleIdentity(ref: CreatorTitleRef): MediaIdentity {
  return { provider: ref.provider, mediaType: ref.mediaType, providerId: ref.providerId };
}

/** Aggregated title names across every slide (deduped, order preserved). */
export function creatorProjectTitles(data: CreatorProjectData): CreatorTitleRef[] {
  const seen = new Set<string>();
  const result: CreatorTitleRef[] = [];
  for (const slide of data.slides) {
    for (const ref of slide.titleRefs) {
      const key = creatorTitleKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(ref);
      if (result.length >= CREATOR_MAX_TITLE_REFS) return result;
    }
  }
  return result;
}
