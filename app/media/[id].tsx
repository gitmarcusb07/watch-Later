import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { openURL } from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { FlatList, Image, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/buttons/IconButton';
import { AppButton } from '@/components/buttons/AppButton';
import { DetailActions } from '@/components/media/DetailActions';
import { WatchLaterSheet } from '@/components/media/WatchLaterSheet';
import { FadeInView } from '@/components/common/FadeInView';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { triggerLightHaptic, triggerMediumHaptic, triggerSuccessHaptic } from '@/lib/haptics';
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
import { PRIORITY_META } from '@/features/watchState/priority';
import type { SeriesProgress, WatchPriority } from '@/domain/models/watchState';
import { useFavoriteMutation, useFavoriteStatus, useMovieWatchedStatus, useSaveToWatchlist, useSeriesProgress, useSeriesTrackingStatus, useTrackedMedia, useWatchlist, useWatchlistStatus, useWatchlistMutation, useMovieWatchedMutation, useSeriesTrackingMutation, useSetUserRating, useUserRating, watchKeys } from '@/features/watchState/hooks';
import { watchStateRepository } from '@/data/local/repositories/SqliteWatchStateRepository';
import { scheduleAutoSync } from '@/features/sync/autoSync';
import { queryClient } from '@/lib/query/queryClient';
import type { CatalogMedia } from '@/domain/models/media';
import { colors, radius, spacing } from '@/theme';

/** Release-reminder UI is hidden for now; the button and its logic stay. */
const SHOW_RELEASE_REMINDERS = false;

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
  const trackingStatus = useSeriesTrackingStatus(identity);
  const trackingMutation = useSeriesTrackingMutation(actionMedia, trackingStatus.data ?? false);
  const saveToWatchlistMutation = useSaveToWatchlist(actionMedia);
  const watchlistQuery = useWatchlist();
  const savedPriority: WatchPriority | null = watchlistQuery.data?.find((entry) => entry.media.id === actionMedia.id)?.priority ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const seriesProgress = useSeriesProgress();
  const progress = seriesProgress.data?.find((item) => item.media.id === (identity ? mediaId(identity) : undefined));
  const trailerQuery = useTrailerKey(identity);
  const providersQuery = useWatchProviders(identity);
  const creditsQuery = useMediaCredits(identity);
  const contentRatingQuery = useContentRating(identity);
  const enrichment = useTmdbEnrichment(media);
  const ratingQuery = useUserRating(identity);
  const ratingMutation = useSetUserRating();
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  async function markSeriesFinished(): Promise<void> {
    if (!media || media.mediaType === 'movie' || statusBusy) return;
    triggerMediumHaptic();
    setStatusBusy(true);
    // Flip to watched instantly; the season-by-season network fetch + write
    // below can take seconds. Rolls back on failure.
    await queryClient.cancelQueries({ queryKey: watchKeys.progress });
    const previous = queryClient.getQueryData<SeriesProgress[]>(watchKeys.progress);
    queryClient.setQueryData<SeriesProgress[]>(watchKeys.progress, (old) => {
      const list = old ?? [];
      const id = identity ? mediaId(identity) : undefined;
      if (list.some((item) => item.media.id === id)) {
        return list.map((item) => item.media.id === id ? { ...item, isComplete: true, progress: 1 } : item);
      }
      const total = media.numberOfEpisodes ?? media.seasonSummaries?.reduce((sum, summary) => sum + (summary.episodeCount ?? 0), 0) ?? 0;
      return [...list, {
        identity: identity ?? { provider: media.provider, mediaType: media.mediaType, providerId: media.providerId },
        media: actionMedia, watchedEpisodeCount: total, cachedEpisodeCount: total,
        totalEpisodeCount: total > 0 ? total : undefined, progress: 1, isComplete: true,
      }];
    });
    try {
      await finishTitle(actionMedia);
      triggerSuccessHaptic();
      void queryClient.invalidateQueries({ queryKey: ['watch'] });
      scheduleAutoSync('mutation');
      showToast('Marked whole show as watched', 'success');
    } catch (error) {
      queryClient.setQueryData(watchKeys.progress, previous);
      void showDialog({ type: 'error', title: 'Couldn’t mark as finished', message: friendlyErrorMessage(error) });
    }
    finally { setStatusBusy(false); }
  }

  async function markSeriesUnwatched(): Promise<void> {
    if (!media || media.mediaType === 'movie' || statusBusy) return;
    const confirmed = await showDialog({
      type: 'warning', title: 'Mark whole series unwatched?',
      message: 'All episode watches for this title will be cleared so you can start over.',
      primaryAction: { label: 'Clear progress' }, secondaryAction: { label: 'Keep as is' },
    });
    if (!confirmed) return;
    setStatusBusy(true);
    await queryClient.cancelQueries({ queryKey: watchKeys.progress });
    const previousProgress = queryClient.getQueryData<SeriesProgress[]>(watchKeys.progress);
    queryClient.setQueryData<SeriesProgress[]>(watchKeys.progress, (old) => {
      const list = old ?? [];
      const id = identity ? mediaId(identity) : undefined;
      if (!list.some((item) => item.media.id === id)) return list;
      return list.map((item) => item.media.id === id ? { ...item, isComplete: false, watchedEpisodeCount: 0, progress: 0, nextEpisode: undefined } : item);
    });
    try {
      if (media.episodeMetadata === 'available') await watchStateRepository.setSeriesWatched(media, [], false);
      else await watchStateRepository.setSeriesComplete(media, false);
      void queryClient.invalidateQueries({ queryKey: ['watch'] });
      scheduleAutoSync('mutation');
    } catch (error) {
      queryClient.setQueryData(watchKeys.progress, previousProgress);
      void showDialog({ type: 'error', title: 'Couldn’t clear progress', message: friendlyErrorMessage(error) });
    }
    finally { setStatusBusy(false); }
  }

  useEffect(() => {
    const error = watchlistMutation.error ?? watchedMutation.error ?? trackingMutation.error ?? favoriteMutation.error ?? saveToWatchlistMutation.error;
    if (error) void showDialog({ type: 'error', title: 'Couldn’t update your library', message: friendlyErrorMessage(error) });
  }, [watchlistMutation.error, watchedMutation.error, trackingMutation.error, favoriteMutation.error, saveToWatchlistMutation.error]);

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
  const headingMeta = [kindLabel, media.year, runtimeLabel].filter(Boolean).join(' • ');
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
  const primaryLabel = upcoming ? (releaseLabel ? `Coming ${releaseLabel}` : 'Not released yet') : watched ? 'Watched' : 'Mark as Watched';
  const primaryIcon = watched && !upcoming ? 'eye' as const : upcoming ? 'calendar-outline' as const : 'eye-outline' as const;
  const userRating = ratingQuery.data?.rating ?? null;
  const streamProviders = providerGroups.find((group) => group.category === 'stream')?.providers ?? [];
  const streamingLabel = streamProviders.slice(0, 3).map((provider) => provider.name).join(', ');
  const statusLabel = upcoming
    ? 'Coming soon'
    : media.mediaType === 'movie'
      ? watched ? 'Watched' : 'Not watched'
      : watched
        ? `Completed${progress?.totalEpisodeCount ? ` · ${progress.totalEpisodeCount} episodes` : ''}`
        : progress
          ? `Watching · ${progress.watchedEpisodeCount}${progress.totalEpisodeCount ? `/${progress.totalEpisodeCount}` : ''} episodes`
          : trackingStatus.data ? 'Tracking' : 'Not started';
  const statusColor = upcoming ? colors.warning : watched ? colors.success : trackingStatus.data ? colors.accent : colors.textMuted;
  const heroHeight = Math.min(560, Math.max(400, height * 0.58));

  function handlePrimary() {
    if (!media || primaryBusy || upcoming) return;
    triggerMediumHaptic();
    if (media.mediaType === 'movie') {
      watchedMutation.mutate(undefined, {
        onSuccess: () => { triggerSuccessHaptic(); if (!watchedStatus.data) showToast('Marked as watched', 'success'); },
        onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t mark as watched', message: friendlyErrorMessage(error) }),
      });
      return;
    }
    if (watched) {
      void markSeriesUnwatched();
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
    watchlistMutation.mutate(undefined, {
      onSuccess: () => {
        setSheetOpen(false);
        showToast('Removed from watchlist', 'info');
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

  function handleRate(star: number) {
    if (ratingMutation.isPending) return;
    triggerLightHaptic();
    ratingMutation.mutate({ media: actionMedia, rating: star * 2, thumbs: 0 }, {
      onSuccess: () => triggerSuccessHaptic(),
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t save your rating', message: friendlyErrorMessage(error) }),
    });
  }

  function clearRating() {
    if (ratingMutation.isPending) return;
    triggerLightHaptic();
    ratingMutation.mutate({ media: actionMedia, rating: null, thumbs: 0 }, {
      onError: (error) => void showDialog({ type: 'error', title: 'Couldn’t clear your rating', message: friendlyErrorMessage(error) }),
    });
  }

  function shareTitle() {
    if (!media) return;
    triggerLightHaptic();
    const message = `${media.title}${media.year ? ` (${media.year})` : ''} — ${kindLabel}${typeof score === 'number' ? ` · ${score.toFixed(1)}/10` : ''}. Track it on Watch Later.`;
    void Share.share({ message }).catch(() => undefined);
  }

  return <Screen><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
    <View style={[styles.hero, { height: heroHeight }]}>
      <LinearGradient colors={['#241D33', colors.background]} style={StyleSheet.absoluteFill} />
      {media.backdropUrl && !backdropFailed
        ? <Image source={{ uri: media.backdropUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setBackdropFailed(true)} />
        : media.posterUrl && !posterFailed
          ? <Image source={{ uri: media.posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setPosterFailed(true)} />
          : null}
      <LinearGradient
        colors={['rgba(5,6,10,0.80)', 'rgba(5,6,10,0.08)', 'rgba(5,6,10,0.97)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroTop}>
        <IconButton name="arrow-back" label="Go back" onPress={() => router.back()} />
        <View style={styles.heroTopActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favoriteStatus.data ? 'Remove from favorites' : 'Add to favorites'}
            accessibilityState={{ selected: favoriteStatus.data ?? false, disabled: favoriteMutation.isPending }}
            disabled={favoriteMutation.isPending}
            onPress={toggleFavorite}
            style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}
          >
            <Ionicons name={favoriteStatus.data ? 'heart' : 'heart-outline'} size={19} color={favoriteStatus.data ? colors.error : colors.white} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share this title" onPress={shareTitle} style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}>
            <Ionicons name="share-outline" size={19} color={colors.white} />
          </Pressable>
        </View>
      </View>
      {trailerKey ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Play trailer" onPress={() => void openURL(`https://www.youtube.com/watch?v=${trailerKey}`)} style={({ pressed }) => [styles.playButton, pressed && styles.playPressed]}>
          <Ionicons name="play" size={28} color={colors.white} />
        </Pressable>
      ) : null}
      <View style={styles.heroBottom}>
        <View style={styles.heroStatusRow}>
          <View style={styles.statusPill}><View style={[styles.statusDot, { backgroundColor: statusColor }]} /><AppText variant="caption" style={styles.statusText}>{statusLabel}</AppText></View>
          <AppText variant="caption" muted numberOfLines={1} style={styles.heroMeta}>{headingMeta}</AppText>
        </View>
        <AppText style={styles.heroTitle} numberOfLines={3}>{media.title}</AppText>
        <View style={styles.heroMetaRow}>
          {typeof score === 'number' ? <View style={styles.scorePill} accessibilityRole="text" accessibilityLabel={`Rated ${score.toFixed(1)} out of 10${typeof scoreVotes === 'number' ? ` from ${scoreVotes} votes` : ''}`}><Ionicons name="star" size={13} color={colors.accent} /><AppText variant="bodySmall" style={styles.scoreText}>{score.toFixed(1)}</AppText>{typeof scoreVotes === 'number' ? <AppText variant="caption" muted>({scoreVotes >= 1000000 ? `${(scoreVotes / 1000000).toFixed(1)}M` : scoreVotes >= 1000 ? `${(scoreVotes / 1000).toFixed(1)}k` : `${scoreVotes}`})</AppText> : null}</View> : null}
          {ageRating ? <View style={styles.agePill}><AppText variant="caption" style={styles.ageText}>{ageRating}</AppText></View> : null}
          {streamingLabel ? <View style={styles.streamingRow}><Ionicons name="play-circle-outline" size={14} color={colors.textSecondary} /><AppText variant="caption" muted numberOfLines={1} style={styles.streamingText}>Streaming on {streamingLabel}</AppText></View> : null}
        </View>
      </View>
    </View>
    <FadeInView style={styles.body}>
      <View style={styles.actionCard}>
        <DetailActions
          primaryLabel={primaryLabel}
          primaryIcon={primaryIcon}
          primaryActive={watched && !upcoming}
          primaryBusy={primaryBusy || upcoming}
          onPrimary={handlePrimary}
          extra={trailerKey ? { label: 'Trailer', icon: 'play', onPress: () => void openURL(`https://www.youtube.com/watch?v=${trailerKey}`), accessibilityLabel: 'Play trailer' } : undefined}
          secondary={[
            {
              id: 'watch-later',
              label: watchlistStatus.data ? (savedPriority ? PRIORITY_META[savedPriority].label : 'Watchlisted') : 'Watch Later',
              icon: 'time-outline',
              activeIcon: 'checkmark',
              active: watchlistStatus.data ?? false,
              busy: watchlistStatus.isLoading || watchlistMutation.isPending || saveToWatchlistMutation.isPending,
              onPress: () => { triggerLightHaptic(); setSheetOpen(true); },
              accessibilityLabel: 'Open watch later options',
            },
            {
              id: 'favorite',
              label: 'Favorite',
              icon: 'heart-outline',
              activeIcon: 'heart',
              active: favoriteStatus.data ?? false,
              busy: favoriteStatus.isLoading || favoriteMutation.isPending,
              onPress: toggleFavorite,
              accessibilityLabel: favoriteStatus.data ? 'Remove from favorites' : 'Add to favorites',
            },
            ...(episodic && !watched ? [{
              id: 'tracking',
              label: trackingStatus.data ? 'Tracking' : 'Track Show',
              icon: 'play-outline' as const,
              activeIcon: 'pause-circle' as const,
              active: trackingStatus.data ?? false,
              busy: trackingStatus.isLoading || trackingMutation.isPending,
              onPress: () => { triggerLightHaptic(); trackingMutation.mutate(undefined, {
                onSuccess: () => { triggerSuccessHaptic(); showToast(trackingStatus.data ? 'Stopped tracking' : 'Tracking started', 'info'); },
                onError: (error: unknown) => void showDialog({ type: 'error', title: 'Couldn’t update tracking', message: friendlyErrorMessage(error) }),
              }); },
              accessibilityLabel: trackingStatus.data ? 'Stop tracking this show' : 'Start tracking this show',
            }] : []),
          ]}
        />
      </View>
      <WatchLaterSheet
        visible={sheetOpen}
        saved={watchlistStatus.data ?? false}
        currentPriority={savedPriority}
        busy={saveToWatchlistMutation.isPending || watchlistMutation.isPending}
        onSelect={handleSavePriority}
        onRemove={handleRemoveFromWatchlist}
        onClose={() => setSheetOpen(false)}
      />
      <View style={styles.ratingCard}>
        <View style={styles.ratingHeader}>
          <View style={styles.ratingCopy}>
            <AppText style={styles.ratingKicker}>YOUR RATING</AppText>
            <AppText variant="bodyMedium">{userRating ? `${(userRating / 2).toFixed(1)} / 5` : 'Tap a star to rate'}</AppText>
          </View>
          {userRating ? <Pressable accessibilityRole="button" accessibilityLabel="Clear your rating" onPress={clearRating} hitSlop={8}><AppText variant="caption" style={styles.clearRating}>Clear</AppText></Pressable> : null}
        </View>
        <View style={styles.ratingStars} accessibilityRole="radiogroup" accessibilityLabel="Your rating">
          {[1, 2, 3, 4, 5].map((star) => {
            const full = userRating !== null && userRating >= star * 2;
            const half = userRating !== null && userRating >= star * 2 - 1;
            return (
              <Pressable key={star} accessibilityRole="radio" accessibilityLabel={`${star} out of 5 stars`} accessibilityState={{ selected: full }} onPress={() => handleRate(star)} hitSlop={6} disabled={ratingMutation.isPending}>
                <Ionicons name={full ? 'star' : half ? 'star-half' : 'star-outline'} size={28} color={full || half ? colors.accent : colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      </View>
      {genres.length ? <View style={styles.genreRow}>{genres.map((genre) => <View key={genre} style={styles.genreChip}><AppText variant="caption" style={styles.genreText}>{genre}</AppText></View>)}</View> : null}
      {upcoming ? <><View style={styles.messageCard}><Ionicons name="calendar-outline" size={19} color={colors.accent} /><AppText variant="bodySmall" muted style={styles.messageText}>Releases{releaseLabel ? ` ${releaseLabel}` : ' soon'} — save it to your Watchlist, then mark it watched after release.</AppText></View>{SHOW_RELEASE_REMINDERS ? <NotifyMeButton media={media} /> : null}</> : null}
      {infoItems.length ? (
        <View style={styles.infoGrid}>
          {infoItems.map((item) => (
            <View key={item.label} style={styles.infoCell}>
              <AppText variant="caption" muted style={styles.infoLabel}>{item.label}</AppText>
              <AppText variant="bodyMedium" style={styles.infoValue} numberOfLines={2}>{item.value}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {progress && episodic ? <View style={styles.progressCard}>
        <View style={styles.progressTop}><AppText style={styles.progressKicker}>YOUR PROGRESS</AppText><AppText variant="caption" muted>{progress.watchedEpisodeCount}{progress.totalEpisodeCount ? ` / ${progress.totalEpisodeCount}` : ''} episodes</AppText></View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(Math.max(0, Math.min(1, progress.progress)) * 100)}%` }]} /></View>
        {progress.nextEpisode ? <AppText variant="caption" muted style={styles.progressNext}>Up next · S{progress.nextEpisode.seasonNumber} E{progress.nextEpisode.episodeNumber} · {progress.nextEpisode.title}</AppText> : null}
      </View> : null}
      <View style={styles.overviewRow}>
        {media.posterUrl && !posterFailed
          ? <Image source={{ uri: media.posterUrl }} style={styles.overviewPoster} resizeMode="cover" onError={() => setPosterFailed(true)} />
          : <View style={[styles.overviewPoster, styles.posterFallback]}><Ionicons name="film-outline" size={26} color={colors.accent} /></View>}
        <View style={styles.overviewCopy}>
          <AppText variant="heading3">Overview</AppText>
          <AppText variant="bodySmall" muted style={styles.overview}>{media.overview || 'Overview is not available for this title.'}</AppText>
        </View>
      </View>
      {media.imdbId ? <View style={styles.extras}><AppButton variant="secondary" label="Open IMDb" icon={<Ionicons name="open-outline" size={16} color={colors.accent} />} onPress={() => void openURL(`https://www.imdb.com/title/${media.imdbId}/`)} /></View> : null}
      {media.cast?.length ? <View style={styles.section}><AppText variant="heading3">Top cast</AppText><FlatList horizontal data={media.cast.slice(0, 12)} keyExtractor={(item, index) => `${item.name}-${index}`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow} renderItem={({ item }) => (
        <View style={styles.castCard} accessibilityRole="text" accessibilityLabel={`${item.name}${item.character ? ` as ${item.character}` : ''}`}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.castPhoto} resizeMode="cover" /> : <View style={[styles.castPhoto, styles.castFallback]}><Ionicons name="person-outline" size={20} color={colors.textMuted} /></View>}
          <AppText variant="bodySmall" numberOfLines={1} style={styles.castName}>{item.name}</AppText>
          {item.character ? <AppText variant="caption" muted numberOfLines={1}>{item.character}</AppText> : null}
        </View>
      )} /></View> : null}
      {providerGroups.length ? <View style={styles.section}><AppText variant="heading3" style={styles.seasonHeading}>Where to watch</AppText>{providerGroups.map((group) => <View key={group.category} style={styles.providerGroup}><AppText variant="caption" muted style={styles.providerCategory}>{group.category === 'stream' ? 'Stream' : group.category === 'rent' ? 'Rent' : 'Buy'}</AppText><View style={styles.providerRow}>{group.providers.map((provider) => <View key={provider.id} style={styles.provider} accessibilityRole="image" accessibilityLabel={provider.name}>{provider.logoUrl ? <Image source={{ uri: provider.logoUrl }} style={styles.providerLogo} resizeMode="cover" /> : <AppText variant="caption">{provider.name.slice(0, 2).toUpperCase()}</AppText>}</View>)}</View></View>)}</View> : null}
      {episodic ? <View style={styles.section}><AppText variant="heading3" style={styles.seasonHeading}>Seasons & episodes</AppText>
        <SeasonsSection media={media} progress={progress} initialSeasonNumber={routeSeason} />
      </View> : null}
      {media.studios?.length ? <View style={styles.section}><AppText variant="heading3">Studios</AppText><AppText variant="bodySmall" muted style={styles.overview}>{media.studios.join(' · ')}</AppText></View> : null}
    </FadeInView>
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  scroll: { paddingBottom: spacing['2xl'] },
  hero: { marginHorizontal: -spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing['3xl'], justifyContent: 'space-between', overflow: 'hidden', backgroundColor: colors.surface },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  heroTopActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroAction: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,12,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' },
  pressed: { opacity: 0.78 },
  playButton: { position: 'absolute', top: '40%', left: '50%', marginLeft: -30, width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(10,10,12,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)', alignItems: 'center', justifyContent: 'center' },
  playPressed: { opacity: 0.8 },
  heroBottom: { gap: spacing.sm },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: 'rgba(8,6,14,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: colors.white, fontWeight: '600' },
  heroMeta: { flexShrink: 1 },
  heroTitle: { color: colors.white, fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.1 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  scorePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(8,6,14,0.62)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  scoreText: { color: colors.white, fontWeight: '700' },
  agePill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', backgroundColor: 'rgba(8,6,14,0.50)' },
  ageText: { color: colors.white, fontSize: 10.5, lineHeight: 13, fontWeight: '700' },
  streamingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  streamingText: { flexShrink: 1 },
  body: { marginTop: -spacing.xl, gap: spacing.lg },
  actionCard: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  ratingCard: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  ratingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  ratingCopy: { gap: 2 },
  ratingKicker: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 1.6 },
  clearRating: { color: colors.accent, fontWeight: '700' },
  ratingStars: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genreChip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  genreText: { color: colors.textPrimary, fontWeight: '600' },
  messageCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.medium, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  messageText: { flex: 1 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  infoCell: { flexBasis: '47%', flexGrow: 1, gap: 3, backgroundColor: colors.surface, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  infoLabel: { letterSpacing: 0.4 },
  infoValue: { color: colors.white },
  progressCard: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  progressKicker: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 1.6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  progressNext: { marginTop: 2 },
  overviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  overviewPoster: { width: 96, height: 144, borderRadius: radius.medium, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  overviewCopy: { flex: 1, gap: spacing.xs },
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
