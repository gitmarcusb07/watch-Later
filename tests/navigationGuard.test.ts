import { createTapGuard, navigationTargetKey } from '@/lib/navigationGuard';

describe('createTapGuard', () => {
  it('allows the first tap and swallows a quick repeat of the same target', () => {
    const allow = createTapGuard(800);
    expect(allow('media:1', 1000)).toBe(true);
    expect(allow('media:1', 1200)).toBe(false);
    expect(allow('media:1', 1799)).toBe(false);
    expect(allow('media:1', 1800)).toBe(true);
  });

  it('never swallows a different target', () => {
    const allow = createTapGuard(800);
    expect(allow('media:1', 1000)).toBe(true);
    expect(allow('media:2', 1050)).toBe(true);
    expect(allow('media:2', 1100)).toBe(false);
  });
});

describe('navigationTargetKey', () => {
  it('builds the same key for equivalent object targets regardless of param order', () => {
    expect(navigationTargetKey({ pathname: '/media/[id]', params: { id: '42', season: '2' } }))
      .toBe(navigationTargetKey({ pathname: '/media/[id]', params: { season: '2', id: '42' } }));
  });

  it('keeps string hrefs distinct', () => {
    expect(navigationTargetKey('/search')).toBe('/search');
    expect(navigationTargetKey({ pathname: '/media/[id]', params: { id: '42' } })).not.toBe('/search');
  });
});
