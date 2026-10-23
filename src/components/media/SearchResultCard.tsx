import { useEffect, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import type { CatalogMedia } from '@/domain/models/media';
import type { LibraryStatus } from '@/domain/models/watchState';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { isUpcoming } from '@/features/catalog/upcoming';
import { triggerLightHaptic, triggerMediumHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { finishTitle } from '@/features/watchState/status';
import { useMovieWatchedMutation, useSeriesTrackingMutation, useWatchlistMutation } from '@/features/watchState/hooks';
import { colors, radius, spacing } from '@/theme';

export function SearchResultCard({ media, onPress, status }: { media: CatalogMedia; onPress: () => void; status?: LibraryStatus }) {
  const [failedUri, setFailedUri] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const queryClient = useQueryClient();
  const watchlist = useWatchlistMutation(media, status?.watchlisted ?? false);
  const movie = useMovieWatchedMutation(media, status?.movieWatched ?? false);
  const tracking = useSeriesTrackingMutation(media, status?.tracking ?? false);
  const action = media.mediaType === 'movie' ? movie : tracking;
  useEffect(() => {
    const error = watchlist.error ?? action.error;
    if (error) void showDialog({ type: 'error', title: 'Couldn’t update your library', message: friendlyErrorMessage(error) });
  }, [watchlist.error, action.error]);
  const warnDuplicate = () => {
    void showDialog({
      type: 'info', title: 'Already in your watchlist', message: `"${media.title}" is already saved. You can open it or remove it.`,
      primaryAction: { label: 'View details' }, secondaryAction: { label: 'Remove' }, dismissible: false,
    }).then((viewDetails) => {
      if (viewDetails) onPress();
      else watchlist.mutate();
    });
  };
  const markFinished = () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    triggerMediumHaptic();
    setFinishing(true);
    finishTitle(media).then(() => {
      triggerSuccessHaptic();
      void queryClient.invalidateQueries({ queryKey: ['watch'] });
      scheduleAutoSync('mutation');
      showToast(media.mediaType === 'movie' ? 'Marked as watched' : 'Marked aired episodes as watched', 'success');
    }).catch((error: unknown) => {
      void showDialog({ type: 'error', title: 'Couldn’t mark as finished', message: friendlyErrorMessage(error) });
    }).finally(() => { finishingRef.current = false; setFinishing(false); });
  };
  const posterFailed = failedUri === media.posterUrl;
  const typeLabel = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : 'Anime';
  // Unreleased titles can be watchlisted, never marked watched before release.
  const unreleased = isUpcoming(media);
  const watchedLabel = media.mediaType === 'movie'
    ? `${status?.movieWatched ? 'Mark' : 'Mark'} ${media.title} ${status?.movieWatched ? 'unwatched' : 'watched'}`
    : `${status?.tracking ? 'Stop tracking' : 'Start tracking'} ${media.title}`;
  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${media.title}${media.year ? `, ${media.year}` : ''}, ${typeLabel}${media.rating === undefined ? '' : `, rating ${media.rating.toFixed(1)}`}`} accessibilityHint="Opens title details" onPress={onPress} style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
      <View style={styles.poster} accessible={false}>
        {media.posterUrl && !posterFailed ? <RemoteImage uri={media.posterUrl} style={StyleSheet.absoluteFill} onError={() => setFailedUri(media.posterUrl)} /> : <LinearGradient colors={['#51416C', '#202637']} style={[StyleSheet.absoluteFill, styles.posterFallback]}><AppText variant="caption" style={styles.posterTitle} numberOfLines={3}>{media.title.toUpperCase()}</AppText></LinearGradient>}
      </View>
      <View style={styles.copy}><AppText variant="bodyMedium" numberOfLines={1}>{media.title}</AppText><AppText variant="caption" muted>{[media.year, typeLabel].filter(Boolean).join(' · ')}</AppText>{media.rating !== undefined ? <View style={styles.rating}><Ionicons name="star" size={13} color={colors.accent} /><AppText variant="caption" muted>{media.rating.toFixed(1)}</AppText></View> : null}</View>
    </Pressable>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${status?.watchlisted ? 'Remove' : 'Add'} ${media.title} ${status?.watchlisted ? 'from' : 'to'} watchlist`} accessibilityState={{ selected: status?.watchlisted ?? false, disabled: !status || watchlist.isPending }} disabled={!status || watchlist.isPending} onPress={() => { triggerLightHaptic(); if (status?.watchlisted) warnDuplicate(); else watchlist.mutate(undefined, { onSuccess: () => { if (status?.complete) showToast(`Moved to Watchlist · ${media.title}`, 'success'); } }); }} style={[styles.add, status?.watchlisted && styles.added]}><Ionicons name={status?.watchlisted ? 'checkmark' : 'add'} size={21} color={status?.watchlisted ? colors.success : colors.accent} /></Pressable>
      {/* Unreleased titles can be watchlisted, never marked watched: the
          watched/track controls are not shown at all, only a release hint. */}
      {unreleased ? (
        <View style={[styles.add, styles.upcoming]} accessibilityRole="text" accessibilityLabel={`${media.title} has not released yet`}>
          <Ionicons name="calendar-outline" size={19} color={colors.textMuted} />
        </View>
      ) : (<>
      {media.mediaType === 'movie' || !status?.complete ? <Pressable accessibilityRole="button" accessibilityLabel={watchedLabel} accessibilityState={{ selected: media.mediaType === 'movie' ? status?.movieWatched : status?.tracking, disabled: !status || action.isPending }} disabled={!status || action.isPending} onPress={() => {
        triggerLightHaptic();
        // The small play control is easy to hit by accident, and stopping
        // tracking deletes the show's episode history. Confirm that one.
        if (media.mediaType !== 'movie' && status?.tracking) {
          void showDialog({
            type: 'warning', title: 'Stop tracking this show?',
            message: 'Its episode progress will be cleared. You can add it again later.',
            primaryAction: { label: 'Stop tracking', destructive: true },
            secondaryAction: { label: 'Keep watching' },
          }).then((confirmed) => { if (confirmed) action.mutate(); });
          return;
        }
        action.mutate();
      }} style={[styles.add, (media.mediaType === 'movie' ? status?.movieWatched : status?.tracking) && styles.added]}><Ionicons name={media.mediaType === 'movie' ? (status?.movieWatched ? 'checkmark-circle' : 'checkmark-circle-outline') : (status?.tracking ? 'play' : 'play-outline')} size={19} color={(media.mediaType === 'movie' ? status?.movieWatched : status?.tracking) ? colors.success : colors.accent} /></Pressable> : null}
      {media.mediaType !== 'movie' ? <Pressable accessibilityRole="button" accessibilityLabel={`Mark ${media.title} finished`} accessibilityState={{ disabled: !status || finishing }} disabled={!status || finishing} onPress={markFinished} style={styles.add}><Ionicons name="checkmark-done" size={19} color={colors.accent} /></Pressable> : null}
      </>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({ row: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, poster: { width: 62, height: 84, borderRadius: radius.small, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.surfaceElevated }, posterFallback: { justifyContent: 'flex-end', padding: spacing.xs }, posterTitle: { color: colors.white, fontSize: 9, lineHeight: 11, textShadowColor: '#000', textShadowRadius: 5 }, copy: { flex: 1, gap: spacing.xs }, rating: { flexDirection: 'row', alignItems: 'center', gap: 4 }, actions: { gap: spacing.xs }, add: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(182,156,255,0.12)', alignItems: 'center', justifyContent: 'center' }, added: { backgroundColor: 'rgba(117,214,162,0.12)' }, disabled: { opacity: 0.35 }, upcoming: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: colors.border }, pressed: { opacity: 0.78 } });
