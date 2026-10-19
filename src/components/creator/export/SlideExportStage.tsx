import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { CreatorProjectData, CreatorTemplateId } from '@/domain/models/creator';
import { EXPORT_STAGE_HEIGHT, EXPORT_STAGE_WIDTH, type ExportSlidePlan } from '@/features/creator/exportPlan';
import { withExportQualityImages } from '@/features/creator/exportImages';
import { collectionTitleStats, slideLayoutOf, slideRankOffset } from '@/features/creator/templates';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';

/**
 * Offscreen capture surface. When an export is requested the stage renders
 * the planned slides at 2x the 360 x 450 authoring size (720 x 900, see
 * `EXPORT_RENDER_SCALE`) with their artwork upgraded to export resolution
 * (see `withExportQualityImages`), waits for poster images to reach the cache
 * (bounded — a broken image must never block an export), and captures each
 * slide at 1080 x 1350 through `react-native-view-shot`. The stage sits
 * underneath the screen chrome, so it is laid out, drawn, and capture-able
 * but never visible.
 */

const IMAGE_WAIT_MS = 2500;

export interface CaptureRequest {
  plan: ExportSlidePlan[];
}

export interface SlideExporter {
  /** React node to render underneath the screen content while idle or exporting. */
  node: ReactNode;
  /** Captures the planned slides in order, returning one local PNG uri per slide. */
  capture: (plan: ExportSlidePlan[], onProgress?: (done: number, total: number) => void) => Promise<string[]>;
}

export function useSlideExporter(templateId: CreatorTemplateId, data: CreatorProjectData): SlideExporter {
  const refs = useRef(new Map<string, View | null>());
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const resolver = useRef<{ resolve: (uris: string[]) => void; reject: (error: unknown) => void; onProgress?: (done: number, total: number) => void } | null>(null);

  // The capture surface never renders the saved draft URLs: posters and
  // backdrops are swapped for their export-resolution variants here.
  const exportData = useMemo(() => withExportQualityImages(data), [data]);

  const capture = useCallback((plan: ExportSlidePlan[], onProgress?: (done: number, total: number) => void) => new Promise<string[]>((resolve, reject) => {
    resolver.current = { resolve, reject, onProgress };
    setRequest({ plan });
  }), []);

  useEffect(() => {
    if (!request || !resolver.current) return;
    const { plan } = request;
    const { resolve, reject, onProgress } = resolver.current;
    let cancelled = false;

    const posterUrls = collectPosterUrls(exportData, plan);
    const prefetch = Promise.all(posterUrls.map((url) => Image.prefetch(url).catch(() => false)));

    const settle = () => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 120)));
    const timeout = new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), IMAGE_WAIT_MS + 400));

    void Promise.race([prefetch.then(settle), timeout]).then(async () => {
      if (cancelled) return;
      try {
        const uris: string[] = [];
        for (const item of plan) {
          const node = refs.current.get(item.slideId);
          if (!node) throw new Error('The export surface is not ready yet. Please try again.');
          uris.push(await captureRef(node, {
            width: item.width,
            height: item.height,
            format: 'png',
            result: 'tmpfile',
            fileName: `${item.fileName}.png`,
          }));
          onProgress?.(uris.length, plan.length);
        }
        resolve(uris);
      } catch (error) {
        reject(error);
      } finally {
        resolver.current = null;
        setRequest(null);
      }
    });

    return () => { cancelled = true; };
  }, [request, exportData]);

  const collection = collectionTitleStats(exportData.slides);
  const node = request ? (
    <View style={styles.stage} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessible={false}>
      {request.plan.map((item) => {
        const slideIndex = exportData.slides.findIndex((candidate) => candidate.id === item.slideId);
        if (slideIndex < 0) return null;
        const slide = exportData.slides[slideIndex];
        return (
          <View
            key={item.slideId}
            ref={(nodeRef) => { refs.current.set(item.slideId, nodeRef); }}
            collapsable={false}
            style={styles.slide}
          >
            <CreatorSlideCanvas
              templateId={templateId}
              theme={data.theme}
              accentId={data.accentId}
              showBranding={data.showBranding}
              branding={data.branding}
              slide={slide}
              width={EXPORT_STAGE_WIDTH}
              rankOffset={slideRankOffset(exportData.slides, templateId, slideIndex)}
              collection={slideLayoutOf(slide, templateId) === 'collage-cover' ? collection : undefined}
            />
          </View>
        );
      })}
    </View>
  ) : null;

  return { node, capture };
}

function collectPosterUrls(data: CreatorProjectData, plan: ExportSlidePlan[]): string[] {
  const wanted = new Set(plan.map((item) => item.slideId));
  const urls = new Set<string>();
  for (const slide of data.slides) {
    if (!wanted.has(slide.id)) continue;
    for (const ref of slide.titleRefs) {
      if (ref.posterUrl) urls.add(ref.posterUrl);
      if (ref.backdropUrl) urls.add(ref.backdropUrl);
    }
  }
  return [...urls];
}

const styles = StyleSheet.create({
  // Laid out at the top-left of the screen root. The export sheet (a native
  // modal above the app) covers it while capturing. It must stay attached and
  // rendered — hiding it with opacity/display would capture an empty image.
  stage: { position: 'absolute', top: 0, left: 0, width: EXPORT_STAGE_WIDTH },
  slide: { width: EXPORT_STAGE_WIDTH, height: EXPORT_STAGE_HEIGHT, marginBottom: 8 },
});
