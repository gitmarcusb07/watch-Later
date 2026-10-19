import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackHandler, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { IconButton } from '@/components/buttons/IconButton';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { EmptyState, ErrorView, LoadingView } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { SegmentedTabs } from '@/components/creator/editor/controls';
import { PreviewPager } from '@/components/creator/editor/PreviewPager';
import { SlideRail } from '@/components/creator/editor/SlideRail';
import { TitlePickerModal } from '@/components/creator/editor/TitlePickerModal';
import { ExportSheet } from '@/components/creator/editor/ExportSheet';
import { CaptionInspector, ContentInspector, StyleInspector, TitlesInspector } from '@/components/creator/editor/inspectors';
import { useSlideExporter } from '@/components/creator/export/SlideExportStage';
import { creatorTemplate, isCreatorTemplateId, slideLayoutOf } from '@/features/creator/templates';
import { planCarouselCompletion, carouselCompletionHint, carouselCompletionMessage } from '@/features/creator/completeCarousel';
import { createEditorState, defaultProjectName, previewAddTitles, useCreatorEditor, type CreatorEditorState } from '@/features/creator/useCreatorEditor';
import { useCreatorDraft, useSaveCreatorDraft } from '@/features/creator/hooks';
import { CREATOR_SEEDS, creatorSeedTarget, parseCreatorSeed, useCreatorSeed } from '@/features/creator/useCreatorSeed';
import { isCreatorFormat } from '@/features/creator/validation';
import { creatorTitleKey, CREATOR_MAX_NAME, type CreatorFormat, type CreatorTemplateId, type CreatorTitleRef } from '@/domain/models/creator';
import { showFriendlyError } from '@/lib/friendlyError';
import { triggerSuccessHaptic } from '@/lib/haptics';
import { CONTENT_MAX_WIDTH } from '@/theme/responsive';
import { colors, radius, spacing } from '@/theme';

/**
 * Creator Studio editor. Template-based (no free canvas): the route resolves
 * one of three starting points — an existing draft, a seeded draft from the
 * user's own data, or a blank template — then hands a ready initial state to
 * the editor view, which owns all editing through the typed reducer.
 */

type InspectorTab = 'content' | 'titles' | 'style' | 'caption';

const INSPECTOR_TABS: { value: InspectorTab; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'titles', label: 'Titles' },
  { value: 'style', label: 'Style' },
  { value: 'caption', label: 'Caption' },
];

export default function CreatorEditorRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; templateId?: string; format?: string; seed?: string }>();
  const projectId = typeof params.projectId === 'string' && params.projectId ? params.projectId : undefined;
  const seedId = parseCreatorSeed(params.seed);
  const templateId: CreatorTemplateId | undefined = isCreatorTemplateId(params.templateId) ? params.templateId : undefined;
  const format: CreatorFormat | undefined = isCreatorFormat(params.format) ? params.format : undefined;

  const { isLoading: projectLoading, isError: projectFailed, data: project, refetch: refetchProject } = useCreatorDraft(projectId);
  const seed = useCreatorSeed(seedId);

  const resolved = useMemo<{ initial?: CreatorEditorState; blocking?: React.ReactElement; seeded?: { label: string; titleCount: number } }>(() => {
    if (projectId) {
      if (projectLoading) return { blocking: <LoadingView label="Opening your draft" /> };
      if (projectFailed) return { blocking: <ErrorView message="Couldn’t open that draft on this device. Please try again." onRetry={() => void refetchProject()} /> };
      if (!project) return { blocking: <EmptyState icon="save-outline" title="Draft unavailable" message="This draft was deleted from this device or could not be read." actionLabel="Back to studio" onAction={() => router.replace('/creator')} /> };
      return {
        initial: createEditorState({
          projectId: project.id,
          name: project.name,
          templateId: project.templateId,
          format: project.format,
          caption: project.caption,
          data: project.data,
        }),
      };
    }
    if (seedId) {
      if (seed.status === 'loading') return { blocking: <LoadingView label="Building your draft" /> };
      if (seed.status === 'error') {
        const target = creatorSeedTarget(seedId);
        return {
          blocking: (
            <>
              <ErrorView message={seed.errorMessage ?? 'Couldn’t build that draft.'} onRetry={seed.retry} />
              <View style={styles.seedFallback}>
                <AppButton label="Start a blank draft instead" variant="secondary" onPress={() => router.replace({ pathname: '/creator/editor', params: { templateId: target.templateId, format: target.format } })} />
              </View>
            </>
          ),
        };
      }
      if (seed.status === 'ready' && seed.draft) {
        const label = CREATOR_SEEDS.find((candidate) => candidate.id === seedId)?.label ?? 'Your library';
        return {
          initial: createEditorState({
            name: defaultProjectName(seed.draft.templateId),
            templateId: seed.draft.templateId,
            format: seed.draft.format,
            slides: seed.draft.slides,
          }),
          seeded: { label, titleCount: seed.draft.titleCount },
        };
      }
      return {};
    }
    const starterTemplate = templateId ?? 'movie-spotlight';
    return {
      initial: createEditorState({
        name: defaultProjectName(starterTemplate),
        templateId: starterTemplate,
        format: format ?? creatorTemplate(starterTemplate).defaultFormat,
      }),
    };
  }, [projectId, projectLoading, projectFailed, project, refetchProject, seedId, seed.status, seed.errorMessage, seed.retry, seed.draft, templateId, format, router]);

  if (!resolved.initial) {
    return (
      <Screen>
        <View style={styles.statusHeader}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /></View>
        <View style={styles.statusBody}>{resolved.blocking}</View>
      </Screen>
    );
  }

  return (
    <CreatorEditorView
      key={projectId ?? seedId ?? `template:${templateId ?? 'default'}`}
      initial={resolved.initial}
      seeded={resolved.seeded}
    />
  );
}

function CreatorEditorView({ initial, seeded }: {
  initial: CreatorEditorState;
  seeded?: { label: string; titleCount: number };
}) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { state, actions, canAddSlide } = useCreatorEditor(initial);
  const saveMutation = useSaveCreatorDraft();
  const exporter = useSlideExporter(state.templateId, state.data);
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState<InspectorTab>('content');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const slides = state.data.slides;
  const safeIndex = Math.max(0, Math.min(index, slides.length - 1));
  const activeSlide = slides[safeIndex];
  const activeLayoutId = slideLayoutOf(activeSlide, state.templateId);

  // What a single "Finish" tap would add: full-list slides for picks that only
  // live in non-list layouts, and a closing follow card when none exists.
  const completion = useMemo(
    () => planCarouselCompletion({ templateId: state.templateId, format: state.format, slides }),
    [state.templateId, state.format, slides],
  );

  // Fixed slide proportions on every screen: page = full content width, the
  // canvas shrinks on short screens so the rail and inspector stay reachable.
  const contentWidth = Math.min(width, CONTENT_MAX_WIDTH) - 2 * spacing.xl;
  const canvasWidth = Math.max(220, Math.min(contentWidth, 320, (height * 0.42) / 1.25));

  const announceSeed = useRef(false);
  useEffect(() => {
    if (announceSeed.current || !seeded) return;
    announceSeed.current = true;
    if (seeded.titleCount > 0) showToast(`${seeded.label} ready — ${seeded.titleCount} titles seeded`, 'success');
    else showToast('Nothing to seed from yet — starting a blank draft', 'info');
  }, [seeded]);

  const leave = useCallback(async () => {
    if (!state.dirty) {
      router.back();
      return;
    }
    const discard = await showDialog({
      type: 'warning',
      title: 'Discard changes?',
      message: 'This draft has unsaved edits. Leaving keeps the last saved version.',
      primaryAction: { label: 'Discard', destructive: true },
      secondaryAction: { label: 'Keep editing' },
    });
    if (discard) router.back();
  }, [state.dirty, router]);

  // Android back gesture/button follows the same guard as the header back.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void leave();
      return true;
    });
    return () => subscription.remove();
  }, [leave]);

  async function saveDraft() {
    try {
      const project = await saveMutation.mutateAsync({
        id: state.projectId,
        name: state.name,
        templateId: state.templateId,
        format: state.format,
        caption: state.caption,
        data: state.data,
      });
      actions.markSaved(project.id, project.name);
      triggerSuccessHaptic();
      showToast(state.projectId ? 'Draft saved' : 'Draft created — find it in your studio', 'success');
    } catch (error) {
      void showFriendlyError(error, 'Couldn’t save your draft');
    }
  }

  function changeLayout(layout: CreatorTemplateId) {
    if (layout === activeLayoutId) return;
    const nextMax = creatorTemplate(layout).maxTitles;
    const dropped = Math.max(0, activeSlide.titleRefs.length - nextMax);
    actions.setSlideLayout(activeSlide.id, layout);
    if (dropped > 0) showToast(`Layout switched — ${dropped} title${dropped === 1 ? '' : 's'} over the new ${nextMax}-title limit were removed`, 'info');
  }

  function confirmTitles(refs: CreatorTitleRef[]) {
    const preview = previewAddTitles(state, activeSlide.id, refs);
    actions.addTitles(activeSlide.id, refs);
    setPickerOpen(false);
    if (preview.dropped > 0) showToast(`${preview.added} added · ${preview.dropped} didn’t fit this project`, 'info');
    else if (preview.added === 1) showToast('Title added', 'success');
    else if (preview.added > 1) showToast(`${preview.added} titles added`, 'success');
  }

  function finishCarousel() {
    if (!completion.gaps.length) return;
    actions.completeCarousel();
    showToast(carouselCompletionMessage(completion), 'success');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="arrow-back" label="Leave the editor" onPress={() => void leave()} />
        <View style={styles.nameWrap}>
          <TextInput
            accessibilityLabel="Draft name"
            value={state.name}
            onChangeText={actions.rename}
            maxLength={CREATOR_MAX_NAME}
            placeholder={defaultProjectName(state.templateId)}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={styles.nameInput}
          />
          <AppText variant="caption" muted>
            {creatorTemplate(state.templateId).name} · {state.format === 'post' ? 'Single post' : `Carousel (${slides.length} slide${slides.length === 1 ? '' : 's'})`}{state.dirty ? ' · Unsaved changes' : ''}
          </AppText>
        </View>
        <View style={[styles.dirtyDot, state.dirty && styles.dirtyDotOn]} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PreviewPager
          templateId={state.templateId}
          data={state.data}
          index={safeIndex}
          onChangeIndex={setIndex}
          pageWidth={contentWidth}
          canvasWidth={canvasWidth}
        />
        <SlideRail
          templateId={state.templateId}
          data={state.data}
          slides={slides}
          index={safeIndex}
          canAddSlide={canAddSlide}
          onSelect={setIndex}
          onAdd={actions.addSlide}
          onMove={actions.moveSlide}
          onDuplicate={actions.duplicateSlide}
          onRemove={actions.removeSlide}
        />
        {completion.gaps.length ? (
          <View style={styles.finish}>
            <View style={styles.finishIcon}>
              <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
            </View>
            <View style={styles.finishCopy}>
              <AppText variant="label">Finish the carousel</AppText>
              <AppText variant="caption" muted>{carouselCompletionHint(completion)}</AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish the carousel"
              onPress={finishCarousel}
              style={({ pressed }) => [styles.finishAction, pressed && styles.finishActionPressed]}
            >
              <AppText variant="label" color={colors.accent}>Finish</AppText>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.inspector}>
          <SegmentedTabs options={INSPECTOR_TABS} value={tab} onChange={setTab} />
          {tab === 'content' ? <ContentInspector slide={activeSlide} templateId={activeLayoutId} actions={actions} onChangeLayout={changeLayout} /> : null}
          {tab === 'titles' ? <TitlesInspector slide={activeSlide} templateId={activeLayoutId} actions={actions} onAddTitles={() => setPickerOpen(true)} /> : null}
          {tab === 'style' ? <StyleInspector data={state.data} actions={actions} /> : null}
          {tab === 'caption' ? <CaptionInspector data={state.data} templateId={state.templateId} format={state.format} caption={state.caption} onChange={actions.setCaption} /> : null}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={styles.bottomButton}>
          <AppButton
            label="Save draft"
            variant="secondary"
            onPress={() => void saveDraft()}
            loading={saveMutation.isPending}
            icon={<Ionicons name="save-outline" size={17} color={colors.textPrimary} />}
          />
        </View>
        <View style={styles.bottomButton}>
          <AppButton
            label="Export"
            onPress={() => setExportOpen(true)}
            icon={<Ionicons name="download-outline" size={17} color={colors.background} />}
          />
        </View>
      </View>

      {pickerOpen ? (
        <TitlePickerModal
          templateId={activeLayoutId}
          format={state.format}
          existingKeys={activeSlide.titleRefs.map(creatorTitleKey)}
          onClose={() => setPickerOpen(false)}
          onConfirm={confirmTitles}
        />
      ) : null}
      {exportOpen ? (
        <ExportSheet
          visible
          projectName={state.name}
          templateId={state.templateId}
          data={state.data}
          activeSlideId={activeSlide.id}
          capture={exporter.capture}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {/* Capture surface: attached and drawn while exporting, covered by the export sheet. */}
      {exporter.node}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusHeader: { paddingTop: spacing.lg },
  statusBody: { flex: 1, justifyContent: 'center' },
  seedFallback: { paddingHorizontal: spacing.xl, marginTop: -spacing.xl, maxWidth: 420, alignSelf: 'center', width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  nameWrap: { flex: 1, gap: 2 },
  nameInput: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '600', padding: 0 },
  dirtyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginRight: spacing.xs },
  dirtyDotOn: { backgroundColor: colors.warning },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  finish: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: spacing.md },
  finishIcon: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(182,156,255,0.12)' },
  finishCopy: { flex: 1, gap: 2 },
  finishAction: { minHeight: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  finishActionPressed: { opacity: 0.75 },
  inspector: { gap: spacing.lg },
  bottomBar: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bottomButton: { flex: 1 },
});
