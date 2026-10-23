import { useDeferredValue, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Keyboard, TextInput, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState } from '@/components/feedback/FeedbackViews';
import { FranchiseCard } from '@/components/franchise/FranchiseCard';
import { filterFranchises } from '@/features/franchises/catalog';
import { triggerLightHaptic } from '@/lib/haptics';
import { colors, spacing, typography } from '@/theme';

/**
 * Franchise collections: a curated catalog of ordered movie/show universes
 * (MCU, Jurassic, Arrowverse…), searchable offline from local data.
 */
export default function FranchisesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  // Filtering every member title on each keystroke should never block typing.
  const deferredQuery = useDeferredValue(query);
  const entries = useMemo(() => filterFranchises(undefined, deferredQuery), [deferredQuery]);
  const cardWidth = Math.max(140, Math.floor((Math.min(width, 760) - spacing.xl * 2 - spacing.md) / 2));
  const openFranchise = (slug: string) => {
    Keyboard.dismiss();
    triggerLightHaptic();
    router.push({ pathname: '/franchise/[slug]', params: { slug } } as never);
  };

  return (
    <Screen>
      <FadeInView>
        <View style={styles.header}>
          <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
          <View style={styles.titleCopy}>
            <AppText variant="heading1">Franchises</AppText>
          </View>
        </View>
        <AppText variant="bodySmall" muted style={styles.lede}>Curated collections — every film and series of a universe, in order.</AppText>
      </FadeInView>

      <View style={styles.inputWrap}>
        <IconButton name="search" label="Search franchise collections" size={18} variant="subtle" onPress={Keyboard.dismiss} />
        <TextInput
          accessibilityLabel="Search franchise collections"
          placeholder="Search franchise collections"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
          style={styles.input}
          selectionColor={colors.accent}
        />
        {query.length > 0 ? <IconButton name="close" label="Clear search" size={18} variant="subtle" onPress={() => setQuery('')} /> : null}
      </View>

      <FlatList
        data={entries}
        numColumns={2}
        keyExtractor={(entry) => entry.slug}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={30}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No franchise matched"
            message={`Nothing in the collections matches “${query}”. Try another name.`}
            actionLabel="Clear search"
            onAction={() => setQuery('')}
          />
        }
        renderItem={({ item }) => (
          <FranchiseCard
            title={item.title}
            itemCount={item.items.length}
            backdropUri={item.backdropPath ? `https://image.tmdb.org/t/p/w780${item.backdropPath}` : undefined}
            width={cardWidth}
            onPress={() => openFranchise(item.slug)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingTop: spacing.lg },
  titleCopy: { flex: 1, paddingTop: spacing.sm },
  lede: { marginTop: spacing.sm, marginBottom: spacing.md },
  inputWrap: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg },
  input: { flex: 1, color: colors.textPrimary, ...typography.body, fontSize: 16 },
  list: { paddingBottom: spacing['2xl'], gap: spacing.lg },
  column: { gap: spacing.md },
});
