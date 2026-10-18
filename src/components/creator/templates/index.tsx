import type { ReactElement } from 'react';
import type { CreatorSlide, CreatorTemplateId } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { SpotlightSlide } from './SpotlightSlide';
import { RankedListSlide } from './RankedListSlide';
import { ComparisonSlide } from './ComparisonSlide';
import { CollectionGridSlide } from './CollectionGridSlide';
import { UpcomingSlide } from './UpcomingSlide';

/** Single dispatch point from a template id to its renderer. */
export function renderSlideTemplate(templateId: CreatorTemplateId, slide: CreatorSlide, palette: CreatorPalette, showBranding: boolean): ReactElement {
  const common = { slide, palette, showBranding };
  switch (templateId) {
    case 'movie-spotlight':
      return <SpotlightSlide variant="movie" {...common} />;
    case 'series-spotlight':
      return <SpotlightSlide variant="series" {...common} />;
    case 'top5':
      return <RankedListSlide variant="top5" {...common} />;
    case 'top10':
      return <RankedListSlide variant="top10" {...common} />;
    case 'movie-comparison':
      return <ComparisonSlide {...common} />;
    case 'watchlist-collection':
      return <CollectionGridSlide {...common} />;
    case 'upcoming-releases':
      return <UpcomingSlide {...common} />;
  }
}
