import type { CatalogMedia } from '@/domain/models/media';
import type { PagedCatalog } from '@/domain/repositories/CatalogRepository';

/**
 * Append-only merge for the Upcoming screen. Provider pages are ordered within
 * themselves but not necessarily across pages or across feeds, so re-sorting
 * the whole list whenever a page lands would yank whatever the user is
 * reading. Instead rows are emitted exactly once, in page order, sorted only
 * inside the batch that produced them — the list only ever grows at its tail,
 * so fast scrolling can neither jump nor lose rows.
 */

/** Minimal shape of one infinite feed the stream reads (keeps this pure). */
export interface UpcomingFeed {
  data?: { pages: PagedCatalog[] };
}

/** Items not yet emitted, in page order, deduped inside the batch. */
export function pendingUpcomingItems(feeds: readonly UpcomingFeed[], emitted: ReadonlySet<string>): CatalogMedia[] {
  const seen = new Set<string>();
  const items: CatalogMedia[] = [];
  for (const feed of feeds) {
    for (const page of feed.data?.pages ?? []) {
      for (const media of page.items) {
        if (seen.has(media.id) || emitted.has(media.id)) continue;
        seen.add(media.id);
        items.push(media);
      }
    }
  }
  return items;
}

/** Oldest release first; undated titles sink to the bottom of their batch. */
export function sortUpcomingBatch(items: readonly CatalogMedia[]): CatalogMedia[] {
  return [...items].sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'));
}
