import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import type { LibrarySortKey } from '@/lib/librarySort';
import { colors, radius, spacing, typography } from '@/theme';

const SORT_OPTIONS: { key: LibrarySortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'A–Z' },
  { key: 'year', label: 'Year' },
  { key: 'runtime', label: 'Longest' },
];

export function SortControl({ value, onChange }: { value: LibrarySortKey; onChange: (key: LibrarySortKey) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Sort order">
      {SORT_OPTIONS.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable key={option.key} accessibilityRole="radio" accessibilityLabel={`Sort by ${option.label}`} accessibilityState={{ selected }} onPress={() => onChange(option.key)} style={[styles.chip, selected && styles.active]}>
            <AppText variant="label" style={{ color: selected ? colors.accent : colors.textSecondary }}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function GenreFilter({ genres, value, onChange }: { genres: string[]; value: string | null; onChange: (genre: string | null) => void }) {
  if (!genres.length) return null;
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Filter by genre">
      {['All', ...genres].map((genre) => {
        const selected = (value ?? 'All') === genre;
        return (
          <Pressable key={genre} accessibilityRole="radio" accessibilityLabel={genre === 'All' ? 'All genres' : `Genre ${genre}`} accessibilityState={{ selected }} onPress={() => onChange(genre === 'All' ? null : genre)} style={[styles.chip, selected && styles.active]}>
            <AppText variant="label" style={{ color: selected ? colors.accent : colors.textSecondary }}>{genre}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LibrarySearchInput({ value, onChange, label, placeholder = 'Search this list' }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  return (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={17} color={colors.textMuted} />
      <TextInput accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={colors.textMuted} value={value} onChangeText={onChange} returnKeyType="search" maxLength={120} style={styles.input} selectionColor={colors.accent} />
      {value.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear list search" onPress={() => onChange('')} hitSlop={10}><Ionicons name="close-circle" size={17} color={colors.textSecondary} /></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  active: { backgroundColor: 'rgba(182,156,255,0.12)', borderColor: colors.accent },
  searchWrap: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.md },
  input: { flex: 1, color: colors.textPrimary, ...typography.body },
});
