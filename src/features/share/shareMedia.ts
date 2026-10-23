import { Share as NativeShare } from 'react-native';
import Share from 'react-native-share';
import * as FileSystem from 'expo-file-system/legacy';
import type { CatalogMedia } from '@/domain/models/media';
import { buildShareMessage } from '@/features/share/shareMessage';

function safeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/** Small stable suffix so a cached backdrop can never win over a new poster. */
function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function imageExtension(url: string): 'jpg' | 'png' | 'webp' {
  const match = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(url);
  const value = match?.[1]?.toLowerCase();
  if (value === 'png') return 'png';
  if (value === 'webp') return 'webp';
  return 'jpg';
}

function mimeType(extension: 'jpg' | 'png' | 'webp'): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

interface PreparedImage {
  uri: string;
  type: string;
  filename: string;
}

/**
 * Downloads a remote poster to the cache. The filename is keyed by the URL,
 * not just the title, so a previous build that cached a backdrop can never be
 * reused for a poster share.
 */
async function prepareImage(media: CatalogMedia, imageUrl: string): Promise<PreparedImage | undefined> {
  const extension = imageExtension(imageUrl);
  const filename = `watchlater-${safeFileName(media.id)}-${shortHash(imageUrl)}.${extension}`;
  const target = `${FileSystem.cacheDirectory}${filename}`;
  try {
    const existing = await FileSystem.getInfoAsync(target);
    const cached = existing.exists && (existing.size ?? 0) > 1024;
    if (!cached) {
      const result = await FileSystem.downloadAsync(imageUrl, target);
      if (result.status < 200 || result.status >= 300) return undefined;
      const downloaded = await FileSystem.getInfoAsync(target);
      if (!downloaded.exists || (downloaded.size ?? 0) <= 1024) return undefined;
    }
    return { uri: target, type: mimeType(extension), filename };
  } catch {
    return undefined;
  }
}

/**
 * Share the title's poster and details in one sheet. Android's built-in
 * `Share` API cannot attach an image, so react-native-share handles the
 * ACTION_SEND intent (image + caption). Posters are preferred over backdrops;
 * the backdrop is only a last-resort image fallback. If neither can be
 * downloaded the details still share as plain text instead of failing.
 */
export async function shareMedia(media: CatalogMedia, kindLabel: string, score?: number): Promise<void> {
  const message = buildShareMessage(media, kindLabel, score);
  const title = media.title;
  const candidates = [media.posterUrl, media.backdropUrl].filter((url): url is string => Boolean(url));

  for (const imageUrl of candidates) {
    const image = await prepareImage(media, imageUrl);
    if (!image) continue;
    try {
      await Share.open({
        title,
        subject: title,
        message,
        url: image.uri,
        type: image.type,
        filename: image.filename,
        failOnCancel: false,
      });
      return;
    } catch {
      // No compatible share target or the provider rejected the file. Fall
      // through to the plain-text sheet rather than making the tap fail.
      break;
    }
  }

  await NativeShare.share({ title, message });
}
