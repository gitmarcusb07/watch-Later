import { mapTmdbMovie } from '@/data/remote/tmdb/mappers';
import { buildShareMessage } from '@/features/share/shareMessage';

const matrix = mapTmdbMovie({
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-31',
  overview: 'A computer hacker learns the truth about his reality.',
  genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Sci-Fi' }],
});

describe('buildShareMessage', () => {
  it('includes the banner title, details, deep link and download link', () => {
    const message = buildShareMessage(matrix, 'Movie', 8.7, 'https://example.com/app');
    expect(message).toContain('The Matrix (1999)');
    expect(message).toContain('Movie · 8.7/10');
    expect(message).toContain('Genres: Action, Sci-Fi');
    expect(message).toContain('A computer hacker learns the truth about his reality.');
    expect(message).toContain('Shared from Watch Later');
    expect(message).toContain('Open in Watch Later: watchlater://media/tmdb%3Amovie%3A603');
    expect(message).toContain('Get Watch Later for Android: https://example.com/app');
  });

  it('leaves out the download line when no public URL is configured', () => {
    const message = buildShareMessage(matrix, 'Movie', undefined, '');
    expect(message).not.toContain('Get Watch Later');
    expect(message).toContain('The Matrix (1999)');
  });
});
