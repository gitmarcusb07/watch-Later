import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '@/components/buttons/AppButton';
import { AppText } from '@/components/common/AppText';
import { showToast } from '@/components/feedback/AppDialog';
import { CREATOR_ACCENTS, creatorPalette } from '@/components/creator/palette';
import { composeCaption, suggestCaptions, suggestHashtags } from '@/features/creator/captions';
import { creatorTemplate, templateHighlightsDates, templateRanksTitles } from '@/features/creator/templates';
import { rowMeta } from '@/features/creator/slideText';
import type { CreatorEditorActions } from '@/features/creator/useCreatorEditor';
import {
  CREATOR_MAX_CLOSING,
  CREATOR_MAX_DESCRIPTION,
  CREATOR_MAX_HEADLINE,
  CREATOR_MAX_SUBTITLE,
  creatorProjectTitles,
  type CreatorFormat,
  type CreatorProjectData,
  type CreatorSlide,
  type CreatorTemplateId,
} from '@/domain/models/creator';
import { AccentSwatch, EditorField, InspectorSection, ThemeChip, ToggleChip } from './controls';
import { colors, radius, spacing } from '@/theme';

/**
 * Inspector panels for the selected slide (Content, Titles) and the project
 * (Style, Caption). All controls dispatch through the typed reducer actions,
 * so every edit is exactly one validated state transition.
 */

const HEADLINE_LIMIT = CREATOR_MAX_HEADLINE;
const SUBTITLE_LIMIT = CREATOR_MAX_SUBTITLE;
const DESCRIPTION_LIMIT = CREATOR_MAX_DESCRIPTION;
const CLOSING_LIMIT = CREATOR_MAX_CLOSING;

export function ContentInspector({ slide, templateId, actions }: {
  slide: CreatorSlide;
  templateId: CreatorTemplateId;
  actions: CreatorEditorActions;
}) {
  // Only the spotlight renderers draw `description`; hide the field elsewhere
  // rather than offering an edit that would never appear on the slide.
  const showsDescription = templateId === 'movie-spotlight' || templateId === 'series-spotlight';
  return (
    <>
      <InspectorSection title="Text on this slide">
        <EditorField label="Kicker" value={slide.headline} onChangeText={(value) => actions.setSlideText(slide.id, 'headline', value)} maxLength={HEADLINE_LIMIT} placeholder="NOW SHOWING" />
        <EditorField label="Subtitle" value={slide.subtitle} onChangeText={(value) => actions.setSlideText(slide.id, 'subtitle', value)} maxLength={SUBTITLE_LIMIT} placeholder="Movie night pick" />
        {showsDescription ? (
          <EditorField label="Description" value={slide.description} onChangeText={(value) => actions.setSlideText(slide.id, 'description', value)} maxLength={DESCRIPTION_LIMIT} multiline placeholder="Why you’re recommending it" />
        ) : null}
        <EditorField label="Closing note" value={slide.closing} onChangeText={(value) => actions.setSlideText(slide.id, 'closing', value)} maxLength={CLOSING_LIMIT} placeholder="Save this list" />
      </InspectorSection>
      <InspectorSection title="Metadata shown">
        <View style={styles.chipRow}>
          <ToggleChip label="Rating" icon="star-outline" active={slide.showRating} onPress={() => actions.toggleSlideFlag(slide.id, 'showRating')} />
          <ToggleChip label="Release date" icon="calendar-outline" active={slide.showReleaseDate} onPress={() => actions.toggleSlideFlag(slide.id, 'showReleaseDate')} />
          <ToggleChip label="Genres" icon="pricetags-outline" active={slide.showGenres} onPress={() => actions.toggleSlideFlag(slide.id, 'showGenres')} />
          <ToggleChip label="Streaming" icon="play-circle-outline" active={slide.showProviders} onPress={() => actions.toggleSlideFlag(slide.id, 'showProviders')} />
        </View>
        <AppText variant="caption" muted>Missing metadata stays hidden — nothing is filled in for you. Streaming info only appears for titles saved with it.</AppText>
      </InspectorSection>
    </>
  );
}

export function TitlesInspector({ slide, templateId, actions, onAddTitles }: {
  slide: CreatorSlide;
  templateId: CreatorTemplateId;
  actions: CreatorEditorActions;
  onAddTitles: () => void;
}) {
  const template = creatorTemplate(templateId);
  const ranks = templateRanksTitles(templateId);
  const dated = templateHighlightsDates(templateId);
  const remaining = template.maxTitles - slide.titleRefs.length;
  return (
    <InspectorSection title={`Titles (${slide.titleRefs.length}/${template.maxTitles})`}>
      {slide.titleRefs.length ? (
        <View style={styles.titleList}>
          {slide.titleRefs.map((ref, index) => {
            const meta = dated
              ? [ref.releaseDate ?? 'Release date TBA', ranks ? undefined : rowMeta(ref, slide, { dateInsteadOfYear: true })].filter(Boolean).join(' · ')
              : rowMeta(ref, slide);
            return (
              <View key={`${ref.provider}:${ref.mediaType}:${ref.providerId}`} style={styles.titleRow}>
                <View style={[styles.titleIndex, ranks && styles.titleRank]}>
                  <AppText variant="caption" color={ranks ? colors.accent : colors.textSecondary} style={styles.titleIndexText}>{index + 1}</AppText>
                </View>
                <View style={styles.titleCopy}>
                  <AppText variant="bodySmall" numberOfLines={1}>{ref.title}</AppText>
                  <AppText variant="caption" muted numberOfLines={1}>{meta || 'No extra metadata'}</AppText>
                </View>
                <RowAction icon="chevron-up" label={`Move ${ref.title} up`} disabled={index === 0} onPress={() => actions.moveTitle(slide.id, index, -1)} />
                <RowAction icon="chevron-down" label={`Move ${ref.title} down`} disabled={index === slide.titleRefs.length - 1} onPress={() => actions.moveTitle(slide.id, index, 1)} />
                <RowAction icon="close" label={`Remove ${ref.title}`} danger onPress={() => actions.removeTitle(slide.id, index)} />
              </View>
            );
          })}
        </View>
      ) : (
        <AppText variant="bodySmall" muted style={styles.emptyTitles}>
          {template.minTitles > 0
            ? `This template needs at least ${template.minTitles} title${template.minTitles === 1 ? '' : 's'}. Add them below.`
            : 'No titles yet — the slide renders an honest placeholder until you add one.'}
        </AppText>
      )}
      <AppButton
        label={remaining > 0 ? 'Add titles' : `Slide full (${template.maxTitles})`}
        variant="secondary"
        disabled={remaining <= 0}
        onPress={onAddTitles}
        icon={<Ionicons name="search-outline" size={17} color={colors.textPrimary} />}
      />
      {remaining > 0 ? <AppText variant="caption" muted>{remaining} slot{remaining === 1 ? '' : 's'} left on this slide.</AppText> : null}
    </InspectorSection>
  );
}

export function StyleInspector({ data, actions }: {
  data: CreatorProjectData;
  actions: CreatorEditorActions;
}) {
  return (
    <>
      <InspectorSection title="Theme">
        <View style={styles.themeRow}>
          <ThemeChip theme="dark" label="Dark" active={data.theme === 'dark'} palette={creatorPalette('dark', data.accentId)} onPress={() => actions.setTheme('dark')} />
          <ThemeChip theme="light" label="Light" active={data.theme === 'light'} palette={creatorPalette('light', data.accentId)} onPress={() => actions.setTheme('light')} />
        </View>
      </InspectorSection>
      <InspectorSection title="Accent">
        <View style={styles.swatchRow}>
          {CREATOR_ACCENTS.map((accent) => (
            <AccentSwatch key={accent.id} accentId={accent.id} active={data.accentId === accent.id} onPress={() => actions.setAccent(accent.id)} />
          ))}
        </View>
      </InspectorSection>
      <InspectorSection title="Branding">
        <View style={styles.chipRow}>
          <ToggleChip label="Show Watch Later mark" icon="sparkles-outline" active={data.showBranding} onPress={() => actions.setBranding(!data.showBranding)} />
        </View>
        <AppText variant="caption" muted>A small wordmark in the slide corner. Turning it off keeps the export clean.</AppText>
      </InspectorSection>
    </>
  );
}

export function CaptionInspector({ data, templateId, format, caption, onChange }: {
  data: CreatorProjectData;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  caption: string;
  onChange: (caption: string) => void;
}) {
  const refs = creatorProjectTitles(data);
  const suggestions = suggestCaptions({ templateId, format, titleRefs: refs });
  const hashtags = suggestHashtags(refs);
  const tagsBlock = hashtags.join(' ');
  // Tapping "add" twice must not stack a second identical hashtag block.
  const alreadyTagged = Boolean(tagsBlock) && caption.trimEnd().endsWith(tagsBlock);

  async function copyCaption() {
    const text = composeCaption(caption, hashtags);
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      showToast('Caption copied — paste it into Instagram', 'success');
    } catch {
      showToast('Couldn’t copy the caption on this device', 'error');
    }
  }

  return (
    <>
      <InspectorSection title="Caption">
        <EditorField
          label="Post caption"
          value={caption}
          onChangeText={onChange}
          multiline
          maxLength={2000}
          placeholder="Write a caption, or start from a suggestion below"
          inputStyle={styles.captionInput}
        />
        <View style={styles.captionActions}>
          <View style={styles.captionButton}><AppButton label="Copy caption" variant="secondary" onPress={() => void copyCaption()} disabled={!caption.trim() && !hashtags.length} icon={<Ionicons name="copy-outline" size={17} color={colors.textPrimary} />} /></View>
        </View>
      </InspectorSection>
      {suggestions.length ? (
        <InspectorSection title="Suggestions">
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.label}
              accessibilityRole="button"
              accessibilityLabel={`Use suggestion ${suggestion.label}`}
              onPress={() => onChange(suggestion.text)}
              style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
            >
              <AppText variant="label" color={colors.accent}>{suggestion.label}</AppText>
              <AppText variant="caption" muted numberOfLines={3}>{suggestion.text}</AppText>
            </Pressable>
          ))}
        </InspectorSection>
      ) : null}
      <InspectorSection title="Hashtags">
        <View style={styles.hashtagBox}>
          <AppText variant="caption" color={colors.textSecondary}>{hashtags.join(' ')}</AppText>
        </View>
        <View style={styles.captionActions}>
          <View style={styles.captionButton}><AppButton label={alreadyTagged ? 'Hashtags added' : 'Add hashtags to caption'} variant="ghost" onPress={() => onChange(composeCaption(caption, hashtags))} disabled={!hashtags.length || alreadyTagged} /></View>
        </View>
        <AppText variant="caption" muted>Drawn from this project’s own titles and genres — fully offline, never invented.</AppText>
      </InspectorSection>
    </>
  );
}

function RowAction({ icon, label, disabled = false, danger = false, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.rowAction, pressed && styles.rowActionPressed, disabled && styles.rowActionDisabled]}
    >
      <Ionicons name={icon} size={16} color={danger ? colors.error : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  titleList: { gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  titleIndex: { width: 22, alignItems: 'center' },
  titleRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(168,85,247,0.12)', justifyContent: 'center' },
  titleIndexText: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
  titleCopy: { flex: 1, gap: 1 },
  rowAction: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rowActionPressed: { backgroundColor: colors.surfaceElevated },
  rowActionDisabled: { opacity: 0.3 },
  emptyTitles: { lineHeight: 20 },
  themeRow: { flexDirection: 'row', gap: spacing.md },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  captionInput: { minHeight: 132 },
  captionActions: { flexDirection: 'row', gap: spacing.md },
  captionButton: { flex: 1 },
  suggestion: { gap: spacing.xs, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.md },
  suggestionPressed: { backgroundColor: colors.surfaceElevated },
  hashtagBox: { borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.md },
});
