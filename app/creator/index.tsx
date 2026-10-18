import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { IconButton } from '@/components/buttons/IconButton';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { LoadingView } from '@/components/feedback/FeedbackViews';
import { CREATOR_TEMPLATES } from '@/features/creator/templates';
import { CREATOR_SEEDS } from '@/features/creator/useCreatorSeed';
import { useCreatorDrafts, useDeleteCreatorDraft } from '@/features/creator/hooks';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '@/features/creator/exportPlan';
import type { CreatorProjectSummary } from '@/domain/models/creator';
import { timeAgo } from '@/lib/relativeTime';
import { showFriendlyError } from '@/lib/friendlyError';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

/**
 * Creator Studio home: every way into the editor (seeds from the user's own
 * data, the templates, saved drafts). Drafts live on this device — there is
 * no account anywhere in the studio, and nothing is ever uploaded.
 */
export default function CreatorStudioScreen() {
  const router = useRouter();
  const draftsQuery = useCreatorDrafts();
  const deleteDraft = useDeleteCreatorDraft();

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

  const drafts = draftsQuery.data ?? [];

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={draftsQuery.isRefetching && !draftsQuery.isLoading} onRefresh={() => void draftsQuery.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}>
      <FadeInView>
        <View style={styles.top}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
          <View style={styles.titleWrap}>
            <AppText variant="caption" style={styles.eyebrow}>CREATE</AppText>
            <AppText variant="heading1">Creator Studio</AppText>
            <AppText variant="bodySmall" muted>Instagram-ready posts from your library · {EXPORT_WIDTH}×{EXPORT_HEIGHT} PNG</AppText>
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={120}>
        <View style={styles.section}>
          <AppText variant="caption" muted style={styles.sectionTitle}>START FROM YOUR LIBRARY</AppText>
          <View style={styles.card}>
            {CREATOR_SEEDS.map((seed, index) => (
              <Pressable
                key={seed.id}
                accessibilityRole="button"
                accessibilityLabel={`${seed.label}. ${seed.detail}`}
                onPress={() => { triggerLightHaptic(); router.push({ pathname: '/creator/editor', params: { seed: seed.id } }); }}
                style={({ pressed }) => [styles.row, index < CREATOR_SEEDS.length - 1 && styles.rowDivider, pressed && styles.rowPressed]}
              >
                <View style={styles.rowIcon}><Ionicons name={seed.icon as keyof typeof Ionicons.glyphMap} size={19} color={colors.accent} /></View>
                <View style={styles.rowCopy}>
                  <AppText variant="bodyMedium">{seed.label}</AppText>
                  <AppText variant="caption" muted>{seed.detail}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={180}>
        <View style={styles.section}>
          <AppText variant="caption" muted style={styles.sectionTitle}>TEMPLATES</AppText>
          <View style={styles.grid}>
            {CREATOR_TEMPLATES.map((template) => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                accessibilityLabel={`${template.name}. ${template.tagline}`}
                onPress={() => { triggerLightHaptic(); router.push({ pathname: '/creator/editor', params: { templateId: template.id, format: template.defaultFormat } }); }}
                style={({ pressed }) => [styles.template, pressed && styles.rowPressed]}
              >
                <View style={styles.templateIcon}><Ionicons name={template.icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.accent} /></View>
                <AppText variant="bodyMedium" numberOfLines={1}>{template.name}</AppText>
                <AppText variant="caption" muted numberOfLines={2}>{template.tagline}</AppText>
                <View style={styles.templateBadge}><AppText variant="caption" color={colors.textSecondary} style={styles.templateBadgeText}>{template.defaultFormat === 'post' ? 'POST' : 'CAROUSEL'}</AppText></View>
              </Pressable>
            ))}
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={240}>
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

      <FadeInView delay={300}>
        <AppText variant="caption" muted style={styles.footer}>Rendered on this device · drafts stay on this device · nothing is uploaded</AppText>
      </FadeInView>
    </Screen>
  );
}

function templateName(templateId: CreatorProjectSummary['templateId']): string {
  return CREATOR_TEMPLATES.find((template) => template.id === templateId)?.name ?? 'Custom';
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  titleWrap: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.accent, letterSpacing: 2 },
  section: { marginBottom: spacing.xl },
  sectionTitle: { letterSpacing: 1, marginBottom: spacing.sm, marginLeft: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.78 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(168,85,247,0.10)', alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 2 },
  draftMain: { flex: 1, paddingVertical: spacing.sm, marginVertical: -spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  template: { width: '48%', flexGrow: 1, minWidth: 150, gap: spacing.xs, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, minHeight: 132 },
  templateIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(168,85,247,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  templateBadge: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.xs },
  templateBadgeText: { fontSize: 9.5, lineHeight: 12, letterSpacing: 1 },
  emptyDrafts: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyDraftsText: { textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  footer: { textAlign: 'center', paddingBottom: spacing.xl, letterSpacing: 0.4 },
});
