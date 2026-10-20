import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';
import {
  CREATOR_TEMPLATE_IDS,
  type CreatorAccentId,
  type CreatorBranding,
  type CreatorSlide,
  type CreatorTemplateId,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import { createSlideForTemplate } from '@/features/creator/titleRefs';
import { collectionTitleStats, type CreatorCollectionStats } from '@/features/creator/templates';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function ref(overrides: Partial<CreatorTitleRef> & { title: string }): CreatorTitleRef {
  return { provider: 'tmdb', mediaType: 'movie', providerId: '1', genres: [], ...overrides };
}

function renderCanvas(
  templateId: CreatorTemplateId,
  slide: CreatorSlide,
  options: { theme?: 'dark' | 'light'; accentId?: CreatorAccentId; width?: number; branding?: CreatorBranding; collection?: CreatorCollectionStats } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <CreatorSlideCanvas
        templateId={templateId}
        theme={options.theme ?? 'dark'}
        accentId={options.accentId ?? 'lavender'}
        showBranding
        branding={options.branding}
        slide={slide}
        width={options.width ?? 180}
        collection={options.collection}
      />,
    );
  });
  return tree;
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe('creator slide canvases', () => {
  it.each(CREATOR_TEMPLATE_IDS)('renders %s with an empty slide', (templateId) => {
    const slide = createSlideForTemplate(templateId);
    const tree = renderCanvas(templateId, slide);
    const text = textOf(tree);
    expect(text).toContain(slide.headline);
    expect(text.toLowerCase()).toContain('watch later');
    act(() => tree.unmount());
  });

  it('coaches empty ranked, grid, and dated templates instead of showing holes', () => {
    const top5 = renderCanvas('top5', createSlideForTemplate('top5'));
    expect(textOf(top5)).toContain('Add titles from your library to build this list');
    act(() => top5.unmount());

    const grid = renderCanvas('watchlist-collection', createSlideForTemplate('watchlist-collection'));
    expect(textOf(grid)).toContain('Pick titles from your watchlist to fill this grid');
    act(() => grid.unmount());

    const upcoming = renderCanvas('upcoming-releases', createSlideForTemplate('upcoming-releases'));
    expect(textOf(upcoming)).toContain('Add upcoming titles to build this countdown');
    act(() => upcoming.unmount());

    const comparison = renderCanvas('movie-comparison', createSlideForTemplate('movie-comparison'));
    const comparisonText = textOf(comparison);
    expect(comparisonText).toContain('First movie');
    expect(comparisonText).toContain('Second movie');
    expect(comparisonText).toContain('VS');
    act(() => comparison.unmount());
  });

  it('renders exactly nine labeled tiles in the taste grid', () => {
    const slide: CreatorSlide = {
      ...createSlideForTemplate('taste-grid'),
      titleRefs: Array.from({ length: 10 }, (_, index) => ref({ title: `Taste ${index}`, providerId: String(index) })),
    };
    const tree = renderCanvas('taste-grid', slide);
    const text = textOf(tree);
    expect(text).toContain('FAVORITE');
    expect(text).toContain('HIDDEN GEM');
    expect(text).toContain('WILDCARD');
    expect(text).toContain('Taste 8');
    expect(text).not.toContain('Taste 9');
    act(() => tree.unmount());
  });

  it('renders a long spotlight title with missing metadata without inventing facts', () => {
    const longTitle = 'An Extremely Long Movie Title That Refuses to Fit Anywhere and Keeps Going Until It Stops';
    const slide: CreatorSlide = { ...createSlideForTemplate('movie-spotlight'), titleRefs: [ref({ title: longTitle })] };
    const tree = renderCanvas('movie-spotlight', slide);
    const text = textOf(tree);
    expect(text).toContain(longTitle);
    expect(text).toContain(longTitle.toUpperCase());
    expect(text).not.toContain('★');
    expect(text).not.toContain('undefined');
    act(() => tree.unmount());
  });

  it('honors spotlight metadata toggles and real provider names only', () => {
    const base: CreatorSlide = {
      ...createSlideForTemplate('movie-spotlight'),
      showProviders: true,
      titleRefs: [ref({ title: 'Toggle Movie', year: 2020, rating: 8.456, genres: ['Action'], providers: ['Netflix'] })],
    };
    const full = renderCanvas('movie-spotlight', base);
    const fullText = textOf(full);
    expect(fullText).toContain('2020');
    expect(fullText).toContain('★ 8.5');
    expect(fullText).toContain('Action');
    expect(fullText).toContain('STREAMING ON');
    expect(fullText).toContain('Netflix');
    act(() => full.unmount());

    const quiet = renderCanvas('movie-spotlight', { ...base, showRating: false, showReleaseDate: false, showGenres: false, showProviders: false });
    const quietText = textOf(quiet);
    expect(quietText).not.toContain('★ 8.5');
    expect(quietText).not.toContain('Netflix');
    expect(quietText).not.toContain('STREAMING ON');
    act(() => quiet.unmount());
  });

  it('shows provider dates as-is and TBA for unknown ones in the upcoming template', () => {
    const dated: CreatorSlide = {
      ...createSlideForTemplate('upcoming-releases'),
      titleRefs: [ref({ title: 'Dated Release', releaseDate: '2027-03-15' })],
    };
    const datedText = textOf(renderCanvas('upcoming-releases', dated));
    expect(datedText).toContain('15');
    expect(datedText).toContain('MAR');
    expect(datedText).not.toContain('TBA');

    const undated: CreatorSlide = {
      ...createSlideForTemplate('upcoming-releases'),
      titleRefs: [ref({ title: 'Mystery Release' })],
    };
    const undatedText = textOf(renderCanvas('upcoming-releases', undated));
    expect(undatedText).toContain('TBA');
  });

  it('ranks five with padded badges', () => {
    const five: CreatorSlide = {
      ...createSlideForTemplate('top5'),
      titleRefs: Array.from({ length: 5 }, (_, index) => ref({ title: `Pick ${index + 1}`, providerId: String(index + 1) })),
    };
    const fiveText = textOf(renderCanvas('top5', five));
    expect(fiveText).toContain('05');
    expect(fiveText).toContain('Pick 5');
  });

  it('stacks rows with year chips and honest IMDb/TMDb badges', () => {
    const slide: CreatorSlide = {
      ...createSlideForTemplate('stacked-ranking'),
      subtitle: '2017',
      titleRefs: [
        ref({ title: 'Badged', year: 2017, imdbRating: 8.4, rating: 7.1, backdropUrl: 'https://example.test/b.jpg' }),
        ref({ title: 'ProviderOnly', providerId: '2', year: 2016, rating: 7.9 }),
      ],
    };
    const text = textOf(renderCanvas('stacked-ranking', slide));
    expect(text).toContain('Badged');
    expect(text).toContain('IMDb 8.4');
    expect(text).toContain('2017');
    expect(text).toContain('ProviderOnly');
    expect(text).toContain('★ 7.9');
    // The subtitle renders as the big display line above the stack.
    expect(text).toContain('2017');
  });

  it('shows the collage cover with its feature strip, swipe cue, and the follow card CTA', () => {
    const cover: CreatorSlide = {
      ...createSlideForTemplate('collage-cover'),
      titleRefs: [ref({ title: 'Cover One' }), ref({ title: 'Cover Two', providerId: '2' })],
    };
    const coverText = textOf(renderCanvas('collage-cover', cover));
    expect(coverText).toContain('MOST ICONIC PICKS');
    expect(coverText).toContain('SWIPE FOR THE FULL LIST');
    // Without project stats the strip counts the deck honestly (two movies).
    expect(coverText).toContain('02');
    expect(coverText).toContain('PICKS INSIDE');
    expect(coverText).toContain('ALL MOVIES');

    const promo: CreatorSlide = {
      ...createSlideForTemplate('page-promo'),
      titleRefs: [ref({ title: 'Backdrop Title', backdropUrl: 'https://example.test/b.jpg' })],
    };
    const promoText = textOf(renderCanvas('page-promo', promo, { branding: { name: 'Cine Club', handle: '@cineclub', tagline: 'Nightly picks' } }));
    expect(promoText).toContain('Cine Club');
    expect(promoText).toContain('@cineclub');
    expect(promoText).toContain('Nightly picks');
    // The profile card carries an explicit follow button.
    expect(promoText).toContain('Follow');
    expect(promoText).toContain('DON’T MISS THE NEXT DROP');

    // A closing note still carrying the cover's swipe cue reads wrong on the
    // follow card, so the card substitutes its own follow CTA.
    const cuedText = textOf(renderCanvas('page-promo', { ...promo, closing: 'Swipe for the full list →' }));
    expect(cuedText).toContain('DON’T MISS THE NEXT DROP');
    expect(cuedText).not.toContain('SWIPE FOR THE FULL LIST');
  });

  it('advertises the whole carousel on the cover, not just the fanned five', () => {
    const movies = (from: number, count: number) => Array.from({ length: count }, (_, index) => ref({ title: `Pick ${from + index}`, providerId: String(from + index) }));
    const slides: CreatorSlide[] = [
      { ...createSlideForTemplate('collage-cover'), titleRefs: movies(1, 5) },
      // The second slide repeats the cover's five; the others carry the rest.
      { ...createSlideForTemplate('top5'), titleRefs: movies(1, 5) },
      { ...createSlideForTemplate('top5'), titleRefs: movies(6, 5) },
      { ...createSlideForTemplate('top5'), titleRefs: movies(11, 5) },
    ];
    const collection = collectionTitleStats(slides);
    expect(collection).toEqual({ total: 15, movies: 15, shows: 0, anime: 0 });

    const text = textOf(renderCanvas('collage-cover', slides[0], { collection }));
    expect(text).toContain('"15"');
    expect(text).toContain('PICKS INSIDE');
    expect(text).toContain('ALL MOVIES');
    expect(text).not.toContain('FEATURED');

    // Mixed projects break the count down per kind.
    const mixed = textOf(renderCanvas('collage-cover', slides[0], { collection: { total: 7, movies: 5, shows: 1, anime: 1 } }));
    expect(mixed).toContain('5 MOVIES');
    expect(mixed).toContain('1 SHOW');
    expect(mixed).toContain('1 ANIME');
  });

  it('dispatches per slide layout over the project template', () => {
    const override: CreatorSlide = { ...createSlideForTemplate('movie-spotlight'), layout: 'collage-cover', closing: 'Swipe for the full list →' };
    const text = textOf(renderCanvas('movie-spotlight', override));
    // The collage's empty-poster coach is unique to that layout.
    expect(text).toContain('Add up to 5 posters to build the collage');
    expect(text).toContain('SWIPE FOR THE FULL LIST');
  });

  it('renders the light variant with a different surface than the dark one', () => {
    const slide = createSlideForTemplate('series-spotlight');
    const dark = textOf(renderCanvas('series-spotlight', slide, { theme: 'dark' }));
    const light = textOf(renderCanvas('series-spotlight', slide, { theme: 'light' }));
    expect(light).not.toBe(dark);
    expect(light).toContain('Your next binge');
  });
});
