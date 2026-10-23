import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { Screen } from '@/components/common/Screen';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/buttons/IconButton';
import { LibrarySearchInput, SortControl } from '@/components/library/controls';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { EmptyState, ErrorView, LoadingView } from '@/components/feedback/FeedbackViews';
import { TrackedMediaRow } from '@/components/media/TrackedMediaRow';
import { useFavoriteMutation, useFavorites, watchKeys } from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { useQueryClient } from '@tanstack/react-query';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { matchesLocalQuery } from '@/lib/localSearch';
import { sortLibraryEntries, type LibrarySortKey } from '@/lib/librarySort';
import type { CatalogMedia } from '@/domain/models/media';
import { colors, spacing } from '@/theme';

function FavoriteRow({ media, onOpen }: { media: CatalogMedia; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useFavoriteMutation(media, true);
  useEffect(() => {
    if (mutation.error) void showDialog({ type: 'error', title: 'Couldn’t update your favorites', message: friendlyErrorMessage(mutation.error) });
  }, [mutation.error]);
  const undoRemove = () => {
    void watchStateRepository.setFavorite(media, true).then(() => {
      void queryClient.invalidateQueries({ queryKey: watchKeys.all });
      scheduleAutoSync('mutation');
    }).catch((undoError: unknown) => {
      void showDialog({ type: 'error', title: 'Couldn’t restore', message: friendlyErrorMessage(undoError) });
    });
  };
  return <TrackedMediaRow media={media} onPress={onOpen} actionLabel={`Remove ${media.title} from favorites`} actionIcon="heart" actionTone="favorite" actionMotion="heartbeat" actionDisabled={mutation.isPending} onAction={() => mutation.mutate(undefined, {
    onSuccess: () => showToast('Removed from favorites', 'info', { actionLabel: 'Undo', durationMs: 5000, onAction: undoRemove }),
    onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t update your favorites', message: friendlyErrorMessage(error) }),
  })} />;
}

export default function FavoritesScreen() {
  const router = useRouter();
  const [sort, setSort] = useState<LibrarySortKey>('recent');
  const [search, setSearch] = useState('');
  const favoritesQuery = useFavorites();
  const entries = useMemo(() => {
    const filtered = (favoritesQuery.data ?? []).filter(({ media }) => matchesLocalQuery(media.title, search));
    if (sort === 'recent') return filtered;
    const withMeta = filtered.map(({ media }) => ({ media, title: media.title, year: media.year, runtimeMinutes: media.runtimeMinutes, addedAt: '' }));
    return sortLibraryEntries(withMeta, sort).map((item) => ({ media: item.media, favoritedAt: '' }));
  }, [favoritesQuery.data, search, sort]);

  return <Screen>
    <FadeInView><View style={styles.header}><IconButton name="arrow-back" label="Go back" onPress={() => router.back()} /><View style={styles.title}><AppText variant="heading1">Favorites</AppText><AppText variant="bodySmall" muted>{entries.length} {entries.length === 1 ? 'title' : 'titles'} · syncs when you sign in</AppText></View></View></FadeInView>
    <LibrarySearchInput value={search} onChange={setSearch} label="Search your favorites" />
    <SortControl value={sort} onChange={setSort} />
    {favoritesQuery.isLoading ? <LoadingView label="Loading your favorites" />
      : favoritesQuery.isError ? <ErrorView message="Couldn't load your favorites. Your data is safe." onRetry={() => void favoritesQuery.refetch()} />
      : entries.length ? <FlatList data={entries} keyExtractor={(item) => item.media.id} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list} style={styles.flat} refreshControl={<RefreshControl refreshing={favoritesQuery.isRefetching && !favoritesQuery.isLoading} onRefresh={() => void favoritesQuery.refetch()} tintColor={colors.accent} colors={[colors.accent]} />} renderItem={({ item }) => (
        <FavoriteRow media={item.media} onOpen={() => router.push({ pathname: '/media/[id]', params: { id: mediaRouteId(item.media) } })} />
      )} /> : <EmptyState icon="heart-outline" title="No favorites yet" message="Mark titles you love and they'll wait for you here on every device." actionLabel="Find something to love" onAction={() => router.push('/search')} />}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  title: { flex: 1, gap: spacing.xs },
  flat: { flex: 1 },
  list: { paddingBottom: spacing['2xl'] },
});
