import { Image, type ImageProps } from 'expo-image';

interface RemoteImageProps extends Omit<ImageProps, 'source'> {
  /** Remote URL. Nothing is rendered when it is missing. */
  uri?: string;
}

/**
 * Shared remote-image renderer for posters and episode art.
 *
 * The platform Image component can leave already-scrolled posters blank after
 * a long session when its in-memory cache is reclaimed. expo-image keeps a
 * disk cache as well, so revisiting a shelf or opening a franchise reuses the
 * exact bytes that were already painted instead of downloading them again.
 */
export function RemoteImage({ uri, contentFit = 'cover', cachePolicy = 'memory-disk', transition = 120, recyclingKey, ...rest }: RemoteImageProps) {
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      recyclingKey={recyclingKey ?? uri}
      {...rest}
    />
  );
}
