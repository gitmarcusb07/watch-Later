import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/common/AppText';
import { RemoteImage } from '@/components/common/RemoteImage';
import type { MediaEpisode } from '@/domain/models/media';
import { hasAired } from '@/features/catalog/upcoming';
import { colors, radius, spacing } from '@/theme';

export { hasAired };

export function SeasonSelector({ season, onPress }: { season: string; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Select ${season}`} onPress={onPress} style={styles.season}><AppText variant="heading3">{season}</AppText><Ionicons name="chevron-down" size={18} color={colors.textSecondary} /></Pressable>;
}

export function EpisodeList({ episodes = [], watchedIds = [], onToggleEpisode, onUpToHere, disabled = false }: { episodes?: MediaEpisode[]; watchedIds?: string[]; onToggleEpisode?: (episode: MediaEpisode, watched: boolean) => void; onUpToHere?: (episode: MediaEpisode) => void; disabled?: boolean }) {
  return (
    <View>
      {episodes.map((episode) => {
        const complete = watchedIds.includes(episode.providerId);
        const locked = !hasAired(episode.airDate);
        const toggleable = !disabled && Boolean(onToggleEpisode) && !locked;
        const metadata = [
          locked ? `Out ${episode.airDate ?? 'soon'}` : episode.airDate,
          episode.runtimeMinutes ? `${episode.runtimeMinutes} min` : undefined,
        ].filter(Boolean).join(' · ');
        const label = `${episode.title || `Episode ${episode.episodeNumber}`}, Season ${episode.seasonNumber} Episode ${episode.episodeNumber}`;
        const hint = locked
          ? `Not released yet — comes out ${episode.airDate ?? 'later'}. It becomes tappable once it airs.`
          : complete
            ? 'Activating marks this episode unwatched. Long press to mark everything up to here.'
            : 'Activating marks this episode watched. Long press to mark everything up to here.';
        return (
          <Pressable
            key={episode.providerId}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ checked: complete, disabled: !toggleable }}
            disabled={!toggleable}
            onPress={() => onToggleEpisode?.(episode, !complete)}
            onLongPress={toggleable && onUpToHere ? () => onUpToHere(episode) : undefined}
            style={({ pressed }) => [styles.episode, locked && styles.episodeLocked, pressed && toggleable && styles.pressed]}
          >
            <View style={[styles.number, complete && styles.numberWatched]}>
              <AppText variant="caption" color={complete ? colors.background : colors.textSecondary}>{episode.episodeNumber}</AppText>
            </View>
            {episode.stillUrl ? <RemoteImage uri={episode.stillUrl} style={styles.still} /> : null}
            <View style={styles.copy}>
              <AppText variant="bodyMedium" color={locked ? colors.textSecondary : colors.textPrimary}>{episode.title || `Episode ${episode.episodeNumber}`}</AppText>
              {metadata ? <AppText variant="caption" muted>{metadata}</AppText> : null}
              {episode.overview ? <AppText variant="caption" muted numberOfLines={2}>{episode.overview}</AppText> : null}
            </View>
            <Ionicons name={locked ? 'lock-closed-outline' : complete ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={locked || !complete ? colors.textMuted : colors.success} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ season: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, padding: spacing.lg, marginBottom: spacing.sm }, episode: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, episodeLocked: { opacity: 0.55 }, number: { width: 34, height: 34, borderRadius: radius.small, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }, numberWatched: { backgroundColor: colors.success }, still: { width: 74, height: 48, borderRadius: radius.small, backgroundColor: colors.surfaceElevated }, copy: { flex: 1, gap: 2 }, pressed: { opacity: 0.78 } });
