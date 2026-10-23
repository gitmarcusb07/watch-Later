import { FRANCHISES } from '@/data/remote/franchises/catalog.generated';
import type { FranchiseCollection, FranchiseItem } from '@/domain/models/franchise';
import { searchMatchTier } from '@/data/remote/catalog/searchRank';

/**
 * Release order is the promise the detail screen makes ("In order"), so it is
 * enforced here too — not only by the generator: members sort ascending by
 * their full release date, anything undated sinks to the end, and ties keep
 * the generated (seed) order because Array#sort is stable.
 */
function byReleaseDate(items: readonly FranchiseItem[]): FranchiseItem[] {
  return [...items].sort((a, b) => {
    const da = a.releaseDate ?? '';
    const db = b.releaseDate ?? '';
    if (da === db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  });
}

const COLLECTIONS: readonly FranchiseCollection[] = FRANCHISES.map((entry) => ({ ...entry, items: byReleaseDate(entry.items) }));

/** Every curated franchise collection, sorted by title (generation order). */
export const franchiseCollections: readonly FranchiseCollection[] = COLLECTIONS;

export function franchiseBySlug(slug: string | undefined): FranchiseCollection | undefined {
  if (!slug) return undefined;
  return COLLECTIONS.find((entry) => entry.slug === slug);
}

/** Route id for a franchise member, matching the `/media/[id]` scheme. */
export function franchiseItemRouteId(item: FranchiseItem): string {
  return `${item.provider}:${item.mediaType}:${encodeURIComponent(item.providerId)}`;
}

/**
 * Curated popularity order for the home carousel: global blockbusters first,
 * then widely followed Indian universes, then anime and animation. Anything
 * not listed still appears, alphabetically after the ranked set, so the row
 * stays complete and deterministic.
 */
const HOME_POPULAR_SLUGS = [
  'mcu',
  'star-wars-collection',
  'the-wizarding-world-of-harry-potter',
  'the-hobbit-lotr-universe',
  'the-jurassic-franchise',
  'the-fast-and-the-furious-series',
  'the-complete-dceu-saga',
  'the-john-wick-universe',
  'the-conjuring-universe',
  'the-mission-impossible-series',
  'the-james-bond-collection',
  'sam-raimi-s-spider-man-trilogy',
  'lcu',
  'the-baahubali-universe',
  'rohit-shetty-s-cop-universe',
  'yrf-spy-universe',
  'the-kantara-universe',
  'x-men-universe',
  'the-pirates-of-the-caribbean-series',
  'the-indiana-jones-franchise',
  'the-world-of-transformers',
  'the-matrix-franchise',
  'the-bourne-saga',
  'the-hunger-games',
  'sony-s-spider-man-universe',
  'the-alien-franchise',
  'the-terminator-franchise',
  'the-shrekverse',
  'the-minions-franchise',
  'stories-of-toy-story',
  'the-pokemon-collection',
  'the-doraemon-collection',
  'case-files-of-detective-conan',
  'one-piece-movies-collection',
];

const HOME_RANK = new Map(HOME_POPULAR_SLUGS.map((slug, index) => [slug, index]));

/** Home carousel slice: popular franchises first, the rest alphabetical. */
export function franchisesForHome(limit = 8): FranchiseCollection[] {
  return [...COLLECTIONS].sort((a, b) => {
    const rankA = HOME_RANK.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const rankB = HOME_RANK.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.title.localeCompare(b.title);
  }).slice(0, limit);
}

/** The home carousel is static catalog data, so rank it once at module load. */
export const homeFranchises = franchisesForHome(8);

function itemTier(entry: FranchiseCollection, query: string): number {
  let tier = 4;
  for (const item of entry.items) {
    tier = Math.min(tier, searchMatchTier(item.title, query));
    if (tier === 0) break;
  }
  return tier;
}

/**
 * Filters franchise collections for the on-screen search box. A collection
 * matches when the query hits its own title or any member title; best title
 * tier wins (exact → prefix → word → substring), alphabetical inside a tier
 * so the order stays stable while typing. Empty query returns everything.
 */
export function filterFranchises(
  entries: readonly FranchiseCollection[] = COLLECTIONS,
  query: string,
): FranchiseCollection[] {
  const trimmed = query.trim();
  if (!trimmed) return [...entries];
  return entries
    .map((entry) => ({
      entry,
      tier: Math.min(searchMatchTier(entry.title, trimmed), itemTier(entry, trimmed)),
    }))
    .filter((row) => row.tier < 4)
    .sort((a, b) => a.tier - b.tier || a.entry.title.localeCompare(b.entry.title))
    .map((row) => row.entry);
}
