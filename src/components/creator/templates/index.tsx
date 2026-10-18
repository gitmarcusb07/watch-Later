import type { ReactElement } from 'react';
import type { CreatorBranding, CreatorSlide, CreatorTemplateId } from '@/domain/models/creator';
import type { CreatorCollectionStats } from '@/features/creator/templates';
import type { CreatorPalette } from '../palette';
import { SpotlightSlide } from './SpotlightSlide';
import { RankedListSlide } from './RankedListSlide';
import { StackedRankingSlide } from './StackedRankingSlide';
import { CollageCoverSlide } from './CollageCoverSlide';
import { PagePromoSlide } from './PagePromoSlide';
import { ComparisonSlide } from './ComparisonSlide';
import { CollectionGridSlide } from './CollectionGridSlide';
import { UpcomingSlide } from './UpcomingSlide';

/** Single dispatch point from a template id to its renderer. */
export function renderSlideTemplate(
  templateId: CreatorTemplateId,
  slide: CreatorSlide,
  palette: CreatorPalette,
  showBranding: boolean,
  branding: CreatorBranding,
  /** Ranks consumed by earlier slides in a continuous numbered run (see `slideRankOffset`). */
  rankOffset = 0,
  /** Project-wide pick stats for layouts that advertise the whole carousel. */
  collection?: CreatorCollectionStats,
): ReactElement {
  const common = { slide, palette, showBranding, branding };
  switch (templateId) {
    case 'collage-cover':
      return <CollageCoverSlide {...common} collection={collection} />;
    case 'stacked-ranking':
      return <StackedRankingSlide {...common} />;
    case 'page-promo':
      return <PagePromoSlide {...common} />;
    case 'movie-spotlight':
      return <SpotlightSlide variant="movie" {...common} />;
    case 'series-spotlight':
      return <SpotlightSlide variant="series" {...common} />;
    case 'top5':
      return <RankedListSlide {...common} rankOffset={rankOffset} />;
    case 'movie-comparison':
      return <ComparisonSlide {...common} />;
    case 'watchlist-collection':
      return <CollectionGridSlide {...common} />;
    case 'upcoming-releases':
      return <UpcomingSlide {...common} />;
  }
}
