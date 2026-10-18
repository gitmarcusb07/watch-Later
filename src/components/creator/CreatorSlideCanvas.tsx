import { memo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { CreatorAccentId, CreatorSlide, CreatorTemplateId, CreatorTheme } from '@/domain/models/creator';
import { SLIDE_BASE_HEIGHT, SLIDE_BASE_WIDTH } from '@/features/creator/exportPlan';
import { creatorPalette } from './palette';
import { renderSlideTemplate } from './templates';

/**
 * One slide rendered on the fixed 360 x 450 (4:5) authoring canvas. Preview
 * usages pass a smaller `width` and are scaled as a single unit; the export
 * stage renders at the base size and `react-native-view-shot` captures it at
 * 3x (1080 x 1350). Template internals never depend on the render size.
 *
 * Props are the primitives a slide actually needs (not the whole project) so
 * memoization survives edits to other slides: an untouched slide keeps its
 * identity and skips re-rendering.
 */
export const CreatorSlideCanvas = memo(function CreatorSlideCanvas({ templateId, theme, accentId, showBranding, slide, width = SLIDE_BASE_WIDTH, radius = 0 }: {
  templateId: CreatorTemplateId;
  theme: CreatorTheme;
  accentId: CreatorAccentId;
  showBranding: boolean;
  slide: CreatorSlide;
  width?: number;
  radius?: number;
}) {
  const height = width * (SLIDE_BASE_HEIGHT / SLIDE_BASE_WIDTH);
  const palette = creatorPalette(theme, accentId);
  const scale = width / SLIDE_BASE_WIDTH;
  return (
    <View style={[styles.frame, { width, height, borderRadius: radius }]}>
      <View
        style={[
          styles.canvas,
          { backgroundColor: palette.background },
          scale !== 1 && { transform: [{ scale }], transformOrigin: 'top left' },
        ]}
      >
        <LinearGradient
          colors={[palette.glow, 'rgba(0,0,0,0)']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.3, y: 0.6 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.ring, { borderColor: palette.surfaceBorder }]} pointerEvents="none" />
        {renderSlideTemplate(templateId, slide, palette, showBranding)}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  canvas: { width: SLIDE_BASE_WIDTH, height: SLIDE_BASE_HEIGHT },
  ring: { position: 'absolute', right: -52, top: -46, width: 180, height: 180, borderRadius: 90, borderWidth: 1 },
});
