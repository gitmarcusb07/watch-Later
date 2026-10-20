import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { IconButton } from '@/components/buttons/IconButton';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { CreatorSlideCanvas } from '@/components/creator/CreatorSlideCanvas';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { LoadingView } from '@/components/feedback/FeedbackViews';
import { CREATOR_TEMPLATES } from '@/features/creator/templates';
import { CREATOR_SEEDS } from '@/features/creator/useCreatorSeed';
import { createSlideForTemplate, titleRefFromMedia } from '@/features/creator/titleRefs';
import { useCreatorDrafts, useDeleteCreatorDraft } from '@/features/creator/hooks';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '@/features/creator/exportPlan';
import { useWatchlist } from '@/features/watchState/hooks';
import type { CreatorProjectSummary, CreatorTemplateId } from '@/domain/models/creator';
import { timeAgo } from '@/lib/relativeTime';
import { showFriendlyError } from '@/lib/friendlyError';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

const TEMPLATE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'post', label: 'Posts' },
  { id: 'carousel', label: 'Carousels' },
  { id: 'grid', label: 'Grids' },
] as const;

type TemplateFilter = (typeof TEMPLATE_FILTERS)[number]['id'];

/**
 * Creator Studio home: every way into the editor (a live taste-grid preview,
 * seeds from the user's own data, templates, and saved drafts). Drafts live on
 * this device — there is no account anywhere in the studio, and nothing is
 * ever uploaded.
 */
export default function CreatorStudioScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const draftsQuery = useCreatorDrafts();
  const deleteDraft = useDeleteCreatorDraft();
  const watchlistQuery = useWatchlist();
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all');
  const tasteRefs = useMemo(
    () => (watchlistQuery.data ?? []).slice(0, 9).map((entry) => titleRefFromMedia(entry.media)),
    [watchlistQuery.data],
  );
  const tasteSlide = useMemo(
    () => ({ ...createSlideForTemplate('taste-grid'), titleRefs: tasteRefs }),
    [tasteRefs],
  );
  const previewWidth = Math.min(300, Math.max(224, width - 2 * spacing.xl - 2 * spacing.lg));

  async function confirmDelete(project: CreatorProjectSummary) {
    const confirmed = await showDialog({
      type: 'warning',
      title: 'Delete this draft?',
      message: `“${project.name}” will be removed from this device. Exported images you already saved stay in your gallery.`,
      primaryAction: { label: 'Delete', destructive: true },
      secondaryAction: { label: 'Cancel' },
    });
    if (!confirmed) return;
    deleteDraft.mutate(project.id, {
      onSuccess: () => showToast('Draft deleted', 'info'),
      onError: (error) => void showFriendlyError(error, 'Couldn’t delete that draft'),
    });
  }

  function openTasteGrid() {
    triggerLightHaptic();
    if (tasteRefs.length) router.push({ pathname: '/creator/editor', params: { seed: 'taste' } });
    else router.push({ pathname: '/creator/editor', params: { templateId: 'taste-grid', format: 'post' } });
  }

  function openTemplate(templateId: CreatorTemplateId, format: 'post' | 'carousel') {
    triggerLightHaptic();
    if (templateId === 'taste-grid' && tasteRefs.length) {
      router.push({ pathname: '/creator/editor', params: { seed: 'taste' } });
      return;
    }
    router.push({ pathname: '/creator/editor', params: { templateId, format } });
  }

  const filteredTemplates = useMemo(() => CREATOR_TEMPLATES.filter((template) => {
    if (templateFilter === 'all') return true;
    if (templateFilter === 'grid') return template.id === 'taste-grid';
    return template.id !== 'taste-grid' && template.defaultFormat === templateFilter;
  }), [templateFilter]);
  const drafts = draftsQuery.data ?? [];
  const tasteFilled = tasteRefs.length;

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={draftsQuery.isRefetching && !draftsQuery.isLoading} onRefresh={() => void draftsQuery.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}>
      <FadeInView>
        <View style={styles.topRow}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
          <View style={styles.topBadge}><Ionicons name="sparkles" size={12} color={colors.accent} /><AppText style={styles.topBadgeText}>CREATOR STUDIO</AppText></View>
        </View>
        <AppText style={styles.heroTitle}>Share your taste.</AppText>
        <AppText variant="bodySmall" muted style={styles.heroSubtitle}>Nine picks, one grid. Turn your watchlist into a 3×3 share card, then make every label yours.</AppText>
      </FadeInView>

      <FadeInView delay={80}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open taste grid preview. ${tasteFilled} of 9 slots filled`}
          onPress={openTasteGrid}
          style={({ pressed }) => [styles.tasteCard, { width: previewWidth + 2 * spacing.md }, pressed && styles.rowPressed]}
        >
          <View style={styles.tasteCanvas}>
            <CreatorSlideCanvas
              templateId="taste-grid"
              theme="dark"
              accentId="lavender"
              showBranding
              slide={tasteSlide}
              width={previewWidth}
              radius={18}
            />
          </View>
          <View style={styles.tasteFooter}>
            <View style={styles.tasteFooterCopy}>
              <AppText style={styles.tasteKicker}>TASTE GRID</AppText>
              <AppText variant="caption" muted>{watchlistQuery.isLoading ? 'Reading your watchlist…' : `${tasteFilled} of 9 slots filled${tasteFilled ? ' · tap to create' : ' · start from your watchlist'}`}</AppText>
            </View>
            <View style={styles.tasteArrow}><Ionicons name="arrow-forward" size={16} color={colors.white} /></View>
          </View>
        </Pressable>
        <View style={styles.tasteCta}><AppButton label={tasteFilled ? 'Create my taste grid' : 'Build my taste grid'} onPress={openTasteGrid} /></View>
        <AppText variant="caption" muted style={styles.exportNote}>Instagram-ready · {EXPORT_WIDTH}×{EXPORT_HEIGHT} PNG · rendered on this device</AppText>
      </FadeInView>

      <FadeInView delay={140}>
        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.sectionHeadingCopy}>
              <AppText style={styles.sectionKicker}>START FROM YOUR LIBRARY</AppText>
              <AppText variant="heading3">Your data, already in place</AppText>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seedRow}>
            {CREATOR_SEEDS.map((seed) => (
              <Pressable
                key={seed.id}
                accessibilityRole="button"
                accessibilityLabel={`${seed.label}. ${seed.detail}`}
                onPress={() => { triggerLightHaptic(); router.push({ pathname: '/creator/editor', params: { seed: seed.id } }); }}
                style={({ pressed }) => [styles.seedCard, pressed && styles.rowPressed]}
              >
                <View style={styles.seedTop}>
                  <View style={styles.rowIcon}><Ionicons name={seed.icon as keyof typeof Ionicons.glyphMap} size={19} color={colors.accent} /></View>
                  <Ionicons name="arrow-up-outline" size={14} color={colors.textMuted} style={styles.seedArrow} />
                </View>
                <AppText variant="bodyMedium" numberOfLines={1}>{seed.label}</AppText>
                <AppText variant="caption" muted numberOfLines={2}>{seed.detail}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </FadeInView>

      <FadeInView delay={200}>
        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.sectionHeadingCopy}>
              <AppText style={styles.sectionKicker}>TEMPLATES</AppText>
              <AppText variant="heading3">Pick a format</AppText>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {TEMPLATE_FILTERS.map((filter) => {
              const selected = templateFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${filter.label} templates`}
                  accessibilityState={{ selected }}
                  onPress={() => { if (!selected) triggerLightHaptic(); setTemplateFilter(filter.id); }}
                  style={[styles.filterChip, selected && styles.filterChipActive]}
                >
                  <AppText variant="label" style={[styles.filterText, selected && styles.filterTextActive]}>{filter.label}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateRow}>
            {filteredTemplates.map((template) => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                accessibilityLabel={`${template.name}. ${template.tagline}`}
                onPress={() => openTemplate(template.id, template.defaultFormat)}
                style={({ pressed }) => [styles.templateCard, pressed && styles.rowPressed]}
              >
                <View style={styles.templateTop}>
                  <View style={styles.templateIcon}><Ionicons name={template.icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.accent} /></View>
                  <View style={styles.templateBadge}><AppText variant="caption" color={colors.textSecondary} style={styles.templateBadgeText}>{template.id === 'taste-grid' ? 'GRID' : template.defaultFormat === 'post' ? 'POST' : 'CAROUSEL'}</AppText></View>
                </View>
                <AppText variant="bodyMedium" numberOfLines={1}>{template.name}</AppText>
                <AppText variant="caption" muted numberOfLines={2}>{template.tagline}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </FadeInView>

      <FadeInView delay={260}>
        <View style={styles.section}>
          <AppText variant="caption" muted style={styles.sectionTitle}>YOUR DRAFTS{drafts.length ? ` (${drafts.length})` : ''}</AppText>
          {draftsQuery.isLoading ? (
            <LoadingView label="Loading your drafts" />
          ) : draftsQuery.isError ? (
            <View style={styles.card}>
              <View style={styles.emptyDrafts}>
                <Ionicons name="save-outline" size={22} color={colors.textMuted} />
                <AppText variant="bodySmall" muted style={styles.emptyDraftsText}>Couldn’t open your drafts on this device right now.</AppText>
                <AppButton label="Try again" variant="secondary" onPress={() => void draftsQuery.refetch()} />
              </View>
            </View>
          ) : drafts.length ? (
            <View style={styles.card}>
              {drafts.map((project, index) => (
                <View key={project.id} style={[styles.row, index < drafts.length - 1 && styles.rowDivider]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open draft ${project.name}`}
                    onPress={() => { triggerLightHaptic(); router.push({ pathname: '/creator/editor', params: { projectId: project.id } }); }}
                    style={({ pressed }) => [styles.draftMain, pressed && styles.rowPressed]}
                  >
                    <View style={styles.rowCopy}>
                      <AppText variant="bodyMedium" numberOfLines={1}>{project.name}</AppText>
                      <AppText variant="caption" muted>{templateName(project.templateId)} · {project.format === 'post' ? 'Post' : 'Carousel'} · {timeAgo(project.updatedAt)}</AppText>
                    </View>
                  </Pressable>
                  <IconButton name="trash-outline" label={`Delete draft ${project.name}`} size={18} variant="subtle" onPress={() => void confirmDelete(project)} />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.emptyDrafts}>
                <Ionicons name="color-wand-outline" size={22} color={colors.textMuted} />
                <AppText variant="bodySmall" muted style={styles.emptyDraftsText}>No drafts yet. Start from your library or a template above, then tap “Save draft”.</AppText>
              </View>
            </View>
          )}
        </View>
      </FadeInView>

      <FadeInView delay={320}>
        <AppText variant="caption" muted style={styles.footer}>Rendered on this device · drafts stay on this device · nothing is uploaded</AppText>
      </FadeInView>
    </Screen>
  );
}

function templateName(templateId: CreatorProjectSummary['templateId']): string {
  return CREATOR_TEMPLATES.find((template) => template.id === templateId)?.name ?? 'Custom';
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingBottom: spacing.md },
  topBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  topBadgeText: { color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '800', letterSpacing: 1.4 },
  heroTitle: { color: colors.white, fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.2 },
  heroSubtitle: { marginTop: spacing.sm, maxWidth: 360, lineHeight: 21 },
  tasteCard: { alignSelf: 'center', marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tasteCanvas: { borderRadius: 18, overflow: 'hidden' },
  tasteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.xs },
  tasteFooterCopy: { flex: 1, gap: 1 },
  tasteKicker: { color: colors.accent, fontSize: 9.5, lineHeight: 12, fontWeight: '800', letterSpacing: 1.5 },
  tasteArrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  tasteCta: { marginTop: spacing.md, alignSelf: 'stretch' },
  exportNote: { textAlign: 'center', marginTop: spacing.sm, letterSpacing: 0.3 },
  section: { marginTop: spacing.xl, marginBottom: spacing.lg },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  sectionHeadingCopy: { flex: 1, gap: 2 },
  sectionKicker: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 1.7 },
  sectionTitle: { letterSpacing: 1, marginBottom: spacing.sm, marginLeft: spacing.xs },
  seedRow: { gap: spacing.sm, paddingRight: spacing.xl },
  seedCard: { width: 172, minHeight: 124, gap: spacing.xs, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg },
  seedTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  seedArrow: { transform: [{ rotate: '45deg' }], marginTop: 4 },
  filterRow: { gap: spacing.sm, paddingRight: spacing.xl, paddingBottom: spacing.md },
  filterChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary },
  filterTextActive: { color: colors.white },
  templateRow: { gap: spacing.sm, paddingRight: spacing.xl },
  templateCard: { width: 164, minHeight: 148, gap: spacing.xs, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg },
  templateTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  templateIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(168,85,247,0.10)', alignItems: 'center', justifyContent: 'center' },
  templateBadge: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  templateBadgeText: { fontSize: 8.5, lineHeight: 11, letterSpacing: 0.8 },
  card: { backgroundColor: colors.surface, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.78 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(168,85,247,0.10)', alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 2 },
  draftMain: { flex: 1, paddingVertical: spacing.sm, marginVertical: -spacing.sm },
  emptyDrafts: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyDraftsText: { textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  footer: { textAlign: 'center', paddingBottom: spacing.xl, letterSpacing: 0.4 },
});
