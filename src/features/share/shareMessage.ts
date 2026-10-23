import type { CatalogMedia } from '@/domain/models/media';
import { mediaRouteId } from '@/features/catalog/mediaIdentity';

export const APP_DEEP_LINK_PREFIX = 'watchlater://media/';

/**
 * Public download page for the Android build. Set it in `.env` so a new build
 * can point at its own upload without touching source.
 */
export const APP_DOWNLOAD_URL = process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL ?? '';

/** Human-readable share copy: details first, then real links into the app. */
export function buildShareMessage(
  media: CatalogMedia,
  kindLabel: string,
  score?: number,
  downloadUrl: string = APP_DOWNLOAD_URL,
): string {
  const titleLine = `${media.title}${media.year ? ` (${media.year})` : ''}`;
  const meta = [kindLabel, typeof score === 'number' ? `${score.toFixed(1)}/10` : undefined].filter(Boolean).join(' · ');
  const genres = media.genres.map((genre) => genre.name).filter(Boolean).slice(0, 4).join(', ');
  const overview = media.overview?.trim();
  const link = `${APP_DEEP_LINK_PREFIX}${encodeURIComponent(mediaRouteId(media))}`;
  return [
    titleLine,
    meta,
    genres ? `Genres: ${genres}` : undefined,
    overview ? overview.length > 320 ? `${overview.slice(0, 317)}…` : overview : undefined,
    'Shared from Watch Later',
    `Open in Watch Later: ${link}`,
    downloadUrl ? `Get Watch Later for Android: ${downloadUrl}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}
