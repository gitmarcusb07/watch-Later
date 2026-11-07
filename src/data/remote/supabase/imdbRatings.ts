import { supabase } from './client';

interface ImdbRatingRow {
  tmdb_id: number;
  media_type: string;
  rating: number;
  votes: number;
}

export interface ImdbRating {
  rating: number;
  votes: number;
}

/** Validates a rating-only row (unranked recent snapshots included). */
export function mapImdbRating(row: Pick<ImdbRatingRow, 'rating' | 'votes'>): ImdbRating | null {
  if (typeof row.rating !== 'number' || !Number.isFinite(row.rating)) return null;
  if (typeof row.votes !== 'number' || !Number.isFinite(row.votes)) return null;
  return { rating: row.rating, votes: row.votes };
}

/** Batch IMDb scores for displayed titles, keyed `mediaType:tmdbId`. Never throws. */
export async function fetchImdbRatingsFor(items: { tmdbId: number; mediaType: 'movie' | 'series' }[]): Promise<Map<string, ImdbRating>> {
  const result = new Map<string, ImdbRating>();
  const client = supabase;
  if (!client || !items.length) return result;
  try {
    const byType = new Map<'movie' | 'series', number[]>();
    for (const item of items) {
      const list = byType.get(item.mediaType) ?? [];
      if (!list.includes(item.tmdbId)) list.push(item.tmdbId);
      byType.set(item.mediaType, list);
    }
    const responses = await Promise.all(
      [...byType.entries()].map(([mediaType, ids]) =>
        client
          .from('imdb_ratings')
          .select('tmdb_id,media_type,rating,votes')
          .eq('media_type', mediaType)
          .in('tmdb_id', ids.slice(0, 100)),
      ),
    );
    for (const [index, response] of responses.entries()) {
      const mediaType = [...byType.keys()][index];
      if (response.error || !response.data) continue;
      for (const row of response.data as Pick<ImdbRatingRow, 'tmdb_id' | 'rating' | 'votes'>[]) {
        const rating = mapImdbRating(row);
        if (rating && Number.isSafeInteger(row.tmdb_id)) result.set(`${mediaType}:${row.tmdb_id}`, rating);
      }
    }
  } catch {
    // Ratings are decoration: the list renders without them.
  }
  return result;
}
