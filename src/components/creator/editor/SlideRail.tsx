import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/buttons/IconButton';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';
import { slideRankOffset } from '@/features/creator/templates';
import { colors, radius, spacing } from '@/theme';
import type { CreatorProjectData, CreatorSlide, CreatorTemplateId } from '@/domain/models/creator';

/**
 * The slide strip: thumbnails for reordering context plus the per-slide
 * actions (move, duplicate, delete) that keep the editor canvas-free — no
 * drag gestures, no new dependencies, everything reachable with one tap.
 */

const THUMB_WIDTH = 58;

export function SlideRail({ templateId, data, slides, index, canAddSlide, onSelect, onAdd, onMove, onDuplicate, onRemove }: {
  templateId: CreatorTemplateId;
  data: CreatorProjectData;
  slides: CreatorSlide[];
  index: number;
  canAddSlide: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onMove: (slideId: string, direction: -1 | 1) => void;
  onDuplicate: (slideId: string) => void;
  onRemove: (slideId: string) => void;
}) {
  const active = slides[Math.min(index, slides.length - 1)];
  const activeIndex = slides.indexOf(active);
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {slides.map((slide, slideIndex) => {
          const selected = slideIndex === activeIndex;
          return (
            <Pressable
              key={slide.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`Slide ${slideIndex + 1} of ${slides.length}`}
              onPress={() => onSelect(slideIndex)}
              style={[styles.thumb, selected && styles.thumbActive]}
            >
              <CreatorSlideCanvas
                templateId={templateId}
                theme={data.theme}
                accentId={data.accentId}
                showBranding={data.showBranding}
                branding={data.branding}
                slide={slide}
                width={THUMB_WIDTH}
                rankOffset={slideRankOffset(slides, templateId, slideIndex)}
              />
              <View style={[styles.thumbBadge, selected && styles.thumbBadgeActive]}>
                <AppText variant="caption" color={selected ? colors.background : colors.textSecondary} style={styles.thumbBadgeText}>{slideIndex + 1}</AppText>
              </View>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canAddSlide ? 'Add a slide' : 'Slide limit reached'}
          accessibilityState={{ disabled: !canAddSlide }}
          disabled={!canAddSlide}
          onPress={onAdd}
          style={[styles.add, !canAddSlide && styles.disabled]}
        >
          <Ionicons name="add" size={22} color={colors.textSecondary} />
        </Pressable>
      </ScrollView>
      <View style={styles.actions}>
        <AppText variant="caption" muted style={styles.actionsLabel}>SLIDE {activeIndex + 1}</AppText>
        <IconButton name="chevron-back" label="Move this slide earlier" size={18} variant="subtle" onPress={() => active && onMove(active.id, -1)} />
        <IconButton name="chevron-forward" label="Move this slide later" size={18} variant="subtle" onPress={() => active && onMove(active.id, 1)} />
        <IconButton name="copy-outline" label="Duplicate this slide" size={18} variant="subtle" onPress={() => active && onDuplicate(active.id)} />
        <IconButton name="trash-outline" label="Delete this slide" size={18} variant="subtle" onPress={() => active && onRemove(active.id)} />
        {!canAddSlide ? <AppText variant="caption" muted style={styles.limit}>Slide limit reached</AppText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  strip: { gap: spacing.sm, paddingVertical: 2 },
  thumb: { borderRadius: radius.small + 2, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  thumbActive: { borderColor: colors.accent },
  thumbBadge: { position: 'absolute', left: 4, top: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: 'rgba(10,10,12,0.72)', alignItems: 'center', justifyContent: 'center' },
  thumbBadgeActive: { backgroundColor: colors.accent },
  thumbBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  add: { width: THUMB_WIDTH, height: THUMB_WIDTH * 1.25, borderRadius: radius.small + 2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionsLabel: { letterSpacing: 1, marginRight: spacing.xs },
  limit: { flex: 1, textAlign: 'right' },
});
