import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { AppError } from '@/domain/errors/AppError';
import { LIBRARY_BACKUP_FORMAT, LIBRARY_BACKUP_VERSION, watchStateRepository, type LibraryBackup } from '@/data/local/repositories/SqliteWatchStateRepository';
import { queryClient } from '@/lib/query/queryClient';
import { scheduleAutoSync } from '@/features/sync/autoSync';

function backupFileName(now = new Date()): string {
  return `watch-later-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** A real library backup is tiny; refuse oversized files before parsing them. */
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

async function readBackupText(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists && typeof info.size === 'number' && info.size > MAX_BACKUP_BYTES) {
    throw new AppError('validation', 'That backup file is too large to import.');
  }
  const raw = await FileSystem.readAsStringAsync(uri);
  if (raw.length > MAX_BACKUP_BYTES) {
    throw new AppError('validation', 'That backup file is too large to import.');
  }
  return raw;
}

function parseBackupFile(raw: string): LibraryBackup {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('validation', 'That file could not be read. Pick the .json backup file you exported from Watch Later.');
  }
  const backup = parsed as Partial<LibraryBackup>;
  if (!backup || backup.format !== LIBRARY_BACKUP_FORMAT || backup.version !== LIBRARY_BACKUP_VERSION || typeof backup.tables !== 'object' || !backup.tables) {
    throw new AppError('validation', 'This file is not a Watch Later backup.');
  }
  return backup as LibraryBackup;
}

/**
 * Writes the whole on-device library to a dated JSON file and opens the
 * share sheet so it can be saved outside the app (Files, Drive, email to
 * self). Reinstalling wipes app data, so this file is the way back.
 */
export async function exportLibraryBackup(): Promise<string> {
  const backup = await watchStateRepository.exportLibrary();
  const name = backupFileName();
  const uri = `${FileSystem.cacheDirectory ?? ''}${name}`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup));
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError(
      'configuration',
      'Sharing isn’t available on this device, but the backup was written to the app cache. Copy it out before reinstalling — the cache is wiped with the app.',
    );
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save your Watch Later backup' });
  return name;
}

export interface PickedBackup {
  uri: string;
  titles: number;
  exportedAt: string;
}

/** Lets the user pick a previously exported file. Returns null when cancelled. */
export async function pickBackupFile(): Promise<PickedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  const cancelled = 'canceled' in result ? result.canceled : (result as { type?: string }).type === 'cancel';
  const assetUri = 'assets' in result ? result.assets?.[0]?.uri : (result as { uri?: string }).uri;
  if (cancelled || !assetUri) return null;
  const backup = parseBackupFile(await readBackupText(assetUri));
  const tables = backup.tables.tracked_media;
  return { uri: assetUri, titles: Array.isArray(tables) ? tables.length : 0, exportedAt: backup.exportedAt };
}

/**
 * Replaces every local title, state, list and rating with the backup's,
 * then refreshes the UI. The backup file itself is never modified.
 */
export async function restoreLibraryBackup(uri: string): Promise<{ titles: number }> {
  const backup = parseBackupFile(await readBackupText(uri));
  const result = await watchStateRepository.importLibrary(backup);
  await queryClient.invalidateQueries();
  // The repository queues the restored rows; upload them for signed-in users.
  scheduleAutoSync('mutation');
  return result;
}
