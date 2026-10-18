import {
  CREATOR_DATA_VERSION,
  CREATOR_DEFAULT_BRANDING,
  CREATOR_MAX_BRAND_NAME,
  CREATOR_MAX_HEADLINE,
  CREATOR_MAX_NAME,
  CREATOR_MAX_SLIDES,
  CREATOR_MAX_TITLES_PER_SLIDE,
  creatorProjectTitles,
  creatorTitleKey,
  type CreatorProjectData,
  type CreatorSlide,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import {
  CREATOR_TEMPLATES,
  creatorTemplate,
  isCreatorTemplateId,
  slideLayoutOf,
  templateHighlightsDates,
  templateRanksTitles,
} from '@/features/creator/templates';
import {
  clampCreatorText,
  formatMaxSlides,
  isCreatorFormat,
  parseCreatorCaption,
  parseCreatorProjectData,
  parseCreatorProjectName,
  parseCreatorSlide,
  parseCreatorTitleRef,
} from '@/features/creator/validation';
import {
  addTitleRefsToSlides,
  buildSeededSlides,
  createSlideForTemplate,
  titleRefFromHit,
  titleRefFromMedia,
} from '@/features/creator/titleRefs';
import { composeCaption, suggestCaptions, suggestHashtags } from '@/features/creator/captions';
import {
  EXPORT_HEIGHT,
  EXPORT_SCALE,
  EXPORT_WIDTH,
  SLIDE_BASE_HEIGHT,
  SLIDE_BASE_WIDTH,
  buildExportPlan,
  creatorExportFileName,
  safeFileBase,
} from '@/features/creator/exportPlan';
import {
  formatScore,
  formatSlideDate,
  formatSlideRating,
  mediaTypeLabel,
  rowMeta,
  seasonsLabel,
  splitSlideDate,
  spotlightMeta,
  streamingProviders,
} from '@/features/creator/slideText';
import {
  creatorEditorReducer,
  createEditorState,
  defaultProjectName,
  previewAddTitles,
} from '@/features/creator/useCreatorEditor';
import {
  CREATOR_SEEDS,
  CREATOR_SEED_IDS,
  creatorSeedTarget,
  isCreatorSeedId,
  parseCreatorSeed,
} from '@/features/creator/useCreatorSeed';
import type { CatalogMedia } from '@/domain/models/media';

function ref(overrides: Partial<CreatorTitleRef> & { title: string }): CreatorTitleRef {
  return { provider: 'tmdb', mediaType: 'movie', providerId: '1', genres: [], ...overrides };
}

function slide(overrides: Partial<CreatorSlide> = {}, template: Parameters<typeof createSlideForTemplate>[0] = 'top5'): CreatorSlide {
  return { ...createSlideForTemplate(template), ...overrides };
}

function projectData(slides: CreatorSlide[], overrides: Partial<CreatorProjectData> = {}): CreatorProjectData {
  return {
    version: CREATOR_DATA_VERSION,
    theme: 'dark',
    accentId: 'lavender',
    showBranding: true,
    branding: { ...CREATOR_DEFAULT_BRANDING },
    slides,
    ...overrides,
  };
}

function catalogMedia(overrides: Partial<CatalogMedia> = {}): CatalogMedia {
  return {
    provider: 'tmdb',
    mediaType: 'movie',
    providerId: '42',
    id: 'tmdb:movie:42',
    title: 'Example Movie',
    genres: [{ name: 'Action' }, { name: 'Drama' }, { name: 'Thriller' }],
    episodeMetadata: 'available',
    ...overrides,
  };
}

describe('creator template registry', () => {
  it('ships the nine required layouts as valid, distinct metadata', () => {
    expect(CREATOR_TEMPLATES).toHaveLength(9);
    const ids = CREATOR_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(9);
    for (const template of CREATOR_TEMPLATES) {
      expect(template.minTitles).toBeLessThanOrEqual(template.maxTitles);
      // Every layout caps at five so one slide never crowds the 4:5 canvas.
      expect(template.maxTitles).toBeLessThanOrEqual(5);
      expect(template.defaultSlides).toBe(1);
      expect(template.maxSlides).toBe(CREATOR_MAX_SLIDES);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.defaultHeadline.length).toBeGreaterThan(0);
    }
    expect(CREATOR_TEMPLATES.some((template) => template.kind === 'cover')).toBe(true);
    expect(CREATOR_TEMPLATES.some((template) => template.kind === 'promo')).toBe(true);
    expect(isCreatorTemplateId('top5')).toBe(true);
    expect(isCreatorTemplateId('top10')).toBe(false);
    expect(isCreatorTemplateId('stacked-ranking')).toBe(true);
    expect(isCreatorTemplateId('nope')).toBe(false);
    expect(creatorTemplate('top5').maxTitles).toBe(5);
    expect(() => creatorTemplate('nope' as never)).toThrow('Unknown creator template');
  });

  it('resolves each slide layout with the project template as fallback', () => {
    expect(slideLayoutOf({ layout: 'collage-cover' }, 'top5')).toBe('collage-cover');
    expect(slideLayoutOf({}, 'top5')).toBe('top5');
  });

  it('flags ranked and date-first templates for the renderers', () => {
    expect(templateRanksTitles('top5')).toBe(true);
    expect(templateRanksTitles('stacked-ranking')).toBe(false);
    expect(templateRanksTitles('movie-comparison')).toBe(false);
    expect(templateHighlightsDates('upcoming-releases')).toBe(true);
    expect(templateHighlightsDates('top5')).toBe(false);
  });
});

describe('creator validation', () => {
  it('bounds free text and strips control characters', () => {
    expect(clampCreatorText('  hello  ', 20)).toBe('hello');
    expect(clampCreatorText('a\u0001b\u001Fc', 20)).toBe('abc');
    expect(clampCreatorText('abcdef', 3)).toBe('abc');
    expect(clampCreatorText('only control \u0000', 20)).toBe('only control');
  });

  it('accepts a well-formed title ref and bounds its arrays', () => {
    const parsed = parseCreatorTitleRef({
      provider: 'tmdb',
      mediaType: 'series',
      providerId: '1399',
      title: 'Game of Thrones',
      year: 2011,
      releaseDate: '2011-04-17',
      posterUrl: 'https://example.test/poster.jpg',
      backdropUrl: 'https://example.test/backdrop.jpg',
      rating: 8.4,
      imdbRating: 9.2,
      language: 'en',
      overview: 'Nine noble families fight for control.',
      seasons: 8,
      episodes: 73,
      genres: ['Drama', 'Fantasy', 'Adventure'],
      providers: ['HBO', 'Sky', 'Crave', 'Extra'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.seasons).toBe(8);
    expect(parsed?.backdropUrl).toBe('https://example.test/backdrop.jpg');
    expect(parsed?.imdbRating).toBe(9.2);
    expect(parsed?.genres).toEqual(['Drama', 'Fantasy']);
    expect(parsed?.providers).toEqual(['HBO', 'Sky', 'Crave']);
  });

  it('rejects unparseable title refs instead of defaulting them', () => {
    expect(parseCreatorTitleRef(null)).toBeNull();
    expect(parseCreatorTitleRef({ provider: 'imdb', mediaType: 'movie', providerId: '1', title: 'X' })).toBeNull();
    expect(parseCreatorTitleRef({ provider: 'tmdb', mediaType: 'book', providerId: '1', title: 'X' })).toBeNull();
    expect(parseCreatorTitleRef({ provider: 'tmdb', mediaType: 'movie', title: 'X' })).toBeNull();
    expect(parseCreatorTitleRef({ provider: 'tmdb', mediaType: 'movie', providerId: '1', title: '   ' })).toBeNull();
    expect(parseCreatorTitleRef({ provider: 'tmdb', mediaType: 'movie', providerId: '1', title: 'X', rating: 11 })?.rating).toBeUndefined();
    expect(parseCreatorTitleRef({ provider: 'tmdb', mediaType: 'movie', providerId: '1', title: 'X', year: 3000 })?.year).toBeUndefined();
  });

  it('parses slides with fallback ids, layout overrides, and bounded title refs', () => {
    const parsed = parseCreatorSlide({ headline: 'Hi', titleRefs: [{ provider: 'tmdb', mediaType: 'movie', providerId: '1', title: 'X' }] }, 'fallback-1');
    expect(parsed?.id).toBe('fallback-1');
    expect(parsed?.layout).toBeUndefined();
    expect(parsed?.titleRefs).toHaveLength(1);
    expect(parsed?.showRating).toBe(true);
    expect(parsed?.showProviders).toBe(true);

    const unsafeId = parseCreatorSlide({ id: 'has spaces!', headline: 'Hi' }, 'fallback-2');
    expect(unsafeId?.id).toBe('fallback-2');

    const layout = parseCreatorSlide({ layout: 'collage-cover', headline: 'Hi' }, 'fallback-layout');
    expect(layout?.layout).toBe('collage-cover');
    const badLayout = parseCreatorSlide({ layout: 'top10', headline: 'Hi' }, 'fallback-layout-2');
    expect(badLayout?.layout).toBeUndefined();

    const many = parseCreatorSlide(
      { titleRefs: Array.from({ length: 15 }, (_, index) => ({ provider: 'tmdb', mediaType: 'movie', providerId: String(index), title: `T${index}` })) },
      'fallback-3',
    );
    expect(many?.titleRefs).toHaveLength(CREATOR_MAX_TITLES_PER_SLIDE);
    expect(parseCreatorSlide('nope', 'fallback-4')).toBeNull();
  });

  it('parses project data only when structurally sound', () => {
    const good = projectData([slide({}, 'top5'), slide({}, 'top5')]);
    const parsed = parseCreatorProjectData({ ...good, theme: 'light', showBranding: false });
    expect(parsed?.theme).toBe('light');
    expect(parsed?.showBranding).toBe(false);
    expect(parsed?.slides).toHaveLength(2);

    expect(parseCreatorProjectData(null)).toBeNull();
    expect(parseCreatorProjectData({ ...good, version: 1 })).toBeNull();
    expect(parseCreatorProjectData({ ...good, version: 99 })).toBeNull();
    expect(parseCreatorProjectData({ ...good, theme: 'neon' })).toBeNull();
    expect(parseCreatorProjectData({ ...good, accentId: 'neon' })).toBeNull();
    expect(parseCreatorProjectData({ ...good, slides: [] })).toBeNull();
    expect(parseCreatorProjectData({ ...good, slides: 'nope' })).toBeNull();

    // Corrupt slides are dropped; the rest of the draft survives, capped.
    const ragged = parseCreatorProjectData({ ...good, slides: [slide({}, 'top5'), null, 'junk', slide({}, 'top5')] }, 2);
    expect(ragged?.slides).toHaveLength(1);
    const cutByCap = parseCreatorProjectData({ ...good, slides: [slide({}, 'top5'), slide({}, 'top5')] }, 1);
    expect(cutByCap?.slides).toHaveLength(1);
  });

  it('parses branding with safe defaults and bounds', () => {
    const data = projectData([slide({}, 'top5')]);
    const custom = parseCreatorProjectData({ ...data, branding: { name: '  Cine Club  ', handle: '@cineclub', tagline: 'Nightly picks' } });
    expect(custom?.branding).toEqual({ name: 'Cine Club', handle: '@cineclub', tagline: 'Nightly picks' });

    // Missing or broken branding falls back to the app's own identity.
    expect(parseCreatorProjectData({ ...data, branding: undefined })?.branding).toEqual(CREATOR_DEFAULT_BRANDING);
    expect(parseCreatorProjectData({ ...data, branding: { name: '   ' } })?.branding.name).toBe(CREATOR_DEFAULT_BRANDING.name);
    expect(parseCreatorProjectData({ ...data, branding: { name: 'x'.repeat(100) } })?.branding.name).toHaveLength(CREATOR_MAX_BRAND_NAME);
  });

  it('bounds captions, names, and formats', () => {
    expect(parseCreatorCaption(42)).toBe('');
    expect(parseCreatorCaption('x'.repeat(2500))).toHaveLength(2000);
    expect(parseCreatorProjectName('x'.repeat(200))).toHaveLength(CREATOR_MAX_NAME);
    expect(isCreatorFormat('post')).toBe(true);
    expect(isCreatorFormat('carousel')).toBe(true);
    expect(isCreatorFormat('story')).toBe(false);
    expect(formatMaxSlides('post')).toBe(1);
    expect(formatMaxSlides('carousel')).toBe(CREATOR_MAX_SLIDES);
  });
});

describe('creator title snapshots', () => {
  it('snapshots catalog media without inventing missing fields', () => {
    const media = catalogMedia({
      title: '  A  Spaced   Title ',
      releaseDate: '2024-11-08',
      rating: 7.25,
      language: 'en',
      numberOfSeasons: 0,
      numberOfEpisodes: 0,
      watchProviders: [
        { category: 'stream', providers: [{ id: 1, name: 'Netflix' }, { id: 2, name: 'Prime Video' }] },
        { category: 'rent', providers: [{ id: 3, name: 'Apple TV' }] },
      ],
    });
    const snapshot = titleRefFromMedia(media);
    expect(snapshot.title).toBe('A Spaced Title');
    expect(snapshot.year).toBe(2024);
    expect(snapshot.releaseDate).toBe('2024-11-08');
    expect(snapshot.rating).toBe(7.25);
    expect(snapshot.seasons).toBeUndefined();
    expect(snapshot.episodes).toBeUndefined();
    expect(snapshot.genres).toEqual(['Action', 'Drama']);
    expect(snapshot.providers).toEqual(['Netflix', 'Prime Video']);

    const wide = titleRefFromMedia(catalogMedia({ title: 'Wide', backdropUrl: 'https://example.test/backdrop.jpg' }));
    expect(wide.backdropUrl).toBe('https://example.test/backdrop.jpg');
    expect(wide.imdbRating).toBeUndefined();

    const bare = titleRefFromMedia(catalogMedia({ title: 'Bare' }));
    expect(bare.year).toBeUndefined();
    expect(bare.rating).toBeUndefined();
    expect(bare.posterUrl).toBeUndefined();
    expect(bare.backdropUrl).toBeUndefined();
    expect(bare.providers).toBeUndefined();
    expect(bare.seasons).toBeUndefined();
  });

  it('keeps series season counts but never estimates them', () => {
    const series = titleRefFromMedia(catalogMedia({ mediaType: 'series', numberOfSeasons: 3, year: 2019 }));
    expect(series.seasons).toBe(3);
    const noCount = titleRefFromMedia(catalogMedia({ mediaType: 'series', numberOfSeasons: 0 }));
    expect(noCount.seasons).toBeUndefined();
  });

  it('snapshots global hits rows with their real dates and ratings', () => {
    const hit = titleRefFromHit({
      rank: 1,
      mediaType: 'movie',
      title: 'Hit Movie',
      releaseDate: '2026-07-02',
      popularity: 500,
      voteAverage: 7.8,
      voteCount: 1000,
      tmdbId: 123,
      posterPath: 'https://example.test/hit.jpg',
    });
    expect(hit.providerId).toBe('123');
    expect(hit.provider).toBe('tmdb');
    expect(hit.year).toBe(2026);
    expect(hit.rating).toBe(7.8);
    expect(hit.posterUrl).toBe('https://example.test/hit.jpg');
    expect(hit.genres).toEqual([]);
  });

  it('keys titles by provider, media type, and provider id', () => {
    expect(creatorTitleKey(ref({ title: 'X', provider: 'tmdb', mediaType: 'movie', providerId: 'tt/1' }))).toBe('tmdb:movie:tt%2F1');
    const data = projectData([
      slide({ titleRefs: [ref({ title: 'A', providerId: '1' }), ref({ title: 'A', providerId: '1' })] }, 'top5'),
      slide({ titleRefs: [ref({ title: 'B', providerId: '2', mediaType: 'series' })] }, 'top5'),
    ]);
    expect(creatorProjectTitles(data).map((ref) => ref.title)).toEqual(['A', 'B']);
  });
});

describe('creator slide distribution', () => {
  it('fills the target slide up to the template cap, then appends slides', () => {
    const slides = [slide({}, 'top5')];
    const refs = Array.from({ length: 7 }, (_, index) => ref({ title: `T${index}`, providerId: String(index) }));
    const result = addTitleRefsToSlides(slides, 'top5', 'carousel', refs);
    expect(result.added).toBe(7);
    expect(result.dropped).toBe(0);
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].titleRefs).toHaveLength(5);
    expect(result.slides[1].titleRefs).toHaveLength(2);
  });

  it('drops titles that cannot fit a single-slide post', () => {
    const slides = [slide({}, 'movie-spotlight')];
    const result = addTitleRefsToSlides(slides, 'movie-spotlight', 'post', [
      ref({ title: 'First', providerId: '1' }),
      ref({ title: 'Second', providerId: '2' }),
    ]);
    expect(result.added).toBe(1);
    expect(result.dropped).toBe(1);
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].titleRefs.map((ref) => ref.title)).toEqual(['First']);
  });

  it('never adds the same title twice to one slide', () => {
    const duplicate = ref({ title: 'Same', providerId: '9' });
    const result = addTitleRefsToSlides([slide({}, 'top5')], 'top5', 'carousel', [duplicate, { ...duplicate }]);
    expect(result.added).toBe(1);
    expect(result.slides[0].titleRefs).toHaveLength(1);
  });

  it('builds seeded slides by splitting groups across the layout cap', () => {
    const refs = Array.from({ length: 12 }, (_, index) => ref({ title: `T${index}`, providerId: String(index) }));
    const seeded = buildSeededSlides({ templateId: 'stacked-ranking', format: 'carousel', groups: [refs.slice(0, 10), refs.slice(10)] });
    expect(seeded).toHaveLength(3);
    expect(seeded[0].titleRefs).toHaveLength(5);
    expect(seeded[1].titleRefs).toHaveLength(5);
    expect(seeded[2].titleRefs).toHaveLength(2);
    expect(seeded[0].layout).toBe('stacked-ranking');

    const empty = buildSeededSlides({ templateId: 'top5', format: 'carousel', groups: [] });
    expect(empty).toHaveLength(1);
    expect(empty[0].titleRefs).toHaveLength(0);
  });

  it('previews how many picked titles would land before applying them', () => {
    const state = createEditorState({ name: 'Draft', templateId: 'movie-spotlight', format: 'post' });
    const preview = previewAddTitles(state, state.data.slides[0].id, [ref({ title: 'A' }), ref({ title: 'B', providerId: '2' })]);
    expect(preview).toEqual({ added: 1, dropped: 1 });
  });
});

describe('creator editor reducer', () => {
  function state() {
    const created = createEditorState({ name: 'Draft', templateId: 'top5', format: 'carousel' });
    return { ...created, data: { ...created.data, slides: [createSlideForTemplate('top5', 's1'), createSlideForTemplate('top5', 's2')] } };
  }

  it('clamps names and slide texts while marking the draft dirty', () => {
    const renamed = creatorEditorReducer(state(), { type: 'rename', name: 'x'.repeat(CREATOR_MAX_NAME + 20) });
    expect(renamed.name).toHaveLength(CREATOR_MAX_NAME);
    expect(renamed.dirty).toBe(true);

    const before = state();
    const typed = creatorEditorReducer(before, { type: 'setSlideText', slideId: 's1', key: 'headline', value: 'y'.repeat(CREATOR_MAX_HEADLINE + 5) });
    expect(typed.data.slides[0].headline).toHaveLength(CREATOR_MAX_HEADLINE);
    // Untouched slides keep their identity so memoized canvases skip re-rendering.
    expect(typed.data.slides[1]).toBe(before.data.slides[1]);
  });

  it('toggles per-slide metadata flags without touching other slides', () => {
    const toggled = creatorEditorReducer(state(), { type: 'toggleSlideFlag', slideId: 's2', flag: 'showRating' });
    expect(toggled.data.slides[1].showRating).toBe(false);
    expect(toggled.data.slides[0].showRating).toBe(true);
  });

  it('adds, duplicates, removes, and reorders slides within the format cap', () => {
    const added = creatorEditorReducer(state(), { type: 'addSlide' });
    expect(added.data.slides).toHaveLength(3);

    const withTitle = creatorEditorReducer(added, { type: 'addTitles', slideId: 's1', refs: [ref({ title: 'Picked' })] });
    const duplicated = creatorEditorReducer(withTitle, { type: 'duplicateSlide', slideId: 's1' });
    expect(duplicated.data.slides).toHaveLength(4);
    expect(duplicated.data.slides[1].titleRefs[0].title).toBe('Picked');
    expect(duplicated.data.slides[1].id).not.toBe('s1');
    expect(duplicated.data.slides[1].titleRefs[0]).not.toBe(duplicated.data.slides[0].titleRefs[0]);

    const removed = creatorEditorReducer(duplicated, { type: 'removeSlide', slideId: 's2' });
    expect(removed.data.slides.map((slide) => slide.id)).not.toContain('s2');

    const orderBefore = removed.data.slides.map((slide) => slide.id);
    const moved = creatorEditorReducer(removed, { type: 'moveSlide', slideId: orderBefore[0], direction: 1 });
    expect(moved.data.slides.map((slide) => slide.id)).toEqual([orderBefore[1], orderBefore[0], ...orderBefore.slice(2)]);
    const blocked = creatorEditorReducer(removed, { type: 'moveSlide', slideId: orderBefore[0], direction: -1 });
    expect(blocked).toBe(removed);
  });

  it('keeps at least one slide and respects a post format cap of one', () => {
    const single = createEditorState({ name: 'Post', templateId: 'movie-spotlight', format: 'post' });
    expect(single.data.slides).toHaveLength(1);
    expect(creatorEditorReducer(single, { type: 'removeSlide', slideId: single.data.slides[0].id })).toBe(single);
    expect(creatorEditorReducer(single, { type: 'addSlide' })).toBe(single);
  });

  it('caps a carousel at the maximum slide count', () => {
    let state = createEditorState({ name: 'Carousel', templateId: 'top5', format: 'carousel' });
    for (let index = 0; index < CREATOR_MAX_SLIDES + 4; index += 1) state = creatorEditorReducer(state, { type: 'addSlide' });
    expect(state.data.slides).toHaveLength(CREATOR_MAX_SLIDES);
  });

  it('routes picked titles through the distributor and records saves', () => {
    const state = createEditorState({ name: 'List', templateId: 'top5', format: 'carousel' });
    const withTitles = creatorEditorReducer(state, {
      type: 'addTitles',
      slideId: state.data.slides[0].id,
      refs: [ref({ title: 'One' }), ref({ title: 'Two', providerId: '2' })],
    });
    expect(withTitles.data.slides[0].titleRefs).toHaveLength(2);
    expect(withTitles.dirty).toBe(true);

    const saved = creatorEditorReducer(withTitles, { type: 'markSaved', projectId: 'p-1', name: 'Saved name' });
    expect(saved.projectId).toBe('p-1');
    expect(saved.name).toBe('Saved name');
    expect(saved.dirty).toBe(false);
  });

  it('names fresh drafts with the template name and date', () => {
    expect(defaultProjectName('top5', new Date(2026, 9, 18))).toBe('Top 5 recommendations · 18 Oct');
  });

  it('switches a slide layout and trims refs over the new cap', () => {
    const before = creatorEditorReducer(
      state(),
      { type: 'addTitles', slideId: 's1', refs: Array.from({ length: 5 }, (_, index) => ref({ title: `T${index}`, providerId: String(index) })) },
    );
    expect(before.data.slides[0].titleRefs).toHaveLength(5);

    const switched = creatorEditorReducer(before, { type: 'setSlideLayout', slideId: 's1', layout: 'movie-comparison' });
    expect(switched.data.slides[0].layout).toBe('movie-comparison');
    expect(switched.data.slides[0].titleRefs).toHaveLength(2);
    // Untouched slides keep their identity so memoized canvases skip re-rendering.
    expect(switched.data.slides[1]).toBe(before.data.slides[1]);
    expect(switched.dirty).toBe(true);
  });

  it('edits branding fields with bounds and defaults', () => {
    const edited = creatorEditorReducer(state(), { type: 'setBrandingField', key: 'name', value: '  Cine Club  ' });
    expect(edited.data.branding.name).toBe('Cine Club');
    const bound = creatorEditorReducer(edited, { type: 'setBrandingField', key: 'tagline', value: 'x'.repeat(200) });
    expect(bound.data.branding.tagline.length).toBeLessThanOrEqual(90);
    expect(edited.data.branding.handle).toBe('');
  });
});

describe('creator seeds', () => {
  it('maps every seed to its template and format', () => {
    expect(creatorSeedTarget('watchlist')).toEqual({ templateId: 'watchlist-collection', format: 'carousel' });
    expect(creatorSeedTarget('trending')).toEqual({ templateId: 'top5', format: 'carousel' });
    expect(creatorSeedTarget('upcoming')).toEqual({ templateId: 'upcoming-releases', format: 'carousel' });
    expect(creatorSeedTarget('hits-month')).toEqual({ templateId: 'stacked-ranking', format: 'carousel' });
    expect(creatorSeedTarget('hits-year')).toEqual({ templateId: 'stacked-ranking', format: 'carousel' });
    expect(CREATOR_SEEDS.map((seed) => seed.id)).toEqual([...CREATOR_SEED_IDS]);
  });

  it('parses only known seed ids', () => {
    expect(parseCreatorSeed('trending')).toBe('trending');
    expect(parseCreatorSeed('unknown')).toBeUndefined();
    expect(parseCreatorSeed(undefined)).toBeUndefined();
    expect(isCreatorSeedId('hits-year')).toBe(true);
    expect(isCreatorSeedId('weekly')).toBe(false);
  });
});

describe('creator captions and hashtags', () => {
  it('suggests template-aware captions and never invents names', () => {
    const top5 = suggestCaptions({ templateId: 'top5', format: 'post', titleRefs: [ref({ title: 'Alpha', year: 2020 }), ref({ title: 'Beta', providerId: '2' })] });
    expect(top5[0].text).toContain('1. Alpha (2020)');
    expect(top5[0].text).toContain('2. Beta');
    expect(top5.length).toBeLessThanOrEqual(3);

    const spotlight = suggestCaptions({ templateId: 'movie-spotlight', format: 'post', titleRefs: [] });
    expect(spotlight).toHaveLength(1);
    expect(spotlight[0].text).not.toContain('Alpha');

    const upcoming = suggestCaptions({
      templateId: 'upcoming-releases',
      format: 'carousel',
      titleRefs: [ref({ title: 'Gamma', releaseDate: '2027-03-15' })],
    });
    expect(upcoming[0].text).toContain('Gamma — 2027-03-15');
  });

  it('derives deduped hashtags from real genres and media types', () => {
    const tags = suggestHashtags([
      ref({ title: 'A', genres: ['Action', 'Sci-Fi'] }),
      ref({ title: 'B', providerId: '2', mediaType: 'series', genres: ['Action'] }),
    ]);
    expect(tags).toContain('#WatchLater');
    expect(tags).toContain('#MovieNight');
    expect(tags).toContain('#SeriesBinge');
    expect(tags).toContain('#Action');
    expect(tags).toContain('#SciFi');
    expect(tags.filter((tag) => tag === '#Action')).toHaveLength(1);
    expect(tags.length).toBeLessThanOrEqual(10);
    expect(suggestHashtags([])).toEqual(['#WatchLater', '#NowWatching']);
  });

  it('composes captions with a tidy hashtag block', () => {
    expect(composeCaption('Hello', ['#A', '#B'])).toBe('Hello\n\n#A #B');
    expect(composeCaption('  ', ['#A'])).toBe('#A');
    expect(composeCaption('Hi', [])).toBe('Hi');
  });
});

describe('creator slide text rules', () => {
  it('formats provider dates exactly, rejecting impossible ones', () => {
    expect(formatSlideDate('2026-08-06')).toBe('6 Aug 2026');
    expect(formatSlideDate('2024-02-29')).toBe('29 Feb 2024');
    expect(formatSlideDate('2026-02-29')).toBeUndefined();
    expect(formatSlideDate('2026-13-01')).toBeUndefined();
    expect(formatSlideDate('2026-08-32')).toBeUndefined();
    expect(formatSlideDate('2026-08')).toBeUndefined();
    expect(formatSlideDate('2026')).toBe('2026');
    expect(formatSlideDate(undefined)).toBeUndefined();
  });

  it('splits dates for the upcoming pill and marks unknown ones', () => {
    expect(splitSlideDate('2027-03-15')).toEqual({ top: '15', bottom: 'MAR' });
    expect(splitSlideDate('2027')).toEqual({ top: '2027', bottom: 'YEAR' });
    expect(splitSlideDate('tomorrow')).toBeUndefined();
    expect(splitSlideDate(undefined)).toBeUndefined();
  });

  it('formats ratings, seasons, and media types defensively', () => {
    expect(formatSlideRating(8.456)).toBe('★ 8.5');
    expect(formatSlideRating(0)).toBeUndefined();
    expect(formatSlideRating(Number.NaN)).toBeUndefined();
    expect(formatSlideRating(undefined)).toBeUndefined();
    expect(formatScore(8.456)).toBe('8.5');
    expect(formatScore(0)).toBeUndefined();
    expect(formatScore(undefined)).toBeUndefined();
    expect(seasonsLabel(1)).toBe('1 Season');
    expect(seasonsLabel(4)).toBe('4 Seasons');
    expect(seasonsLabel(0)).toBeUndefined();
    expect(mediaTypeLabel(ref({ title: 'A' }))).toBe('Movie');
    expect(mediaTypeLabel(ref({ title: 'A', mediaType: 'series' }))).toBe('Series');
    expect(mediaTypeLabel(ref({ title: 'A', mediaType: 'anime' }))).toBe('Anime');
  });

  it('honors metadata toggles in the spotlight meta line', () => {
    const full = slide({}, 'movie-spotlight');
    const rich = ref({ title: 'Rich', releaseDate: '2026-08-06', year: 2026, rating: 8.456, genres: ['Action', 'Drama'] });
    expect(spotlightMeta(rich, full)).toBe('6 Aug 2026   ·   ★ 8.5   ·   Action · Drama');
    expect(spotlightMeta(rich, { ...full, showRating: false })).toBe('6 Aug 2026   ·   Action · Drama');
    expect(spotlightMeta(rich, { ...full, showReleaseDate: false })).toBe('★ 8.5   ·   Action · Drama');
    expect(spotlightMeta(rich, { ...full, showGenres: false })).toBe('6 Aug 2026   ·   ★ 8.5');
    expect(spotlightMeta(undefined, full)).toBeUndefined();
    expect(spotlightMeta(ref({ title: 'Bare' }), full)).toBeUndefined();
  });

  it('keeps list rows compact and only shows real provider names', () => {
    const row = ref({ title: 'Row', year: 2021, releaseDate: '2021-05-01', rating: 6.5, genres: ['Drama', 'Comedy'] });
    const config = slide({ showProviders: true }, 'top5');
    expect(rowMeta(row, config)).toBe('2021 · ★ 6.5 · Drama');
    expect(rowMeta(row, config, { dateInsteadOfYear: true })).toBe('1 May 2021 · ★ 6.5 · Drama');
    expect(rowMeta(ref({ title: 'Bare' }), config)).toBeUndefined();

    const withProviders = ref({ title: 'P', providers: ['Netflix', 'Hulu', 'Disney+', 'Max'] });
    expect(streamingProviders(withProviders, config)).toEqual(['Netflix', 'Hulu', 'Disney+']);
    expect(streamingProviders(withProviders, { ...config, showProviders: false })).toBeUndefined();
    expect(streamingProviders(ref({ title: 'P' }), config)).toBeUndefined();
  });
});

describe('creator export plan', () => {
  it('targets 1080 x 1350 from the 360 x 450 authoring canvas', () => {
    expect(EXPORT_WIDTH).toBe(1080);
    expect(EXPORT_HEIGHT).toBe(1350);
    expect(SLIDE_BASE_WIDTH).toBe(360);
    expect(SLIDE_BASE_HEIGHT).toBe(450);
    expect(EXPORT_SCALE).toBe(3);
    expect(EXPORT_WIDTH / EXPORT_HEIGHT).toBeCloseTo(4 / 5);
    expect(SLIDE_BASE_WIDTH / SLIDE_BASE_HEIGHT).toBeCloseTo(4 / 5);
  });

  it('names files safely across platforms', () => {
    expect(safeFileBase('My Top 5!')).toBe('my-top-5');
    expect(safeFileBase('Café Night')).toBe('cafe-night');
    expect(safeFileBase('A')).toBe('watch-later-post');
    expect(safeFileBase('   ')).toBe('watch-later-post');
    expect(safeFileBase('x'.repeat(120))).toHaveLength(40);
    expect(creatorExportFileName({ projectName: 'My Post', templateId: 'top5', position: 1, total: 1 })).toBe('watch-later-my-post');
    expect(creatorExportFileName({ projectName: 'My Post', templateId: 'top5', position: 2, total: 3 })).toBe('watch-later-my-post-2of3');
  });

  it('builds ordered plans for all slides or one slide', () => {
    const data = projectData([slide({}, 'top5'), slide({}, 'top5'), slide({}, 'top5')]);
    const all = buildExportPlan(data, 'My Post', 'top5', 'all');
    expect(all.map((plan) => plan.position)).toEqual([1, 2, 3]);
    expect(all.every((plan) => plan.total === 3 && plan.width === 1080 && plan.height === 1350)).toBe(true);
    expect(all[2].fileName).toBe('watch-later-my-post-3of3');

    const one = buildExportPlan(data, 'My Post', 'top5', { slideId: data.slides[1].id });
    expect(one).toHaveLength(1);
    expect(one[0].slideId).toBe(data.slides[1].id);
    expect(one[0].fileName).toBe('watch-later-my-post');

    expect(() => buildExportPlan(data, 'My Post', 'top5', { slideId: 'missing' })).toThrow('no longer part of this project');
  });
});
