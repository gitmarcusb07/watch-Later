import type { WatchPriority } from '@/domain/models/watchState';

export const PRIORITY_ORDER: WatchPriority[] = ['asap', 'weekend', 'someday'];

export const PRIORITY_META: Record<WatchPriority, { label: string; description: string; icon: string; color: string }> = {
  asap: { label: 'ASAP', description: 'Watch as soon as you can', icon: 'rocket-outline', color: '#FF8A4C' },
  weekend: { label: 'Weekend', description: 'Save for your next free weekend', icon: 'cafe-outline', color: '#F5C66E' },
  someday: { label: 'Someday', description: 'No rush — get to it when you can', icon: 'cloud-outline', color: '#7AC7E3' },
};

export function isWatchPriority(value: unknown): value is WatchPriority {
  return value === 'asap' || value === 'weekend' || value === 'someday';
}

export function priorityLabel(priority: WatchPriority | null | undefined): string {
  if (!priority) return 'Saved';
  return PRIORITY_META[priority].label;
}
