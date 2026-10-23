import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { openURL } from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { Animated, FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import { IconButton } from '@/components/buttons/IconButton';
import { AppButton } from '@/components/buttons/AppButton';
import { DetailActions } from '@/components/media/DetailActions';
import { WatchLaterSheet } from '@/components/media/WatchLaterSheet';
import { FadeInView } from '@/components/common/FadeInView';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { usePressMotion } from '@/lib/pressMotion';
import { triggerLightHaptic, triggerMediumHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { shareMedia } from '@/features/share/shareMedia';
import { SeasonsSection } from '@/components/media/SeasonsSection';
import { NotifyMeButton } from '@/components/media/NotifyMeButton';
import { Screen } from '@/components/common/Screen';
import { DetailSkeleton, ErrorView } from '@/components/feedback/FeedbackViews';
import { showDialog, showToast } from '@/components/feedback/AppDialog';
import { CatalogError } from '@/domain/errors/CatalogError';
import { useCatalogMedia, useContentRating, useMediaCredits, useTmdbEnrichment, useTrailerKey, useWatchProviders } from '@/features/catalog/hooks';
import { countryName, languageName } from '@/features/catalog/metaNames';
import { mediaId, parseMediaRouteId } from '@/features/catalog/mediaIdentity';
import { isUpcoming, formatReleaseDate } from '@/features/catalog/upcoming';
import { finishTitle } from '@/features/watchState/status';
import { getDetailPrimaryAction } from '@/features/watchState/detailAction';
import { getWatchLaterActionPresentation } from '@/features/watchState/watchLaterAction';
import { PRIORITY_META } from '@/features/watchState/priority';
import type { SeriesProgress, WatchedEpisodeSnapshot, WatchPriority } from '@/domain/models/watchState';
import { useFavoriteMutation, useFavoriteStatus, useMovieWatchedStatus, useSaveToWatchlist, useSeriesProgress, useTrackedMedia, useWatchlist, useWatchlistStatus, useWatchlistMutation, useMovieWatchedMutation, watchKeys } from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { queryClient } from '@/lib/query/queryClient';
import type { CatalogMedia } from '@/domain/models/media';
import { actionPalette } from '@/theme/actionPalette';
import { colors, radius, spacing } from '@/theme';

/** Release-reminder UI is hidden for now; the button and its logic stay. */
const SHOW_RELEASE_REMINDERS = false;
const SHARE_PALETTE = actionPalette('share');
const TRAILER_PALETTE = actionPalette('trailer');
const IMDB_PALETTE = actionPalette('imdb');

export default function MediaDetailScreen() {
  const { id, season: seasonParam } = useLocalSearchParams<{ id: string; season?: string }>();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const identity = typeof id === 'string' ? parseMediaRouteId(id) : undefined;
  const mediaQuery = useCatalogMedia(identity);
  const localMediaQuery = useTrackedMedia(identity);
  const media = mediaQuery.data ?? localMediaQuery.data;
  const routeSeason = typeof seasonParam === 'string' && /^\d+$/.test(seasonParam) ? Number(seasonParam) : undefined;
  const actionMedia = useMemo<CatalogMedia>(() => media ?? (identity ? { ...identity, id: mediaId(identity), title: '', genres: [], episodeMetadata: identity.provider === 'anilist' ? 'unavailable' : 'available' } : { provider: 'tmdb', mediaType: 'movie', providerId: '', id: '', title: '', genres: [], episodeMetadata: 'unavailable' }), [identity, media]);
  const watchlistStatus = useWatchlistStatus(identity);
  const watchlistMutation = useWatchlistMutation(actionMedia, watchlistStatus.data ?? false);
  const favoriteStatus = useFavoriteStatus(identity);
  const favoriteMutation = useFavoriteMutation(actionMedia, favoriteStatus.data ?? false);
  const watchedStatus = useMovieWatchedStatus(identity);
  const watchedMutation = useMovieWatchedMutation(actionMedia, watchedStatus.data ?? false);
  const saveToWatchlistMutation = useSaveToWatchlist(actionMedia);
  const watchlistQuery = useWatchlist();
  const savedPriority: WatchPriority | null = watchlistQuery.data?.find((entry) => entry.media.id === actionMedia.id)?.priority ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const seriesProgress = useSeriesProgress();
  const progressRow = seriesProgress.data?.find((item) => item.media.id === (identity ? mediaId(identity) : undefined));
  // A tracked row with zero watched episodes is not "watching" — it can be a
  // leftover from an older build or a cleared title. Only real progress (or a
  // finished flag) belongs on the content page and in the Watching tab.
  const progress = progressRow && (progressRow.watchedEpisodeCount > 0 || progressRow.isComplete) ? progressRow : undefined;
  const isTracking = Boolean(progress && !progress.isComplete);
  const trailerQuery = useTrailerKey(identity);
  const providersQuery = useWatchProviders(identity);
  const creditsQuery = useMediaCredits(identity);
  const contentRatingQuery = useContentRating(identity);
  const enrichment = useTmdbEnrichment(media);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [finishingSeries, setFinishingSeries] = useState(false);
  // React state updates are asynchronous; two taps in the same frame can both
  // pass a `statusBusy` check. This ref makes the one-tap contract real.
  const actionLock = useRef(false);
  const [sharing, setSharing] = useState(false);
  const shareMotion = usePressMotion('pop', 0.9);
  const trailerMotion = usePressMotion('pulse', 0.92);

  async function markSeriesFinished(): Promise<void> {
    if (!media || media.mediaType === 'movie' || actionLock.current) return;
    actionLock.current = true;
    triggerMediumHaptic();
    setStatusBusy(true);
    setFinishingSeries(true);
    // Show the state change immediately. A large show may need a moment to
    // fetch/cache every season, but the button must never feel ignored. The
    // real result replaces this optimistic row when the write finishes.
    await queryClient.cancelQueries({ queryKey: watchKeys.progress });
    const previousProgress = queryClient.getQueryData<SeriesProgress[]>(watchKeys.progress);
    const optimisticTotal = progress?.totalEpisodeCount ?? actionMedia.numberOfEpisodes;
    const optimistic: SeriesProgress = {
      identity: { provider: actionMedia.provider, mediaType: actionMedia.mediaType, providerId: actionMedia.providerId },
      media: progress?.media ?? actionMedia,
      watchedEpisodeCount: Math.max(1, progress?.watchedEpisodeCount ?? 0),
      cachedEpisodeCount: progress?.cachedEpisodeCount ?? optimisticTotal ?? 0,
      totalEpisodeCount: optimisticTotal,
      progress: optimisticTotal ? Math.min(1, Math.max(1, progress?.watchedEpisodeCount ?? 0) / optimisticTotal) : 0,
      isComplete: false,
      lastWatchedAt: new Date().toISOString(),
      nextEpisode: progress?.nextEpisode,
      nextEpisodes: progress?.nextEpisodes,
      nextSeasonNumber: progress?.nextSeasonNumber,
    };
    queryClient.setQueryData<SeriesProgress[]>(watchKeys.progress, (old) => {
      const list = old ?? [];
      return list.some((item) => item.media.id === optimistic.media.id)
        ? list.map((item) => item.media.id === optimistic.media.id ? optimistic : item)
        : [...list, optimistic];
    });
    try {
      await finishTitle(actionMedia);
      triggerSuccessHaptic();
      void queryClient.invalidateQueries({ queryKey: ['watch'] });
      scheduleAutoSync('mutation');
      showToast('Marked aired episodes as watched', 'success');
    } catch (error) {
      queryClient.setQueryData(watchKeys.progress, previousProgress ?? []);
      void queryClient.invalidateQueries({ queryKey: watchKeys.progress });
      void showDialog({ type: 'error', title: 'Couldn’t mark as finished', message: friendlyErrorMessage(error) });
    }
    finally {
      actionLock.current = false;
      setStatusBusy(false);
      setFinishingSeries(false);
    }
  }

  async function clearSeriesProgress(confirm: boolean): Promise<void> {
    if (!media || media.mediaType === 'movie' || actionLock.current) return;
    actionLock.current = true;
    if (confirm) {
      const confirmed = await showDialog({
        type: 'warning', title: 'Mark whole series unwatched?',
        message: 'All episode watches for this title will be cleared so you can start over.',
        primaryAction: { label: 'Clear progress' }, secondaryAction: { label: 'Keep as is' },
      });
      if (!confirmed) {
        actionLock.current = false;
        return;
      }
    }
    triggerMediumHaptic();
    setStatusBusy(true);
    // Capture exact watch positions before clearing. Undo must restore the
    // episodes the user actually watched (including out-of-order marks), not
    // simply re-mark every aired episode.
    let snapshot: WatchedEpisodeSnapshot[] = [];
    const manualCount = progress?.watchedEpisodeCount ?? 0;
    try {
      snapshot = await watchStateRepository.getWatchedEpisodeSnapshot({ provider: media.provider, mediaType: media.mediaType, providerId: media.providerId });
    } catch (error) {
      actionLock.current = false;
      setStatusBusy(false);
      void showDialog({ type: 'error', title: 'Couldn’t clear progress', message: friendlyErrorMessage(error) });
      return;
    }
    await queryClient.cancelQueries({ queryKey: watchKeys.progress });
    const previousProgress = queryClient.getQueryData<SeriesProgress[]>(watchKeys.progress);
    queryClient.setQueryData<SeriesProgress[]>(watchKeys.progress, (old) => {
      const list = old ?? [];
      const id = identity ? mediaId(identity) : undefined;
      if (!list.some((item) => item.media.id === id)) return list;
      return list.map((item) => item.media.id === id ? { ...item, isComplete: false, watchedEpisodeCount: 0, progress: 0, nextEpisode: undefined, nextEpisodes: undefined } : item);
    });
    try {
      // One repository call clears watched episodes, series completion, and
      // manual anime progress, then queues the matching sync tombstones.
      await watchStateRepository.setSeriesWatched(media, [], false);
      triggerSuccessHaptic();
      const restore = async () => {
        try {
          await watchStateRepository.restoreWatchedEpisodes(media, snapshot);
          // Anime without episode rows stores its progress separately.
          if (manualCount > snapshot.length) await watchStateRepository.setAnimeWatchedCount(media, manualCount);
          triggerSuccessHaptic();
          void queryClient.invalidateQueries({ queryKey: ['watch'] });
          scheduleAutoSync('mutation');
          showToast('Progress restored', 'success');
        } catch (error) {
          void showDialog({ type: 'error', title: 'Couldn’t restore progress', message: friendlyErrorMessage(error) });
        }
      };
      showToast(confirm ? 'Progress cleared' : 'Removed from Watching', 'info', { actionLabel: 'Undo', durationMs: 5000, onAction: () => void restore() });
      void queryClient.invalidateQueries({ queryKey: ['watch'] });
      scheduleAutoSync('mutation');
    } catch (error) {
      queryClient.setQueryData(watchKeys.progress, previousProgress ?? []);
      void queryClient.invalidateQueries({ queryKey: watchKeys.progress });
      void showDialog({ type: 'error', title: 'Couldn’t clear progress', message: friendlyErrorMessage(error) });
    }
    finally {
      actionLock.current = false;
      setStatusBusy(false);
    }
  }

  useEffect(() => {
    const error = watchlistMutation.error ?? watchedMutation.error ?? favoriteMutation.error ?? saveToWatchlistMutation.error;
    if (error) void showDialog({ type: 'error', title: 'Couldn’t update your library', message: friendlyErrorMessage(error) });
  }, [watchlistMutation.error, watchedMutation.error, favoriteMutation.error, saveToWatchlistMutation.error]);

  if (!identity) return <Screen><View style={styles.center}><ErrorView message="This media link is not valid." onRetry={() => router.replace('/search')} /></View></Screen>;
  if (mediaQuery.isLoading && !media) return <Screen><DetailSkeleton /></Screen>;
  if (mediaQuery.isError && !media || !media) {
    const message = mediaQuery.error instanceof CatalogError ? mediaQuery.error.userMessage : 'Could not load this title. Check your connection and try again.';
    return <Screen><View style={styles.center}><ErrorView message={message} onRetry={() => void mediaQuery.refetch()} /></View></Screen>;
  }

  const episodic = media.mediaType !== 'movie';
  const genres = media.genres.map((genre) => genre.name);
  const kindLabel = media.mediaType === 'movie' ? 'Movie' : media.mediaType === 'series' ? 'TV series' : media.animeFormat || 'Anime';
  const runtimeLabel = media.runtimeMinutes ? (media.runtimeMinutes >= 60 ? `${Math.floor(media.runtimeMinutes / 60)}h ${media.runtimeMinutes % 60 ? `${media.runtimeMinutes % 60}m` : ''}`.trim() : `${media.runtimeMinutes}m`) : undefined;
  const seasonCount = media.mediaType !== 'movie' ? media.seasonSummaries?.length : undefined;
  const headingMeta = [kindLabel, media.year, runtimeLabel, seasonCount ? `${seasonCount} Season${seasonCount === 1 ? '' : 's'}` : undefined].filter(Boolean).join(' • ');
  // TVDB titles carry cast, directors, and age ratings in the detail payload;
  // legacy provider titles resolve them through the metadata hooks below.
  const trailerKey = media.trailerKey ?? trailerQuery.data;
  const directors = (media.directors ?? creditsQuery.data ?? []).join(', ');
  const directorCell = directors ? { label: 'Directed By', value: directors }
    : media.mediaType === 'anime' && media.studios?.length ? { label: 'Studio', value: media.studios[0] }
    : undefined;
  const ageRating = media.contentRating ?? contentRatingQuery.data;
  const infoItems = [
    directorCell,
    { label: 'Country', value: countryName(media.originCountries?.[0]) },
    { label: 'Language', value: languageName(media.language) },
    { label: 'Age Rating', value: ageRating },
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value)).slice(0, 4);

  const primaryBusy = statusBusy || watchedMutation.isPending;
  const watched = media.mediaType === 'movie' ? watchedStatus.data : progress?.isComplete;
  // TMDb score bridged through TVDB's own remote IDs; legacy titles already
  // carry their score in the base payload.
  const score = enrichment.data?.rating ?? (media.provider !== 'tvdb' ? media.rating : undefined);
  const scoreVotes = enrichment.data?.voteCount ?? (media.provider !== 'tvdb' ? media.voteCount : undefined);
  const providerGroups = providersQuery.data ?? enrichment.data?.providers ?? [];
  // Unreleased titles (e.g. announced blockbusters in Browse) can be
  // watchlisted and favorited, but never marked watched before release.
  const upcoming = isUpcoming(media);
  const releaseLabel = formatReleaseDate(media.releaseDate);
  const primaryAction = getDetailPrimaryAction({
    mediaType: media.mediaType,
    upcoming,
    releaseLabel,
    watched,
    tracking: isTracking,
  });
  const watchLaterAction = getWatchLaterActionPresentation({
    saved: watchlistStatus.data ?? false,
    priority: savedPriority,
    // Tracking alone (for example the search card's play button) is not yet
    // "watching": keep showing the saved priority until an episode is marked.
    watching: Boolean(progress && !progress.isComplete && progress.watchedEpisodeCount > 0),
  });
  const streamProviders = providerGroups.find((group) => group.category === 'stream')?.providers ?? [];
  const streamingLabel = streamProviders.slice(0, 3).map((provider) => provider.name).join(', ');
  const statusLabel = upcoming
    ? 'Coming soon'
    : media.mediaType === 'movie'
      ? watched ? 'Watched' : 'Not watched'
      : watched
        ? `Completed${progress?.totalEpisodeCount ? ` · ${progress.totalEpisodeCount} episodes` : ''}`
        : progress
          ? finishingSeries
            ? 'Watching · updating episodes'
            : `Watching · ${progress.watchedEpisodeCount}${progress.totalEpisodeCount ? `/${progress.totalEpisodeCount}` : ''} episodes`
          : isTracking ? 'Tracking' : 'Not started';
  const statusColor = upcoming ? actionPalette('upcoming').color : watched ? actionPalette('watched').color : isTracking ? actionPalette('watching').color : colors.textMuted;
  const heroHeight = Math.min(500, Math.max(380, height * 0.52));

  function handlePrimary() {
    if (!media || primaryBusy || upcoming) return;
    if (primaryAction.clearsProgress) {
      void clearSeriesProgress(false);
      return;
    }
    triggerMediumHaptic();
    if (media.mediaType === 'movie') {
      watchedMutation.mutate(undefined, {
        onSuccess: () => { triggerSuccessHaptic(); if (!watchedStatus.data) showToast('Marked as watched', 'success'); },
        onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t mark as watched', message: friendlyErrorMessage(error) }),
      });
      return;
    }
    if (watched) {
      void clearSeriesProgress(true);
      return;
    }
    void markSeriesFinished();
  }

  function handleSavePriority(priority: WatchPriority) {
    triggerLightHaptic();
    // Saving over a watched title moves it out of Watched into the watchlist.
    const movedFromWatched = Boolean(watched);
    saveToWatchlistMutation.mutate(priority, {
      onSuccess: () => {
        triggerSuccessHaptic();
        setSheetOpen(false);
        showToast(`${movedFromWatched ? 'Moved' : 'Saved'} to Watchlist · ${PRIORITY_META[priority].label}`, 'success');
      },
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t save to watchlist', message: friendlyErrorMessage(error) }),
    });
  }

  function handleRemoveFromWatchlist() {
    triggerLightHaptic();
    const removedPriority = savedPriority;
    watchlistMutation.mutate(undefined, {
      onSuccess: () => {
        setSheetOpen(false);
        showToast('Removed from watchlist', 'info', {
          actionLabel: 'Undo',
          durationMs: 5000,
          onAction: () => {
            saveToWatchlistMutation.mutate(removedPriority ?? null, {
              onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t restore watchlist', message: friendlyErrorMessage(error) }),
            });
          },
        });
      },
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t update your watchlist', message: friendlyErrorMessage(error) }),
    });
  }

  function toggleFavorite() {
    triggerLightHaptic();
    favoriteMutation.mutate(undefined, {
      onSuccess: () => { triggerSuccessHaptic(); if (!favoriteStatus.data) showToast('Added to favorites', 'success'); },
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t update favorites', message: friendlyErrorMessage(error) }),
    });
  }

  async function shareTitle() {
    if (!media || sharing) return;
    triggerLightHaptic();
    setSharing(true);
    try {
      const shareKind = media.mediaType === 'anime' ? 'Anime' : kindLabel;
      const shareScore = typeof score === 'number' ? score : media.rating;
      await shareMedia(media, shareKind, typeof shareScore === 'number' ? shareScore : undefined);
    } catch {
      void showDialog({ type: 'error', title: 'Couldn’t share this title', message: 'Give it another try in a moment.' });
    } finally {
      setSharing(false);
    }
  }

  return <Screen scroll>
    <View style={[styles.hero, { height: heroHeight }]}>
      <LinearGradient colors={['#241D33', colors.background]} style={StyleSheet.absoluteFill} />
      {media.backdropUrl && !backdropFailed
        ? <RemoteImage uri={media.backdropUrl} style={StyleSheet.absoluteFill} onError={() => setBackdropFailed(true)} />
        : media.posterUrl && !posterFailed
          ? <RemoteImage uri={media.posterUrl} style={StyleSheet.absoluteFill} onError={() => setPosterFailed(true)} />
          : null}
      <LinearGradient
        colors={['rgba(5,6,10,0.80)', 'rgba(5,6,10,0.08)', 'rgba(5,6,10,0.97)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroTop}>
        <IconButton name="arrow-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={styles.heroTopActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share this title"
            accessibilityState={{ disabled: sharing }}
            disabled={sharing}
            onPress={() => { shareMotion.play(); void shareTitle(); }}
            onPressIn={shareMotion.pressIn}
            onPressOut={shareMotion.pressOut}
            style={({ pressed }) => [styles.heroAction, { backgroundColor: SHARE_PALETTE.soft, borderColor: SHARE_PALETTE.border }, pressed && styles.pressed]}
          >
            <Animated.View style={shareMotion.pressMotionStyle}>
              <Ionicons name="share-outline" size={19} color={SHARE_PALETTE.color} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
      {trailerKey ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play trailer"
          onPress={() => { trailerMotion.play(); void openURL(`https://www.youtube.com/watch?v=${trailerKey}`); }}
          onPressIn={trailerMotion.pressIn}
          onPressOut={trailerMotion.pressOut}
          style={styles.playButton}
        >
          <Animated.View style={[styles.playButtonInner, trailerMotion.pressMotionStyle]}>
            <LinearGradient colors={TRAILER_PALETTE.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playGradient}>
              <Ionicons name="play" size={28} color={TRAILER_PALETTE.onColor} />
            </LinearGradient>
          </Animated.View>
        </Pressable>
      ) : null}
    </View>
    <FadeInView style={styles.body}>
      <View style={styles.detailHeader}>
        {media.posterUrl && !posterFailed
          ? <RemoteImage uri={media.posterUrl} style={styles.detailPoster} onError={() => setPosterFailed(true)} />
          : <View style={[styles.detailPoster, styles.posterFallback]}><Ionicons name="film-outline" size={28} color={colors.accent} /></View>}
        <View style={styles.detailCopy}>
          <AppText variant="caption" muted numberOfLines={1} style={styles.detailMeta}>{headingMeta}</AppText>
          <AppText style={styles.detailTitle} numberOfLines={2}>{media.title}</AppText>
          {infoItems.length ? (
            <View style={styles.detailInfoGrid}>
              {infoItems.map((item) => (
                <View key={item.label} style={styles.detailInfoCell}>
                  <AppText variant="caption" muted style={styles.detailInfoLabel}>{item.label}</AppText>
                  <AppText style={styles.detailInfoValue} numberOfLines={2}>{item.value}</AppText>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.detailStatsRow}>
            <View style={styles.statusPill}><View style={[styles.statusDot, { backgroundColor: statusColor }]} /><AppText variant="caption" style={styles.statusText}>{statusLabel}</AppText></View>
            {typeof score === 'number' ? <View style={styles.scorePill} accessibilityRole="text" accessibilityLabel={`Rated ${score.toFixed(1)} out of 10${typeof scoreVotes === 'number' ? ` from ${scoreVotes} votes` : ''}`}><Ionicons name="star" size={13} color={colors.accent} /><AppText variant="bodySmall" style={styles.scoreText}>{score.toFixed(1)}</AppText>{typeof scoreVotes === 'number' ? <AppText variant="caption" muted>({scoreVotes >= 1000000 ? `${(scoreVotes / 1000000).toFixed(1)}M` : scoreVotes >= 1000 ? `${(scoreVotes / 1000).toFixed(1)}k` : `${scoreVotes}`})</AppText> : null}</View> : null}
            {streamingLabel ? <View style={styles.streamingRow}><Ionicons name="play-circle-outline" size={14} color={colors.textSecondary} /><AppText variant="caption" muted numberOfLines={1} style={styles.streamingText}>Streaming on {streamingLabel}</AppText></View> : null}
          </View>
        </View>
      </View>
      {genres.length ? <View style={styles.genreRow}>{genres.map((genre) => <View key={genre} style={styles.genreChip}><AppText variant="caption" style={styles.genreText}>{genre}</AppText></View>)}</View> : null}
      <DetailActions
        primaryLabel={primaryAction.label}
        primaryIcon={primaryAction.icon}
        primaryTone={primaryAction.tone}
        primaryMotion={primaryAction.motion}
        primaryActive={primaryAction.active}
        primaryBusy={primaryBusy || upcoming}
        onPrimary={handlePrimary}
        extra={trailerKey ? { label: 'Trailer', icon: 'play', tone: 'trailer', motion: 'pulse', onPress: () => void openURL(`https://www.youtube.com/watch?v=${trailerKey}`), accessibilityLabel: 'Play trailer' } : undefined}
        secondary={[
          {
            id: 'watch-later',
            label: watchLaterAction.label,
            icon: watchLaterAction.icon as keyof typeof Ionicons.glyphMap,
            activeIcon: watchLaterAction.activeIcon as keyof typeof Ionicons.glyphMap,
            tone: watchLaterAction.tone,
            motion: watchLaterAction.motion,
            active: watchlistStatus.data ?? false,
            busy: watchlistStatus.isLoading || watchlistMutation.isPending || saveToWatchlistMutation.isPending,
            onPress: () => { triggerLightHaptic(); setSheetOpen(true); },
            accessibilityLabel: watchLaterAction.accessibilityLabel,
          },
          {
            id: 'favorite',
            label: 'Favorite',
            icon: 'heart-outline',
            activeIcon: 'heart',
            tone: 'favorite',
            motion: 'heartbeat',
            active: favoriteStatus.data ?? false,
            busy: favoriteStatus.isLoading || favoriteMutation.isPending,
            onPress: toggleFavorite,
            accessibilityLabel: favoriteStatus.data ? 'Remove from favorites' : 'Add to favorites',
          },
        ]}
      />
      <WatchLaterSheet
        visible={sheetOpen}
        saved={watchlistStatus.data ?? false}
        currentPriority={savedPriority}
        busy={saveToWatchlistMutation.isPending || watchlistMutation.isPending}
        onSelect={handleSavePriority}
        onRemove={handleRemoveFromWatchlist}
        onClose={() => setSheetOpen(false)}
      />
      {upcoming ? <><View style={styles.messageCard}><Ionicons name="calendar-outline" size={19} color={colors.accent} /><AppText variant="bodySmall" muted style={styles.messageText}>Releases{releaseLabel ? ` ${releaseLabel}` : ' soon'} — save it to your Watchlist, then mark it watched after release.</AppText></View>{SHOW_RELEASE_REMINDERS ? <NotifyMeButton media={media} /> : null}</> : null}
      {progress && episodic ? <View style={styles.progressCard}>
        <View style={styles.progressTop}><AppText style={styles.progressKicker}>YOUR PROGRESS</AppText><AppText variant="caption" muted>{finishingSeries ? 'Updating episodes…' : `${progress.watchedEpisodeCount}${progress.totalEpisodeCount ? ` / ${progress.totalEpisodeCount}` : ''} episodes`}</AppText></View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(Math.max(0, Math.min(1, progress.progress)) * 100)}%` }]} /></View>
        {progress.nextEpisode ? <AppText variant="caption" muted style={styles.progressNext}>Up next · S{progress.nextEpisode.seasonNumber} E{progress.nextEpisode.episodeNumber} · {progress.nextEpisode.title}</AppText> : null}
      </View> : null}
      <View style={styles.overviewBlock}>
        <AppText variant="heading3">Overview</AppText>
        <AppText variant="bodySmall" muted style={styles.overview}>{media.overview || 'Overview is not available for this title.'}</AppText>
      </View>
      {media.imdbId ? <View style={styles.extras}><AppButton variant="secondary" tone="imdb" motion="bounce" label="Open IMDb" icon={<Ionicons name="open-outline" size={16} color={IMDB_PALETTE.color} />} onPress={() => void openURL(`https://www.imdb.com/title/${media.imdbId}/`)} /></View> : null}
      {media.cast?.length ? <View style={styles.section}><AppText variant="heading3">Top cast</AppText><FlatList horizontal data={media.cast.slice(0, 12)} keyExtractor={(item, index) => `${item.name}-${index}`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow} renderItem={({ item }) => (
        <View style={styles.castCard} accessibilityRole="text" accessibilityLabel={`${item.name}${item.character ? ` as ${item.character}` : ''}`}>
          {item.imageUrl ? <RemoteImage uri={item.imageUrl} style={styles.castPhoto} /> : <View style={[styles.castPhoto, styles.castFallback]}><Ionicons name="person-outline" size={20} color={colors.textMuted} /></View>}
          <AppText variant="bodySmall" numberOfLines={1} style={styles.castName}>{item.name}</AppText>
          {item.character ? <AppText variant="caption" muted numberOfLines={1}>{item.character}</AppText> : null}
        </View>
      )} /></View> : null}
      {providerGroups.length ? <View style={styles.section}><AppText variant="heading3" style={styles.seasonHeading}>Where to watch</AppText>{providerGroups.map((group) => <View key={group.category} style={styles.providerGroup}><AppText variant="caption" muted style={styles.providerCategory}>{group.category === 'stream' ? 'Stream' : group.category === 'rent' ? 'Rent' : 'Buy'}</AppText><View style={styles.providerRow}>{group.providers.map((provider) => <View key={provider.id} style={styles.provider} accessibilityRole="image" accessibilityLabel={provider.name}>{provider.logoUrl ? <RemoteImage uri={provider.logoUrl} style={styles.providerLogo} /> : <AppText variant="caption">{provider.name.slice(0, 2).toUpperCase()}</AppText>}</View>)}</View></View>)}</View> : null}
      {episodic ? <View style={styles.section}><AppText variant="heading3" style={styles.seasonHeading}>Seasons & episodes</AppText>
        <SeasonsSection media={media} progress={progress} initialSeasonNumber={routeSeason} />
      </View> : null}
      {media.studios?.length ? <View style={styles.section}><AppText variant="heading3">Studios</AppText><AppText variant="bodySmall" muted style={styles.overview}>{media.studios.join(' · ')}</AppText></View> : null}
    </FadeInView>
  </Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  hero: { marginHorizontal: -spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, justifyContent: 'space-between', overflow: 'hidden', backgroundColor: colors.surface },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  heroTopActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroAction: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,12,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' },
  pressed: { opacity: 0.78 },
  playButton: { position: 'absolute', top: '40%', left: '50%', marginLeft: -30, width: 60, height: 60, borderRadius: 30, overflow: 'hidden' },
  playButtonInner: { flex: 1, borderRadius: 30, overflow: 'hidden' },
  playGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: 'rgba(8,6,14,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: colors.white, fontWeight: '600' },
  scorePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(8,6,14,0.62)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  scoreText: { color: colors.white, fontWeight: '700' },
  streamingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  streamingText: { flexShrink: 1 },
  body: { marginHorizontal: -spacing.sm, marginTop: -spacing['3xl'], gap: spacing.lg },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  detailPoster: { width: 100, height: 150, borderRadius: radius.medium, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', shadowColor: '#000000', shadowOpacity: 0.38, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  detailCopy: { flex: 1, gap: 4, paddingTop: 2 },
  detailMeta: { flexShrink: 1, fontSize: 11.5, lineHeight: 15 },
  detailTitle: { color: colors.white, fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -0.7 },
  detailInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.sm, marginTop: 2 },
  detailInfoCell: { flexBasis: '46%', flexGrow: 1, gap: 1 },
  detailInfoLabel: { fontSize: 10.5, lineHeight: 13, letterSpacing: 0.2 },
  detailInfoValue: { color: colors.textPrimary, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  detailStatsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 2 },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genreChip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  genreText: { color: colors.textPrimary, fontWeight: '600' },
  messageCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.medium, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  messageText: { flex: 1 },
  progressCard: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  progressKicker: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 1.6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  progressNext: { marginTop: 2 },
  overviewBlock: { gap: spacing.xs },
  overview: { lineHeight: 22 },
  extras: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  section: { marginTop: spacing.lg },
  seasonHeading: { marginBottom: spacing.md },
  castRow: { gap: spacing.md, paddingRight: spacing.xl, marginTop: spacing.md },
  castCard: { width: 84, gap: spacing.xs },
  castPhoto: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  castFallback: { alignItems: 'center', justifyContent: 'center' },
  castName: { color: colors.white },
  providerGroup: { gap: spacing.sm, marginTop: spacing.md },
  providerCategory: { letterSpacing: 1 },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  provider: { width: 46, height: 46, borderRadius: radius.small, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  providerLogo: { width: 44, height: 44, borderRadius: radius.small },
});
