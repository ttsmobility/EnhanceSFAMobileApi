import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, rename, rm } from 'fs/promises';
import path from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { env } from '../../../../config/env';
import { sanitizeFileName } from '../../../../shared/utils/commonUtils';

/** Stores the raw backup; .mp3 is the legacy SQLite backup extension, not audio. */
export async function saveMobileBackup(
  file: Readable & { truncated?: boolean },
  originalName: string,
  categoryId: unknown
): Promise<void> {
  // Both Android paths and Windows paths must resolve to a filename only.
  const filename = sanitizeFileName(path.win32.basename(path.posix.basename(originalName)));
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('Invalid backup filename');
  }

  const category = categoryId === '1' ? 'sfaind'
    : categoryId === '2' ? 'tab_db_safat'
      : categoryId === '3' ? 'tab_db_gtrc' : 'tab_db_other';
  const today = new Date();
  const dateFolder = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const directory = path.resolve(env.BACKUP_UPLOAD_DIR, category, dateFolder);
  await mkdir(directory, { recursive: true });

  // Publish only a complete file, so an interrupted retry cannot corrupt a backup.
  const temporaryPath = path.join(directory, `.${randomUUID()}.part`);
  try {
    await pipeline(file, createWriteStream(temporaryPath, { flags: 'wx' }));
    if (file.truncated) {
      throw new Error('Backup exceeds BACKUP_UPLOAD_MAX_BYTES');
    }
    await rename(temporaryPath, path.join(directory, filename));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
