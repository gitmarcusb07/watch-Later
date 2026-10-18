import {
  CREATOR_MAX_SLIDES,
  CREATOR_TEMPLATE_IDS,
  type CreatorFormat,
  type CreatorTemplateId,
} from '@/domain/models/creator';

/**
 * Template registry: one place that describes what each slide template needs
 * and produces. The editor, the title picker, and the seed helpers all read
 * capabilities from here so validation can never drift from the renderers.
 */
export interface CreatorTemplateMeta {
  id: CreatorTemplateId;
  name: string;
  tagline: string;
  /** Ionicons glyph name (kept as a string so this module stays UI-library free). */
  icon: string;
  /**
   * Where the layout sits in a carousel: cover slides open it, content slides
   * carry the picks, promo slides close with a follow call-to-action.
   */
  kind: 'cover' | 'content' | 'promo';
  defaultFormat: CreatorFormat;
  /** Titles allowed on one slide. */
  minTitles: number;
  maxTitles: number;
  /** Slides a fresh project starts with. */
  defaultSlides: number;
  maxSlides: number;
  /** Default kicker shown on a fresh slide. */
  defaultHeadline: string;
  defaultSubtitle: string;
  defaultClosing: string;
}

export const CREATOR_TEMPLATES: readonly CreatorTemplateMeta[] = [
  {
    id: 'collage-cover',
    name: 'Cover collage',
    tagline: 'Poster collage with a giant headline',
    icon: 'images-outline',
    kind: 'cover',
    defaultFormat: 'carousel',
    minTitles: 1,
    maxTitles: 5,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'MOST ICONIC PICKS',
    defaultSubtitle: 'The ones that defined the era',
    defaultClosing: 'Swipe for the full list →',
  },
  {
    id: 'stacked-ranking',
    name: 'Stacked list',
    tagline: 'Full-bleed rows with year and rating badges',
    icon: 'albums-outline',
    kind: 'content',
    defaultFormat: 'carousel',
    minTitles: 1,
    maxTitles: 5,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'MOST WATCHED',
    defaultSubtitle: '',
    defaultClosing: '',
  },
  {
    id: 'page-promo',
    name: 'Follow card',
    tagline: 'Brand profile card and a follow call-to-action',
    icon: 'heart-outline',
    kind: 'promo',
    defaultFormat: 'carousel',
    minTitles: 0,
    maxTitles: 1,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'FOLLOW FOR MORE',
    defaultSubtitle: 'Daily picks, straight from my watchlist',
    defaultClosing: 'Follow for daily picks',
  },
  {
    id: 'movie-spotlight',
    name: 'Movie spotlight',
    tagline: 'One movie, big poster energy',
    icon: 'film-outline',
    kind: 'content',
    defaultFormat: 'post',
    minTitles: 0,
    maxTitles: 1,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'NOW SHOWING',
    defaultSubtitle: 'Movie night pick',
    defaultClosing: 'Add it to your Watch Later',
  },
  {
    id: 'series-spotlight',
    name: 'Series spotlight',
    tagline: 'One show, binge-ready framing',
    icon: 'tv-outline',
    kind: 'content',
    defaultFormat: 'post',
    minTitles: 0,
    maxTitles: 1,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'CURRENTLY BINGING',
    defaultSubtitle: 'Series you can’t miss',
    defaultClosing: 'Save it for the weekend',
  },
  {
    id: 'top5',
    name: 'Top 5 recommendations',
    tagline: 'A ranked five, stacked and scannable',
    icon: 'podium-outline',
    kind: 'content',
    defaultFormat: 'post',
    minTitles: 1,
    maxTitles: 5,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'MY TOP 5',
    defaultSubtitle: 'Ranked picks worth your night',
    defaultClosing: 'Save this list',
  },
  {
    id: 'movie-comparison',
    name: 'Movie comparison',
    tagline: 'Two movies, one head-to-head',
    icon: 'git-compare-outline',
    kind: 'content',
    defaultFormat: 'post',
    minTitles: 2,
    maxTitles: 2,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'THIS OR THAT',
    defaultSubtitle: 'Two movies enter…',
    defaultClosing: 'Which one wins? Comment below',
  },
  {
    id: 'watchlist-collection',
    name: 'Watchlist collection',
    tagline: 'Your saved titles as a grid',
    icon: 'bookmark-outline',
    kind: 'content',
    defaultFormat: 'carousel',
    minTitles: 1,
    maxTitles: 5,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'MY WATCHLIST',
    defaultSubtitle: 'Queued up and ready',
    defaultClosing: 'What should I watch first?',
  },
  {
    id: 'upcoming-releases',
    name: 'Upcoming releases',
    tagline: 'What’s dropping next, dated',
    icon: 'calendar-outline',
    kind: 'content',
    defaultFormat: 'carousel',
    minTitles: 1,
    maxTitles: 5,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'COMING SOON',
    defaultSubtitle: 'Mark your calendar',
    defaultClosing: 'Save these dates',
  },
] as const;

const TEMPLATE_BY_ID = new Map<CreatorTemplateId, CreatorTemplateMeta>(CREATOR_TEMPLATES.map((template) => [template.id, template]));

export function isCreatorTemplateId(value: unknown): value is CreatorTemplateId {
  return typeof value === 'string' && (CREATOR_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function creatorTemplate(id: CreatorTemplateId): CreatorTemplateMeta {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) throw new Error(`Unknown creator template: ${id}`);
  return template;
}

/**
 * The layout a slide renders with. Slides without an explicit override use the
 * project's own template, so single-template projects keep working unchanged.
 */
export function slideLayoutOf(slide: { layout?: CreatorTemplateId }, templateId: CreatorTemplateId): CreatorTemplateId {
  return slide.layout ?? templateId;
}

/** True when a slide should show the ranked-position marker. */
export function templateRanksTitles(id: CreatorTemplateId): boolean {
  return id === 'top5';
}

/** True when a slide shows release dates as a first-class column. */
export function templateHighlightsDates(id: CreatorTemplateId): boolean {
  return id === 'upcoming-releases';
}
