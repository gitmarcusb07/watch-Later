import { getWatchLaterActionPresentation } from '@/features/watchState/watchLaterAction';

describe('Watch Later action presentation', () => {
  it('replaces a saved ASAP priority with Watching now while progress is active', () => {
    expect(getWatchLaterActionPresentation({ saved: true, priority: 'asap', watching: true })).toMatchObject({
      label: 'Watching now',
      icon: 'play-circle',
      tone: 'watching',
      motion: 'pulse',
    });
  });

  it('keeps the priority label when the title has not been started', () => {
    expect(getWatchLaterActionPresentation({ saved: true, priority: 'asap', watching: false })).toMatchObject({
      label: 'ASAP',
      icon: 'rocket-outline',
      tone: 'asap',
      motion: 'launch',
    });
  });

  it('keeps Watched/Complete titles out of the Watching state', () => {
    // `watching` is false when the series is complete, so the priority chip
    // remains available if the title was also saved.
    expect(getWatchLaterActionPresentation({ saved: true, priority: 'weekend', watching: false })).toMatchObject({
      label: 'Weekend',
      tone: 'weekend',
    });
  });

  it('falls back to plain Watch Later when the title is not saved', () => {
    expect(getWatchLaterActionPresentation({ saved: false, priority: null, watching: false })).toMatchObject({
      label: 'Watch Later',
      icon: 'time-outline',
      tone: 'watch-later',
    });
  });
});
