import type { CreatorProjectData, CreatorTitleRef } from '@/domain/models/creator';

/**
 * Export-time image upgrade. Feeds request TMDb posters at w500 (and
 * backdrops at w780), which is right for browsing but soft once a slide is
 * rasterized at 1080 x 1350 — the same poster can fill a third of the frame.
 * Before capturing, the export stage renders from upgraded URLs instead.
 *
 * w1280 is the exact ceiling that matters: the captured PNG is 1080 px wide,
 * so no image can display wider than 1080 real pixels and a w1280 source is
 * pixel-perfect in every layout. Going to `original` would multiply download
 * time for zero visible gain, and every extra second risks capturing a slide
 * before its posters finish loading.
 *
 * Drafts keep their original URLs: only the stage image set is upgraded, so
 * stored data, the editor preview, and the image cache stay untouched.
 */

const EXPORT_SIZE_MAP: Record<string, string> = {
  w300: 'w780',
  w500: 'w1280',
  w780: 'w1280',
};

/** Rewrites a TMDb size segment (`/t/p/w500/`) to its export variant. */
export function upgradeExportImageUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const match = /\/t\/p\/(w\d+)\//.exec(url);
  if (!match) return url;
  const target = EXPORT_SIZE_MAP[match[1]];
  if (!target || target === match[1]) return url;
  return url.replace(`/t/p/${match[1]}/`, `/t/p/${target}/`);
}

/** The same project data with every title ref's artwork upgraded for capture. */
export function withExportQualityImages(data: CreatorProjectData): CreatorProjectData {
  let changed = false;
  const slides = data.slides.map((slide) => {
    let refsChanged = false;
    const titleRefs = slide.titleRefs.map((ref) => {
      const posterUrl = upgradeExportImageUrl(ref.posterUrl);
      const backdropUrl = upgradeExportImageUrl(ref.backdropUrl);
      if (posterUrl === ref.posterUrl && backdropUrl === ref.backdropUrl) return ref;
      refsChanged = true;
      return { ...ref, posterUrl, backdropUrl };
    });
    if (!refsChanged) return slide;
    changed = true;
    return { ...slide, titleRefs };
  });
  return changed ? { ...data, slides } : data;
}

/**
 * Every upgraded artwork URL the given refs will need. The export sheet
 * prefetches these the moment it opens so the capture wait finds them cached.
 */
export function collectExportImageUrls(refs: readonly CreatorTitleRef[]): string[] {
  const urls = new Set<string>();
  for (const ref of refs) {
    const poster = upgradeExportImageUrl(ref.posterUrl);
    const backdrop = upgradeExportImageUrl(ref.backdropUrl);
    if (poster) urls.add(poster);
    if (backdrop) urls.add(backdrop);
  }
  return [...urls];
}
