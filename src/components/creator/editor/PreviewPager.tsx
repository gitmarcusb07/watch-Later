import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';
import { colors, radius, spacing } from '@/theme';
import type { CreatorProjectData, CreatorTemplateId } from '@/domain/models/creator';

/**
 * Snap-paging preview of the project's slides. Pages are `pageWidth` wide so
 * pagingEnabled works on every screen size; each canvas keeps its own memo,
 * so swiping and editing never re-render the whole carousel.
 */
export function PreviewPager({ templateId, data, index, onChangeIndex, pageWidth, canvasWidth, canvasMaxHeight }: {
  templateId: CreatorTemplateId;
  data: CreatorProjectData;
  index: number;
  onChangeIndex: (index: number) => void;
  pageWidth: number;
  canvasWidth: number;
  /** Shrinks the canvas further when the screen is short (landscape/small phones). */
  canvasMaxHeight?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const width = canvasMaxHeight ? Math.min(canvasWidth, canvasMaxHeight / 1.25) : canvasWidth;

  // Keep the pager on the selected slide when the index changes elsewhere
  // (rail taps, slide add/remove) — never when the user is mid-swipe.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return undefined;
    }
    scrollRef.current?.scrollTo({ x: index * pageWidth, animated: true });
  }, [index, pageWidth]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
          if (next !== index) onChangeIndex(next);
        }}
        style={styles.pager}
      >
        {data.slides.map((slide) => (
          <View key={slide.id} style={[styles.page, { width: pageWidth }]}>
            <View style={styles.canvasWrap}>
              <CreatorSlideCanvas
                templateId={templateId}
                theme={data.theme}
                accentId={data.accentId}
                showBranding={data.showBranding}
                branding={data.branding}
                slide={slide}
                width={width}
                radius={radius.large}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.dots} accessibilityElementsHidden>
          {data.slides.map((slide, slideIndex) => (
            <View key={slide.id} style={[styles.dot, slideIndex === index && styles.dotActive]} />
          ))}
        </View>
        <AppText variant="caption" muted>{index + 1} / {data.slides.length}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  pager: { flexGrow: 0 },
  page: { alignItems: 'center', justifyContent: 'flex-start' },
  canvasWrap: { borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 16 },
});
