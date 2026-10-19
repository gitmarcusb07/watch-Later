import {
  CREATOR_MAX_TITLES_PER_SLIDE,
  creatorTitleKey,
  type CreatorFormat,
  type CreatorSlide,
  type CreatorTemplateId,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import { creatorTemplate, slideLayoutOf, templateListsTitles } from './templates';
import { createSlideForTemplate } from './titleRefs';
import { formatMaxSlides } from './validation';

/**
 * "Finish the carousel": one tap that turns a working draft into a complete
 * swipe-through set. Two things can be missing:
 *
 * - a full-list slide — picks that only live in a cover, spotlight, or
 *   comparison are listed as scannable rows (one stacked-ranking slide per
 *   five picks, appended in project order);
 * - a follow card — closing promo slide, added only when none exists.
 *
 * The planner is pure and never mutates: the editor reduces its output and
 * the suggestion row renders its gaps. When nothing is missing, `slides` is
 * the exact input array so callers can keep reference equality.
 */

export type CarouselGap = 'full-list' | 'follow-card';

export interface CarouselCompletionInput {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  slides: CreatorSlide[];
}

export interface CarouselCompletionPlan {
  /** The full slide list after completion (identical reference when empty). */
  slides: CreatorSlide[];
  /** New slides in the order they appear after completion. */
  added: CreatorSlide[];
  /** Pieces a tap would add. Empty when there is nothing to finish. */
  gaps: CarouselGap[];
  /** Picks still absent from every list layout. */
  missingTitles: number;
  /** Full-list slides among `added`. */
  listSlides: number;
}

export function planCarouselCompletion(input: CarouselCompletionInput): CarouselCompletionPlan {
  const { templateId, format, slides } = input;
  const empty: CarouselCompletionPlan = { slides, added: [], gaps: [], missingTitles: 0, listSlides: 0 };
  if (format !== 'carousel') return empty;
  let room = formatMaxSlides(format) - slides.length;
  if (room <= 0) return empty;

  // Every pick, deduped, in project order.
  const picks: CreatorTitleRef[] = [];
  const seen = new Set<string>();
  for (const slide of slides) {
    for (const ref of slide.titleRefs) {
      const key = creatorTitleKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(ref);
    }
  }

  // Picks a list layout already presents.
  const listed = new Set<string>();
  for (const slide of slides) {
    if (!templateListsTitles(slideLayoutOf(slide, templateId))) continue;
    for (const ref of slide.titleRefs) listed.add(creatorTitleKey(ref));
  }
  const missing = picks.filter((ref) => !listed.has(creatorTitleKey(ref)));

  const added: CreatorSlide[] = [];
  const gaps: CarouselGap[] = [];
  if (missing.length) {
    gaps.push('full-list');
    for (let index = 0; index < missing.length && room > 0; index += CREATOR_MAX_TITLES_PER_SLIDE) {
      const slide = createSlideForTemplate('stacked-ranking');
      slide.titleRefs = missing.slice(index, index + CREATOR_MAX_TITLES_PER_SLIDE);
      added.push(slide);
      room -= 1;
    }
  }

  const hasFollowCard = slides.some((slide) => creatorTemplate(slideLayoutOf(slide, templateId)).kind === 'promo');
  if (!hasFollowCard && room > 0) {
    gaps.push('follow-card');
    added.push(createSlideForTemplate('page-promo'));
  }

  if (!added.length) return empty;

  // List slides fill the content run (seeded drafts keep their cover first);
  // the follow card always closes the set.
  const listSlides = added.filter((slide) => slideLayoutOf(slide, templateId) === 'stacked-ranking').length;
  const followCards = added.filter((slide) => slideLayoutOf(slide, templateId) === 'page-promo');
  const content = added.filter((slide) => slideLayoutOf(slide, templateId) !== 'page-promo');
  const firstPromo = slides.findIndex((slide) => creatorTemplate(slideLayoutOf(slide, templateId)).kind === 'promo');
  const insertAt = content.length ? (firstPromo >= 0 ? firstPromo : slides.length) : slides.length;
  const next = [...slides.slice(0, insertAt), ...content, ...slides.slice(insertAt), ...followCards];
  return { slides: next, added, gaps, missingTitles: missing.length, listSlides };
}

/** Caption under the suggestion-row title, e.g. "2 picks not in a list yet · no follow card closing the set". */
export function carouselCompletionHint(plan: Pick<CarouselCompletionPlan, 'gaps' | 'missingTitles'>): string {
  const bits: string[] = [];
  if (plan.gaps.includes('full-list')) {
    bits.push(`${plan.missingTitles} pick${plan.missingTitles === 1 ? '' : 's'} not in a list yet`);
  }
  if (plan.gaps.includes('follow-card')) bits.push('no follow card closing the set');
  return bits.join(' · ');
}

/** Toast after a tap, e.g. "1 full-list slide added · follow card added". */
export function carouselCompletionMessage(plan: Pick<CarouselCompletionPlan, 'gaps' | 'listSlides'>): string {
  const parts: string[] = [];
  if (plan.gaps.includes('full-list')) {
    parts.push(`${plan.listSlides} full-list slide${plan.listSlides === 1 ? '' : 's'} added`);
  }
  if (plan.gaps.includes('follow-card')) parts.push('follow card added');
  return parts.join(' · ');
}
