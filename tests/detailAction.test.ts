import { getDetailPrimaryAction } from '@/features/watchState/detailAction';
import { ACTION_PALETTES } from '@/theme/actionPalette';

describe('detail primary action', () => {
  it('shows Watching for a partially watched series instead of offering Mark as Watched again', () => {
    expect(getDetailPrimaryAction({
      mediaType: 'series',
      upcoming: false,
      watched: false,
      tracking: true,
    })).toEqual({
      label: 'Watching',
      icon: 'play-circle',
      tone: 'watching',
      motion: 'pulse',
      active: false,
      clearsProgress: true,
    });
  });

  it('shows Watched only once the whole series is complete', () => {
    expect(getDetailPrimaryAction({
      mediaType: 'series',
      upcoming: false,
      watched: true,
      tracking: false,
    })).toMatchObject({ label: 'Watched', icon: 'eye', tone: 'watched', motion: 'bounce', active: true, clearsProgress: false });
  });

  it('keeps Mark as Watched for an unstarted title and for movies', () => {
    expect(getDetailPrimaryAction({
      mediaType: 'series',
      upcoming: false,
      watched: false,
      tracking: false,
    })).toMatchObject({ label: 'Mark as Watched', icon: 'eye-outline', tone: 'mark-watched', motion: 'pop', active: false });
    expect(getDetailPrimaryAction({
      mediaType: 'movie',
      upcoming: false,
      watched: false,
      tracking: false,
    })).toMatchObject({ label: 'Mark as Watched', icon: 'eye-outline', tone: 'mark-watched', motion: 'pop', active: false });
  });

  it('locks the action for an unreleased title', () => {
    expect(getDetailPrimaryAction({
      mediaType: 'movie',
      upcoming: true,
      releaseLabel: '12 Nov 2026',
      watched: false,
      tracking: false,
    })).toEqual({
      label: 'Coming 12 Nov 2026',
      icon: 'calendar-outline',
      tone: 'upcoming',
      motion: 'wobble',
      active: false,
      clearsProgress: false,
    });
  });

  it('gives every library action its own accent colour and motion', () => {
    const tones = ['mark-watched', 'watching', 'watched', 'upcoming', 'asap', 'weekend', 'someday', 'favorite'] as const;
    expect(new Set(tones.map((tone) => ACTION_PALETTES[tone].color)).size).toBe(tones.length);
    expect(ACTION_PALETTES.asap.motion).toBe('launch');
    expect(ACTION_PALETTES.weekend.motion).toBe('bounce');
    expect(ACTION_PALETTES.someday.motion).toBe('float');
    expect(ACTION_PALETTES.favorite.motion).toBe('heartbeat');
  });
});
