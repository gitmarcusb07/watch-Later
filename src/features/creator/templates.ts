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
    id: 'movie-spotlight',
    name: 'Movie spotlight',
    tagline: 'One movie, big poster energy',
    icon: 'film-outline',
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
    id: 'top10',
    name: 'Top 10 recommendations',
    tagline: 'A two-column ranked ten',
    icon: 'list-outline',
    defaultFormat: 'post',
    minTitles: 1,
    maxTitles: 10,
    defaultSlides: 1,
    maxSlides: CREATOR_MAX_SLIDES,
    defaultHeadline: 'TOP 10',
    defaultSubtitle: 'The only list you need this month',
    defaultClosing: 'Follow for more picks',
  },
  {
    id: 'movie-comparison',
    name: 'Movie comparison',
    tagline: 'Two movies, one head-to-head',
    icon: 'git-compare-outline',
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
    defaultFormat: 'carousel',
    minTitles: 1,
    maxTitles: 6,
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

/** True when a slide should show the ranked-position marker. */
export function templateRanksTitles(id: CreatorTemplateId): boolean {
  return id === 'top5' || id === 'top10';
}

/** True when a slide shows release dates as a first-class column. */
export function templateHighlightsDates(id: CreatorTemplateId): boolean {
  return id === 'upcoming-releases';
}
