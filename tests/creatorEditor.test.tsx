import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';
import {
  CREATOR_TEMPLATE_IDS,
  type CreatorAccentId,
  type CreatorSlide,
  type CreatorTemplateId,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import { createSlideForTemplate } from '@/features/creator/titleRefs';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function ref(overrides: Partial<CreatorTitleRef> & { title: string }): CreatorTitleRef {
  return { provider: 'tmdb', mediaType: 'movie', providerId: '1', genres: [], ...overrides };
}

function renderCanvas(
  templateId: CreatorTemplateId,
  slide: CreatorSlide,
  options: { theme?: 'dark' | 'light'; accentId?: CreatorAccentId; width?: number } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <CreatorSlideCanvas
        templateId={templateId}
        theme={options.theme ?? 'dark'}
        accentId={options.accentId ?? 'lavender'}
        showBranding
        slide={slide}
        width={options.width ?? 180}
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
    expect(text).toContain('WATCH LATER');
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

  it('ranks five with padded badges and ten across two columns', () => {
    const five: CreatorSlide = {
      ...createSlideForTemplate('top5'),
      titleRefs: Array.from({ length: 5 }, (_, index) => ref({ title: `Pick ${index + 1}`, providerId: String(index + 1) })),
    };
    const fiveText = textOf(renderCanvas('top5', five));
    expect(fiveText).toContain('05');
    expect(fiveText).toContain('Pick 5');

    const ten: CreatorSlide = {
      ...createSlideForTemplate('top10'),
      titleRefs: Array.from({ length: 10 }, (_, index) => ref({ title: `Pick ${index + 1}`, providerId: String(index + 1) })),
    };
    const tenText = textOf(renderCanvas('top10', ten));
    expect(tenText).toContain('10');
    expect(tenText).toContain('Pick 10');
  });

  it('renders the light variant with a different surface than the dark one', () => {
    const slide = createSlideForTemplate('series-spotlight');
    const dark = textOf(renderCanvas('series-spotlight', slide, { theme: 'dark' }));
    const light = textOf(renderCanvas('series-spotlight', slide, { theme: 'light' }));
    expect(light).not.toBe(dark);
    expect(light).toContain('Your next binge');
  });
});
