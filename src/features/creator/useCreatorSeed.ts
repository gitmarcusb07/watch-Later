import { useQuery } from '@tanstack/react-query';
import { catalogRepository } from '@/data/remote/catalog/RemoteCatalogRepository';
import { fetchHitReport } from '@/data/remote/supabase/globalHits';
import type {
  CreatorFormat,
  CreatorSlide,
  CreatorTemplateId,
  CreatorTitleRef,
} from '@/domain/models/creator';
import { useTrending, useUpcomingCatalog } from '@/features/catalog/hooks';
import { lastCompletedMonth, lastCompletedYear, type HitsPeriodType } from '@/features/hits/period';
import type { HitReportItem } from '@/features/hits/types';
import { useWatchlist } from '@/features/watchState/hooks';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { buildSeededSlides, titleRefFromHit, titleRefFromMedia } from './titleRefs';

/**
 * Seeded drafts: one tap turns a saved library into a ready-to-edit post.
 * Seeds only reuse data the app already fetches (watchlist, trending, upcoming,
 * Global Hits) and reuse each source's own React Query cache entry, so opening
 * the studio never triggers extra catalog requests. Everything missing stays
 * missing — seeds snapshot what exists, they never invent titles or dates.
 */

export const CREATOR_SEED_IDS = ['watchlist', 'taste', 'trending', 'upcoming', 'hits-month', 'hits-year'] as const;
export type CreatorSeedId = (typeof CREATOR_SEED_IDS)[number];

export interface CreatorSeedMeta {
  id: CreatorSeedId;
  label: string;
  detail: string;
  /** Ionicons glyph name (string so this module stays UI-library free). */
  icon: string;
}

export const CREATOR_SEEDS: readonly CreatorSeedMeta[] = [
  { id: 'watchlist', label: 'Watchlist collection', detail: 'Your saved titles as a carousel', icon: 'bookmark-outline' },
  { id: 'taste', label: 'Taste grid', detail: 'Nine saved titles as a 3×3 share card', icon: 'grid-outline' },
  { id: 'trending', label: 'Trending top 5', detail: 'What people are watching right now', icon: 'trending-up-outline' },
  { id: 'upcoming', label: 'Upcoming releases', detail: 'Dated releases you can plan for', icon: 'calendar-outline' },
  { id: 'hits-month', label: 'Global Hits · last month', detail: 'Movies and series ranked by popularity', icon: 'globe-outline' },
  { id: 'hits-year', label: 'Global Hits · last year', detail: 'The year’s most popular releases', icon: 'trophy-outline' },
];

export function isCreatorSeedId(value: unknown): value is CreatorSeedId {
  return typeof value === 'string' && (CREATOR_SEED_IDS as readonly string[]).includes(value);
}

export function parseCreatorSeed(value: unknown): CreatorSeedId | undefined {
  return isCreatorSeedId(value) ? value : undefined;
}

interface CreatorSeedTarget {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
}

export function creatorSeedTarget(seed: CreatorSeedId): CreatorSeedTarget {
  switch (seed) {
    case 'watchlist':
      return { templateId: 'watchlist-collection', format: 'carousel' };
    case 'taste':
      return { templateId: 'taste-grid', format: 'post' };
    case 'trending':
      return { templateId: 'top5', format: 'carousel' };
    case 'upcoming':
      return { templateId: 'upcoming-releases', format: 'carousel' };
    case 'hits-month':
    case 'hits-year':
      return { templateId: 'stacked-ranking', format: 'carousel' };
  }
}

/** Bounds per seed so a draft opens instantly and stays editable by hand. */
export const SEED_MAX_WATCHLIST = 18;
export const SEED_MAX_TASTE = 9;
export const SEED_MAX_UPCOMING = 20;
export const SEED_MAX_HITS_PER_TYPE = 5;
export const SEED_MAX_TRENDING = 5;

export interface CreatorSeedDraft extends CreatorSeedTarget {
  seed: CreatorSeedId;
  slides: CreatorSlide[];
  /** Titles actually seeded (0 means every source was empty). */
  titleCount: number;
}

export interface CreatorSeedState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  draft?: CreatorSeedDraft;
  /** Safe, user-facing message for the error state. */
  errorMessage?: string;
  retry: () => void;
}

function hitsSeedKey(type: HitsPeriodType): string {
  return type === 'month' ? lastCompletedMonth() : String(lastCompletedYear());
}

/**
 * The latest report for the most recently completed period: the published
 * snapshot when one exists, else the same bounded live preview the Global Hits
 * screen uses. Keyed apart from the hits screens’ cache entries so studio
 * seeds never collide with their retry semantics.
 */
function useHitsSeed(type: HitsPeriodType, enabled: boolean) {
  const key = hitsSeedKey(type);
  return useQuery({
    queryKey: ['creator', 'seed-hits', type, key] as const,
    queryFn: async (): Promise<{ movies: HitReportItem[]; series: HitReportItem[] }> => {
      const report = await fetchHitReport(type, key);
      if (report) return { movies: report.movies, series: report.series };
      const [movies, series] = await Promise.all([
        catalogRepository.getGlobalHitsLive(type, key, 'movie'),
        catalogRepository.getGlobalHitsLive(type, key, 'series'),
      ]);
      return { movies: movies.items, series: series.items };
    },
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: 1,
  });
}

/**
 * Resolves one seed into slides. Only the selected source is fetched (`enabled`
 * gates the remote queries); a guest with an empty watchlist gets an honest
 * zero-title draft instead of fabricated picks.
 */
export function useCreatorSeed(seed: CreatorSeedId | undefined): CreatorSeedState {
  const watchlist = useWatchlist(seed === 'watchlist' || seed === 'taste');
  const trending = useTrending(seed === 'trending');
  const upcoming = useUpcomingCatalog(seed === 'upcoming');
  const hitsMonth = useHitsSeed('month', seed === 'hits-month');
  const hitsYear = useHitsSeed('year', seed === 'hits-year');

  if (!seed) return { status: 'idle', retry: () => undefined };

  let loading = false;
  let errorMessage: string | undefined;
  let retry: () => void = () => undefined;
  let groups: CreatorTitleRef[][] = [];

  switch (seed) {
    case 'watchlist': {
      loading = watchlist.isLoading;
      if (watchlist.isError) errorMessage = friendlyErrorMessage(watchlist.error);
      retry = () => void watchlist.refetch();
      groups = [
        (watchlist.data ?? [])
          .slice(0, SEED_MAX_WATCHLIST)
          .map((entry) => titleRefFromMedia(entry.media)),
      ];
      break;
    }
    case 'taste': {
      loading = watchlist.isLoading;
      if (watchlist.isError) errorMessage = friendlyErrorMessage(watchlist.error);
      retry = () => void watchlist.refetch();
      groups = [
        (watchlist.data ?? [])
          .slice(0, SEED_MAX_TASTE)
          .map((entry) => titleRefFromMedia(entry.media)),
      ];
      break;
    }
    case 'trending': {
      loading = trending.isLoading;
      if (trending.isError) errorMessage = friendlyErrorMessage(trending.error);
      retry = () => void trending.refetch();
      groups = [(trending.data ?? []).slice(0, SEED_MAX_TRENDING).map(titleRefFromMedia)];
      break;
    }
    case 'upcoming': {
      loading = upcoming.isLoading;
      if (upcoming.isError) errorMessage = friendlyErrorMessage(upcoming.error);
      retry = () => void upcoming.refetch();
      groups = [(upcoming.data ?? []).slice(0, SEED_MAX_UPCOMING).map(titleRefFromMedia)];
      break;
    }
    case 'hits-month': {
      loading = hitsMonth.isLoading;
      if (hitsMonth.isError) errorMessage = friendlyErrorMessage(hitsMonth.error);
      retry = () => void hitsMonth.refetch();
      groups = hitsGroups(hitsMonth.data);
      break;
    }
    case 'hits-year': {
      loading = hitsYear.isLoading;
      if (hitsYear.isError) errorMessage = friendlyErrorMessage(hitsYear.error);
      retry = () => void hitsYear.refetch();
      groups = hitsGroups(hitsYear.data);
      break;
    }
  }

  if (errorMessage) return { status: 'error', errorMessage, retry };
  if (loading) return { status: 'loading', retry };

  const target = creatorSeedTarget(seed);
  const titleCount = groups.reduce((total, group) => total + group.length, 0);
  const slides = buildSeededSlides({ templateId: target.templateId, format: target.format, groups });
  return { status: 'ready', draft: { seed, ...target, slides, titleCount }, retry };
}

/** Movies slide(s) first, series slide(s) after — each capped per slide. */
function hitsGroups(data: { movies: HitReportItem[]; series: HitReportItem[] } | undefined): CreatorTitleRef[][] {
  if (!data) return [];
  return [
    data.movies.slice(0, SEED_MAX_HITS_PER_TYPE).map(titleRefFromHit),
    data.series.slice(0, SEED_MAX_HITS_PER_TYPE).map(titleRefFromHit),
  ];
}
