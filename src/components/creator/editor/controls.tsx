import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { colors, radius, spacing } from '@/theme';
import { CREATOR_ACCENTS, type CreatorPalette } from '@/components/creator/palette';
import type { CreatorAccentId, CreatorTheme } from '@/domain/models/creator';

/** Shared editor controls. Studio chrome intentionally uses the app theme. */

export function EditorField({ label, value, onChangeText, placeholder, multiline = false, maxLength, hint, inputStyle }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  hint?: string;
  inputStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <AppText variant="caption" muted style={styles.fieldLabel}>{label.toUpperCase()}</AppText>
        {maxLength ? <AppText variant="caption" muted>{value.length}/{maxLength}</AppText> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.inputMultiline, inputStyle]}
      />
      {hint ? <AppText variant="caption" muted>{hint}</AppText> : null}
    </View>
  );
}

export function ToggleChip({ label, icon, active, onPress, disabled }: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.toggleChip, active && styles.toggleChipActive, disabled && styles.disabled]}
    >
      {icon ? <Ionicons name={icon} size={13} color={active ? colors.accent : colors.textMuted} /> : null}
      <AppText variant="caption" color={active ? colors.accent : colors.textSecondary}>{label}</AppText>
    </Pressable>
  );
}

export function SegmentedTabs<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <AppText variant="caption" color={active ? colors.textPrimary : colors.textMuted} style={styles.segmentLabel}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ThemeChip({ theme, label, active, palette, onPress }: {
  theme: CreatorTheme;
  label: string;
  active: boolean;
  palette: CreatorPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} template theme`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.themeChip, active && { borderColor: colors.accent }]}
    >
      <View style={[styles.themePreview, { backgroundColor: palette.background }]}>
        <View style={[styles.themeBar, { backgroundColor: palette.accent.primary }]} />
        <View style={[styles.themeLine, { backgroundColor: palette.text }]} />
        <View style={[styles.themeLineShort, { backgroundColor: palette.textSecondary }]} />
      </View>
      <AppText variant="caption" color={active ? colors.textPrimary : colors.textSecondary}>{label}</AppText>
    </Pressable>
  );
}

export function AccentSwatch({ accentId, active, onPress }: { accentId: CreatorAccentId; active: boolean; onPress: () => void }) {
  const accent = CREATOR_ACCENTS.find((candidate) => candidate.id === accentId) ?? CREATOR_ACCENTS[0];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${accent.label} accent color`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.swatch, { backgroundColor: accent.primary, borderColor: active ? colors.white : 'transparent' }]}
    >
      {active ? <Ionicons name="checkmark" size={14} color={accent.ink} /> : null}
    </Pressable>
  );
}

export function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="caption" muted style={styles.sectionTitle}>{title.toUpperCase()}</AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fieldLabel: { letterSpacing: 1 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.small, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15, lineHeight: 20, minHeight: 44 },
  inputMultiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: spacing.sm },
  toggleChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 7 },
  toggleChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(168,85,247,0.12)' },
  disabled: { opacity: 0.4 },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 2 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.surfaceElevated },
  segmentLabel: { letterSpacing: 0.3 },
  themeChip: { flex: 1, gap: spacing.xs, borderRadius: radius.medium, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.sm, alignItems: 'center' },
  themePreview: { width: '100%', height: 44, borderRadius: radius.small, overflow: 'hidden', padding: 7, gap: 4 },
  themeBar: { width: 26, height: 4, borderRadius: 2 },
  themeLine: { width: '72%', height: 6, borderRadius: 3, opacity: 0.85 },
  themeLineShort: { width: '44%', height: 5, borderRadius: 3, opacity: 0.6 },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  section: { gap: spacing.sm },
  sectionTitle: { letterSpacing: 1 },
});
