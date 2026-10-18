import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { SegmentedTabs } from '@/components/creator/editor/controls';
import type { CreatorProjectData, CreatorTemplateId } from '@/domain/models/creator';
import { buildExportPlan, EXPORT_HEIGHT, EXPORT_WIDTH, type ExportSlidePlan } from '@/features/creator/exportPlan';
import { saveImagesToGallery, shareImage } from '@/features/creator/exportService';
import { showFriendlyError } from '@/lib/friendlyError';
import { colors, radius, spacing } from '@/theme';

/**
 * Export sheet: renders the chosen slides locally at 1080 x 1350 (the slides
 * are authored at 360 x 450 and captured at 3x) and either saves them to the
 * gallery or opens the system share sheet. Rendering happens on demand, the
 * media-library permission is requested only when saving, and nothing leaves
 * the device except through the share sheet the user picks.
 */

type ExportScope = 'current' | 'all';
type Phase = 'idle' | 'rendering' | 'saving' | 'sharing';

export function ExportSheet({ visible, projectName, templateId, data, activeSlideId, capture, onClose }: {
  visible: boolean;
  projectName: string;
  templateId: CreatorTemplateId;
  data: CreatorProjectData;
  /** Slide the "This slide" scope exports. */
  activeSlideId: string;
  capture: (plan: ExportSlidePlan[], onProgress?: (done: number, total: number) => void) => Promise<string[]>;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<ExportScope>('all');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const multiSlide = data.slides.length > 1;
  const effectiveScope: ExportScope = multiSlide ? scope : 'current';
  const plan = useMemo(() => {
    try {
      return buildExportPlan(data, projectName, templateId, effectiveScope === 'all' ? 'all' : { slideId: activeSlideId });
    } catch {
      return [];
    }
  }, [data, projectName, templateId, effectiveScope, activeSlideId]);

  const busy = phase !== 'idle';
  const count = plan.length;

  async function renderPlan(target: ExportSlidePlan[] = plan): Promise<string[]> {
    setPhase('rendering');
    setProgress({ done: 0, total: target.length });
    try {
      return await capture(target, (done, total) => setProgress({ done, total }));
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (busy || !count) return;
    try {
      const uris = await renderPlan();
      setPhase('saving');
      const result = await saveImagesToGallery(uris);
      if (result.status === 'saved') {
        showToast(result.count === 1 ? 'Slide saved to your gallery' : `${result.count} slides saved in order`, 'success');
        onClose();
        return;
      }
      if (result.status === 'permission-denied') {
        const open = await showDialog({
          type: 'warning',
          title: 'Allow saving photos',
          message: 'Watch Later needs permission to add these images to your gallery. Turn on Photos access in system settings, then try again.',
          primaryAction: { label: 'Open settings' },
          secondaryAction: { label: 'Not now' },
        });
        if (open) void Linking.openSettings().catch(() => undefined);
        return;
      }
      throw new Error('Save failed');
    } catch (error) {
      void showFriendlyError(error, 'Couldn’t save your slides');
    } finally {
      setPhase('idle');
    }
  }

  async function share() {
    if (busy || !count) return;
    try {
      // Share sheets take a single image; render only the first slide instead
      // of the whole carousel.
      const uris = await renderPlan(plan.slice(0, 1));
      setPhase('sharing');
      const shared = await shareImage(uris[0], count === 1 ? 'Share your post' : 'Share your first slide');
      if (!shared) {
        await showDialog({
          type: 'info',
          title: 'Sharing isn’t available here',
          message: 'This device can’t open the share sheet. Save the slides to your gallery instead and attach them from Instagram.',
          primaryAction: { label: 'OK' },
        });
        return;
      }
      if (count > 1) {
        showToast('For the full carousel, save all slides and attach them in order', 'info', { durationMs: 5200 });
      }
      onClose();
    } catch (error) {
      void showFriendlyError(error, 'Couldn’t share your slides');
    } finally {
      setPhase('idle');
    }
  }

  const progressLabel = progress
    ? progress.total > 1 ? `Rendering slide ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Rendering your slide…'
    : phase === 'saving' ? 'Saving to your gallery…' : phase === 'sharing' ? 'Opening the share sheet…' : undefined;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close export options" style={StyleSheet.absoluteFill} disabled={busy} onPress={onClose} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <AppText variant="heading3">Export post</AppText>
              <AppText variant="caption" muted>{EXPORT_WIDTH} × {EXPORT_HEIGHT} PNG · Instagram portrait 4:5</AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close export options" onPress={onClose} disabled={busy} hitSlop={10} style={[styles.close, busy && styles.disabled]}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {multiSlide ? (
            <SegmentedTabs
              options={[{ value: 'all', label: `All ${data.slides.length} slides` }, { value: 'current', label: 'This slide' }]}
              value={scope}
              onChange={(value) => setScope(value)}
            />
          ) : null}
          <View style={styles.notes}>
            <View style={styles.noteRow}>
              <Ionicons name="image-outline" size={15} color={colors.accent} />
              <AppText variant="caption" muted style={styles.noteText}>
                {count > 1
                  ? `${count} slides render in order — pick them in that order in Instagram.`
                  : 'The image renders on this device; nothing is uploaded.'}
              </AppText>
            </View>
            {progressLabel ? (
              <View style={styles.noteRow}>
                <Ionicons name="sync-outline" size={15} color={colors.accent} />
                <AppText variant="caption" color={colors.textSecondary} style={styles.noteText}>{progressLabel}</AppText>
              </View>
            ) : null}
          </View>
          <View style={styles.actions}>
            <AppButton
              label={count > 1 ? `Save ${count} slides` : 'Save to gallery'}
              onPress={() => void save()}
              loading={busy && phase !== 'sharing'}
              disabled={busy || !count}
              icon={<Ionicons name="download-outline" size={17} color={colors.background} />}
            />
            <AppButton
              label={count > 1 ? 'Share first slide' : 'Share'}
              variant="secondary"
              onPress={() => void share()}
              loading={phase === 'sharing'}
              disabled={busy || !count}
              icon={<Ionicons name="share-outline" size={17} color={colors.textPrimary} />}
            />
          </View>
          <AppText variant="caption" muted style={styles.permission}>
            Saving asks for photos permission the first time.
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing['2xl'] },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  close: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  notes: { gap: spacing.sm },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noteText: { flex: 1, lineHeight: 18 },
  actions: { gap: spacing.sm },
  permission: { textAlign: 'center' },
});
