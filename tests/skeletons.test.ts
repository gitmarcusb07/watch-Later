import { posterSkeletonDimensions } from '@/components/feedback/FeedbackViews';

describe('loading skeleton dimensions', () => {
  it('sizes a poster skeleton from the real card width', () => {
    expect(posterSkeletonDimensions(150)).toEqual({ width: 150, height: 219 });
  });
});
