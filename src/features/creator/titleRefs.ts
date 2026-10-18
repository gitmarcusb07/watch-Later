import type { CatalogMedia } from '@/domain/models/media';
import {
  CREATOR_MAX_TITLES_PER_SLIDE,
  creatorTitleKey,
  type CreatorFormat,
  type CreatorSlide,
  type CreatorTemplateId,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import type { HitReportItem } from '@/features/hits/types';
import { creatorTemplate, templateRanksTitles } from './templates';
import { formatMaxSlides } from './validation';

/**
 * Conversions into bounded `CreatorTitleRef` snapshots, and the slide
 * distribution rules that keep a project inside its template's shape.
 * Everything here is pure so the editor and seeds share one implementation.
 */

function trimText(value: string | undefined, max: number): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/** Snapshot one catalog title. Missing metadata stays missing. */
export function titleRefFromMedia(media: CatalogMedia): CreatorTitleRef {
  const providers = media.watchProviders
    ?.filter((group) => group.category === 'stream')
    .flatMap((group) => group.providers.map((provider) => provider.name))
    .slice(0, 3);
  return {
    provider: media.provider,
    mediaType: media.mediaType,
    providerId: media.providerId,
    title: trimText(media.title, 300) ?? media.title,
    year: media.year ?? (media.releaseDate ? Number(media.releaseDate.slice(0, 4)) || undefined : undefined),
    releaseDate: media.releaseDate,
    posterUrl: media.posterUrl,
    rating: typeof media.rating === 'number' && Number.isFinite(media.rating) ? media.rating : undefined,
    language: trimText(media.language, 40),
    overview: trimText(media.overview, 600),
    seasons: media.mediaType === 'movie' ? undefined : (typeof media.numberOfSeasons === 'number' && media.numberOfSeasons > 0 ? media.numberOfSeasons : undefined),
    episodes: typeof media.numberOfEpisodes === 'number' && media.numberOfEpisodes > 0 ? media.numberOfEpisodes : undefined,
    genres: media.genres.map((genre) => trimText(genre.name, 40)).filter((name): name is string => Boolean(name)).slice(0, 2),
    providers: providers && providers.length ? providers : undefined,
  };
}

/**
 * Snapshot one Global Hits row. `posterPath` on hit rows is already a full
 * image URL (the generator stores it that way); `voteAverage` is the TMDb
 * score, which is what the ranking was built on.
 */
export function titleRefFromHit(item: HitReportItem): CreatorTitleRef {
  return {
    provider: 'tmdb',
    mediaType: item.mediaType,
    providerId: String(item.tmdbId),
    title: trimText(item.title, 300) ?? item.title,
    year: Number(item.releaseDate.slice(0, 4)) || undefined,
    releaseDate: item.releaseDate,
    posterUrl: item.posterPath ?? undefined,
    rating: item.voteAverage ?? undefined,
    genres: [],
  };
}

let slideCounter = 0;

/** Client-side slide id. Unique per session; validated on load. */
export function newSlideId(): string {
  slideCounter += 1;
  return `s${Date.now().toString(36)}-${slideCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createSlideForTemplate(templateId: CreatorTemplateId, id: string = newSlideId()): CreatorSlide {
  const template = creatorTemplate(templateId);
  return {
    id,
    titleRefs: [],
    headline: template.defaultHeadline,
    subtitle: template.defaultSubtitle,
    description: '',
    closing: template.defaultClosing,
    showRating: true,
    showReleaseDate: true,
    showGenres: true,
    showProviders: false,
  };
}

export interface AddTitleRefsResult {
  slides: CreatorSlide[];
  added: number;
  /** Refs that did not fit (post format never grows past one slide). */
  dropped: number;
}

/**
 * Adds snapshots to a project's slides, starting at `targetIndex`: fills the
 * target slide up to the template's cap, then appends new slides (carousel
 * only) with the template kicker. Refs already on a slide are skipped so the
 * same title never renders twice on one slide.
 */
export function addTitleRefsToSlides(
  slides: CreatorSlide[],
  templateId: CreatorTemplateId,
  format: CreatorFormat,
  refs: CreatorTitleRef[],
  targetIndex = 0,
): AddTitleRefsResult {
  const { maxTitles } = creatorTemplate(templateId);
  const maxSlides = formatMaxSlides(format);
  const next = slides.map((slide) => ({ ...slide, titleRefs: [...slide.titleRefs] }));
  if (!next.length) next.push(createSlideForTemplate(templateId));
  let added = 0;
  let dropped = 0;
  let cursor = Math.max(0, Math.min(targetIndex, next.length - 1));

  for (const ref of refs) {
    const key = creatorTitleKey(ref);
    let placed = false;
    for (let step = 0; step < next.length + 1 && !placed; step += 1) {
      const index = cursor + step;
      if (index >= next.length) {
        if (next.length >= maxSlides) break;
        next.push(createSlideForTemplate(templateId));
      }
      const slide = next[index];
      if (slide.titleRefs.length >= maxTitles) continue;
      if (slide.titleRefs.some((existing) => creatorTitleKey(existing) === key)) { placed = true; break; }
      slide.titleRefs.push(ref);
      added += 1;
      placed = true;
      // Continue filling this slide on the next ref before moving on.
      cursor = index;
    }
    if (!placed) dropped += 1;
  }
  return { slides: next, added, dropped };
}

export interface SeedSpec {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  /** Ref groups, one slide's worth per entry (used by Global Hits: movies, then series). */
  groups: CreatorTitleRef[][];
}

/** Builds a ready-to-edit slide list from seeded ref groups, splitting by cap. */
export function buildSeededSlides(spec: SeedSpec): CreatorSlide[] {
  const { maxTitles } = creatorTemplate(spec.templateId);
  const slides: CreatorSlide[] = [];
  for (const group of spec.groups) {
    for (let index = 0; index < group.length; index += maxTitles) {
      if (slides.length >= formatMaxSlides(spec.format)) return slides;
      const slide = createSlideForTemplate(spec.templateId);
      slide.titleRefs = group.slice(index, index + maxTitles);
      slides.push(slide);
    }
  }
  return slides.length ? slides : [createSlideForTemplate(spec.templateId)];
}

/** The single slide a rank badge should target (multi-title ranked lists). */
export function slideShowsRanks(templateId: CreatorTemplateId): boolean {
  return templateRanksTitles(templateId);
}

export { CREATOR_MAX_TITLES_PER_SLIDE };
