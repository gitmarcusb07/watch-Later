import { formatCompactCount } from '@/lib/format';
import { mapImdbRating } from '@/data/remote/supabase/imdbRatings';

describe('IMDb display helpers', () => {
  it('compacts vote counts', () => {
    expect(formatCompactCount(999)).toBe('999');
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(1500)).toBe('2K');
    expect(formatCompactCount(345678)).toBe('346K');
    expect(formatCompactCount(1234567)).toBe('1.2M');
    expect(formatCompactCount(2000000)).toBe('2M');
  });

  it('rejects missing or invalid counts', () => {
    expect(formatCompactCount(null)).toBeNull();
    expect(formatCompactCount(undefined)).toBeNull();
    expect(formatCompactCount(Number.NaN)).toBeNull();
    expect(formatCompactCount(-5)).toBeNull();
  });
});

describe('IMDb rating row mapping', () => {
  it('validates rating-only rows for card decoration', () => {
    expect(mapImdbRating({ rating: 7.3, votes: 851 })).toEqual({ rating: 7.3, votes: 851 });
    expect(mapImdbRating({ rating: Number.NaN, votes: 851 })).toBeNull();
    expect(mapImdbRating({ rating: 7.3, votes: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
