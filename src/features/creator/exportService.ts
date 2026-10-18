import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { AppError } from '@/domain/errors/AppError';

/**
 * On-device export services. Poster-quality PNGs are produced locally by
 * react-native-view-shot; this module only saves to the gallery (with the
 * permission requested at the moment of the action) and hands files to the
 * system share sheet. No image ever leaves the device through this app.
 */

export type SaveToGalleryResult =
  | { status: 'saved'; count: number }
  | { status: 'permission-denied' }
  | { status: 'failed' };

/**
 * Saves PNG files to the device gallery. The media-library permission is
 * requested here — at export time — never on app start or screen mount.
 */
export async function saveImagesToGallery(uris: string[]): Promise<SaveToGalleryResult> {
  if (!uris.length) return { status: 'failed' };
  try {
    // writeOnly + photo scope: enough to insert into the gallery, no read access.
    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) return { status: 'permission-denied' };
    for (const uri of uris) {
      await MediaLibrary.Asset.create(uri);
    }
    return { status: 'saved', count: uris.length };
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Opens the system share sheet for one PNG (Instagram, Drive, chat apps…).
 * Returns false when sharing is unavailable on this device; throws AppError
 * when the sheet itself fails so callers show one friendly prompt.
 */
export async function shareImage(uri: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
    return true;
  } catch (cause) {
    throw new AppError('unknown', 'Sharing didn’t open. Your image is safe — try saving it to the gallery instead.', { cause });
  }
}
