import * as FileSystem from 'expo-file-system/legacy';
import Share from 'react-native-share';
import { mapTmdbMovie } from '@/data/remote/tmdb/mappers';
import { shareMedia } from '@/features/share/shareMedia';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  downloadAsync: jest.fn(),
}));

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn() },
}));

const matrix = mapTmdbMovie({
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-31',
  overview: 'A computer hacker learns the truth about his reality.',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  genres: [{ id: 28, name: 'Action' }],
});

describe('shareMedia', () => {
  it('downloads and attaches the poster before sharing the details', async () => {
    const getInfo = FileSystem.getInfoAsync as jest.Mock;
    const download = FileSystem.downloadAsync as jest.Mock;
    const open = Share.open as jest.Mock;
    getInfo
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, size: 5000 });
    download.mockResolvedValue({ status: 200, uri: 'file:///cache/poster.jpg' });
    open.mockResolvedValue({ success: true });

    await shareMedia(matrix, 'Movie', 8.7);

    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0]).toBe(matrix.posterUrl);
    expect(download.mock.calls[0][0]).not.toBe(matrix.backdropUrl);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Shared from Watch Later'),
      type: 'image/jpeg',
      filename: expect.stringContaining('watchlater-tmdb-movie-603-'),
    }));
  });
});
