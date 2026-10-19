import type { CreatorProjectData, CreatorTemplateId } from '@/domain/models/creator';

/**
 * Export planning for Instagram portrait feed. Rendered slides are authored on
 * a 360 x 450 logical canvas (exact 4:5) and captured at 3x to 1080 x 1350 —
 * this module owns those numbers so the editor and tests cannot drift.
 */

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1350;

/** Logical authoring size of every slide canvas (captured at width/360 = 3). */
export const SLIDE_BASE_WIDTH = 360;
export const SLIDE_BASE_HEIGHT = 450;

export const EXPORT_SCALE = EXPORT_WIDTH / SLIDE_BASE_WIDTH;

/**
 * The export stage renders each slide at 2x the authoring size (720 x 900)
 * before capture. Text and posters rasterize at capture resolution instead of
 * being upscaled from the 360-wide layout, which is what made downloaded
 * slides look soft once Instagram re-encoded them. The captured PNG is still
 * 1080 x 1350 — the extra render size only buys sharpness.
 */
export const EXPORT_RENDER_SCALE = 2;
export const EXPORT_STAGE_WIDTH = SLIDE_BASE_WIDTH * EXPORT_RENDER_SCALE;
export const EXPORT_STAGE_HEIGHT = SLIDE_BASE_HEIGHT * EXPORT_RENDER_SCALE;

export interface ExportSlidePlan {
  slideId: string;
  /** 1-based position in the exported set. */
  position: number;
  total: number;
  width: number;
  height: number;
  /** Filesystem-safe base name (no extension). */
  fileName: string;
}

export type ExportSelection = 'all' | { slideId: string };

/** Safe cross-platform base name: ASCII, bounded, never empty. */
export function safeFileBase(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/g, '');
  return ascii.length >= 3 ? ascii : 'watch-later-post';
}

export function creatorExportFileName(input: { projectName: string; templateId: CreatorTemplateId; position: number; total: number }): string {
  const base = safeFileBase(input.projectName);
  const suffix = input.total > 1 ? `-${input.position}of${input.total}` : '';
  return `watch-later-${base}${suffix}`;
}

/**
 * Ordered capture plan for the requested slides. Throws when the selection
 * names a slide the project does not contain — exporting must never silently
 * capture the wrong image.
 */
export function buildExportPlan(data: CreatorProjectData, projectName: string, templateId: CreatorTemplateId, selection: ExportSelection): ExportSlidePlan[] {
  const slides = selection === 'all'
    ? data.slides
    : data.slides.filter((slide) => slide.id === selection.slideId);
  if (!slides.length) throw new Error('That slide is no longer part of this project.');
  const total = slides.length;
  return slides.map((slide, index) => ({
    slideId: slide.id,
    position: index + 1,
    total,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    fileName: creatorExportFileName({ projectName, templateId, position: index + 1, total }),
  }));
}
