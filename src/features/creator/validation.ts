import {
  CREATOR_ACCENT_IDS,
  CREATOR_DATA_VERSION,
  CREATOR_DEFAULT_BRANDING,
  CREATOR_FORMATS,
  CREATOR_MAX_BRAND_HANDLE,
  CREATOR_MAX_BRAND_NAME,
  CREATOR_MAX_BRAND_TAGLINE,
  CREATOR_MAX_CAPTION,
  CREATOR_MAX_CLOSING,
  CREATOR_MAX_DESCRIPTION,
  CREATOR_MAX_HEADLINE,
  CREATOR_MAX_NAME,
  CREATOR_MAX_SLIDES,
  CREATOR_MAX_SUBTITLE,
  CREATOR_MAX_TITLES_PER_SLIDE,
  CREATOR_THEMES,
  type CreatorAccentId,
  type CreatorBranding,
  type CreatorFormat,
  type CreatorProjectData,
  type CreatorSlide,
  type CreatorTheme,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import { creatorTemplate, isCreatorTemplateId } from './templates';

/**
 * Defensive parsing for everything Creator Studio persists or loads. Drafts
 * live on-device, but stored JSON is still treated as untrusted input: loading
 * goes through these parsers and never trusts shapes. Anything unparseable is
 * dropped, not defaulted into a broken render.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Strip control characters that break canvas rendering, then bound.
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max);
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

const PROVIDERS = ['tmdb', 'anilist', 'tvdb'] as const;
const MEDIA_TYPES = ['movie', 'series', 'anime'] as const;

export function parseCreatorTitleRef(value: unknown): CreatorTitleRef | null {
  if (!isRecord(value)) return null;
  if (typeof value.provider !== 'string' || !(PROVIDERS as readonly string[]).includes(value.provider)) return null;
  if (typeof value.mediaType !== 'string' || !(MEDIA_TYPES as readonly string[]).includes(value.mediaType)) return null;
  const providerId = boundedText(value.providerId, 200);
  const title = boundedText(value.title, 300);
  if (!providerId || !title) return null;
  const genres = Array.isArray(value.genres)
    ? value.genres.map((genre) => boundedText(genre, 40)).filter((genre): genre is string => Boolean(genre)).slice(0, 2)
    : [];
  const providers = Array.isArray(value.providers)
    ? value.providers.map((provider) => boundedText(provider, 60)).filter((provider): provider is string => Boolean(provider)).slice(0, 3)
    : undefined;
  const overview = boundedText(value.overview, 600);
  return {
    provider: value.provider as CreatorTitleRef['provider'],
    mediaType: value.mediaType as CreatorTitleRef['mediaType'],
    providerId,
    title,
    year: optionalNumber(value.year, 1870, 2200),
    releaseDate: boundedText(value.releaseDate, 20) || undefined,
    posterUrl: boundedText(value.posterUrl, 1000) || undefined,
    backdropUrl: boundedText(value.backdropUrl, 1000) || undefined,
    rating: optionalNumber(value.rating, 0, 10),
    imdbRating: optionalNumber(value.imdbRating, 0, 10),
    language: boundedText(value.language, 40) || undefined,
    overview: overview || undefined,
    seasons: optionalNumber(value.seasons, 1, 200),
    episodes: optionalNumber(value.episodes, 1, 10000),
    genres,
    providers: providers && providers.length ? providers : undefined,
  };
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseTheme(value: unknown): CreatorTheme | null {
  return typeof value === 'string' && (CREATOR_THEMES as readonly string[]).includes(value) ? (value as CreatorTheme) : null;
}

function parseAccent(value: unknown): CreatorAccentId | null {
  return typeof value === 'string' && (CREATOR_ACCENT_IDS as readonly string[]).includes(value) ? (value as CreatorAccentId) : null;
}

export function isCreatorFormat(value: unknown): value is CreatorFormat {
  return typeof value === 'string' && (CREATOR_FORMATS as readonly string[]).includes(value);
}

const SLIDE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Parses one slide. `fallbackId` covers drafts written before ids existed. */
export function parseCreatorSlide(value: unknown, fallbackId: string): CreatorSlide | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && SLIDE_ID.test(value.id) ? value.id : fallbackId;
  const layout = isCreatorTemplateId(value.layout) ? value.layout : undefined;
  // The taste grid is the one layout that intentionally packs nine tiles;
  // every other layout stays at the five-pick canvas limit.
  const maxTitles = layout ? creatorTemplate(layout).maxTitles : CREATOR_MAX_TITLES_PER_SLIDE;
  const titleRefs = Array.isArray(value.titleRefs)
    ? value.titleRefs.map(parseCreatorTitleRef).filter((ref): ref is CreatorTitleRef => ref !== null).slice(0, maxTitles)
    : [];
  return {
    id,
    ...(layout ? { layout } : {}),
    titleRefs,
    headline: boundedText(value.headline, CREATOR_MAX_HEADLINE) ?? '',
    subtitle: boundedText(value.subtitle, CREATOR_MAX_SUBTITLE) ?? '',
    description: boundedText(value.description, CREATOR_MAX_DESCRIPTION) ?? '',
    closing: boundedText(value.closing, CREATOR_MAX_CLOSING) ?? '',
    showRating: parseBoolean(value.showRating, true),
    showReleaseDate: parseBoolean(value.showReleaseDate, true),
    showGenres: parseBoolean(value.showGenres, true),
    showProviders: parseBoolean(value.showProviders, true),
  };
}

/** Parses the page identity block. Missing/broken fields fall back to defaults. */
function parseCreatorBranding(value: unknown): CreatorBranding {
  if (!isRecord(value)) return { ...CREATOR_DEFAULT_BRANDING };
  return {
    name: boundedText(value.name, CREATOR_MAX_BRAND_NAME) || CREATOR_DEFAULT_BRANDING.name,
    handle: boundedText(value.handle, CREATOR_MAX_BRAND_HANDLE) ?? '',
    tagline: boundedText(value.tagline, CREATOR_MAX_BRAND_TAGLINE) ?? '',
  };
}

/**
 * Parses a stored draft payload. Returns null only when the payload is
 * structurally unusable; individual bad slides are dropped so one corrupt
 * entry never loses a whole draft. Slides are bounded to `maxSlides`.
 */
export function parseCreatorProjectData(value: unknown, maxSlides = CREATOR_MAX_SLIDES): CreatorProjectData | null {
  if (!isRecord(value)) return null;
  if (value.version !== CREATOR_DATA_VERSION) return null;
  const theme = parseTheme(value.theme);
  const accentId = parseAccent(value.accentId);
  if (!theme || !accentId) return null;
  if (!Array.isArray(value.slides)) return null;
  const slides = value.slides
    .slice(0, Math.max(1, maxSlides))
    .map((slide, index) => parseCreatorSlide(slide, `slide-${index + 1}`))
    .filter((slide): slide is CreatorSlide => slide !== null);
  if (!slides.length) return null;
  return {
    version: CREATOR_DATA_VERSION,
    theme,
    accentId,
    showBranding: parseBoolean(value.showBranding, true),
    branding: parseCreatorBranding(value.branding),
    slides,
  };
}

export function parseCreatorProjectName(value: unknown): string | null {
  const name = boundedText(value, CREATOR_MAX_NAME);
  return name ? name : null;
}

/** Bounds free text the way persisted data is bounded (used by editor inputs). */
export function clampCreatorText(value: string, max: number): string {
  return boundedText(value, max) ?? '';
}

export function parseCreatorCaption(value: unknown): string {
  return boundedText(value, CREATOR_MAX_CAPTION) ?? '';
}

/** A post is exactly one slide; a carousel may hold up to the cap. */
export function formatMaxSlides(format: CreatorFormat): number {
  return format === 'post' ? 1 : CREATOR_MAX_SLIDES;
}
