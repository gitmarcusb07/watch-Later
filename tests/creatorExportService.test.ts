import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { AppError } from '@/domain/errors/AppError';
import { saveImagesToGallery, shareImage } from '@/features/creator/exportService';

jest.mock('expo-media-library', () => ({
  __esModule: true,
  requestPermissionsAsync: jest.fn(),
  Asset: { create: jest.fn() },
}));

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const requestPermissions = MediaLibrary.requestPermissionsAsync as jest.Mock;
const createAsset = MediaLibrary.Asset.create as jest.Mock;
const isAvailable = Sharing.isAvailableAsync as jest.Mock;
const shareAsync = Sharing.shareAsync as jest.Mock;

describe('creator export service', () => {
  it('saves every rendered slide once permission is granted', async () => {
    requestPermissions.mockResolvedValue({ granted: true });
    createAsset.mockResolvedValue({});
    const result = await saveImagesToGallery(['file:///a.png', 'file:///b.png']);
    expect(result).toEqual({ status: 'saved', count: 2 });
    expect(createAsset.mock.calls.map(([uri]) => uri)).toEqual(['file:///a.png', 'file:///b.png']);
  });

  it('reports permission-denied without touching the gallery', async () => {
    requestPermissions.mockResolvedValue({ granted: false });
    const result = await saveImagesToGallery(['file:///a.png']);
    expect(result).toEqual({ status: 'permission-denied' });
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('reports failure when a gallery write throws', async () => {
    requestPermissions.mockResolvedValue({ granted: true });
    createAsset.mockRejectedValue(new Error('disk full'));
    expect(await saveImagesToGallery(['file:///a.png'])).toEqual({ status: 'failed' });
  });

  it('fails fast for an empty plan and never asks for permission', async () => {
    expect(await saveImagesToGallery([])).toEqual({ status: 'failed' });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('returns false when the platform cannot share', async () => {
    isAvailable.mockResolvedValue(false);
    expect(await shareImage('file:///a.png', 'Share your post')).toBe(false);
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it('opens the share sheet with the PNG', async () => {
    isAvailable.mockResolvedValue(true);
    shareAsync.mockResolvedValue(undefined);
    expect(await shareImage('file:///a.png', 'Share your first slide')).toBe(true);
    expect(shareAsync).toHaveBeenCalledWith('file:///a.png', expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('wraps share failures in a friendly AppError', async () => {
    isAvailable.mockResolvedValue(true);
    shareAsync.mockRejectedValue(new Error('no activity'));
    await expect(shareImage('file:///a.png', 'Share')).rejects.toBeInstanceOf(AppError);
  });
});
