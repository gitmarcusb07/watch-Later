import { fetchImdbRatingsFor } from '@/data/remote/supabase/imdbRatings';
import type { CreatorTitleRef } from '@/domain/models/creator';

/**
 * Applies real IMDb scores to freshly selected title refs. Only TMDb-backed
 * movies/series can match the IMDb snapshot table (it is keyed by TMDb id);
 * everything else is returned untouched. The lookup never throws — ratings
 * are decoration, and a missing score simply falls back to the TMDb badge.
 * The enriched score is stored on the ref, so saved drafts keep it offline.
 */
export async function enrichTitleRefsWithImdb(refs: CreatorTitleRef[]): Promise<CreatorTitleRef[]> {
  const items = refs
    .filter((ref) => ref.provider === 'tmdb' && (ref.mediaType === 'movie' || ref.mediaType === 'series') && /^\d+$/.test(ref.providerId))
    .map((ref) => ({ tmdbId: Number(ref.providerId), mediaType: ref.mediaType as 'movie' | 'series' }));
  if (!items.length) return refs;
  const ratings = await fetchImdbRatingsFor(items);
  if (!ratings.size) return refs;
  return refs.map((ref) => {
    if (ref.provider !== 'tmdb' || (ref.mediaType !== 'movie' && ref.mediaType !== 'series') || !/^\d+$/.test(ref.providerId)) return ref;
    const found = ratings.get(`${ref.mediaType}:${Number(ref.providerId)}`);
    return found ? { ...ref, imdbRating: found.rating } : ref;
  });
}
