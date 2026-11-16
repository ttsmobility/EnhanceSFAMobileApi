import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env';
import { uploadBackup } from './controllers/upload.controller';

/** Keeps the standalone PHP upload URL used by the native mobile DBHelper. */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/upload/upload.php', {
    bodyLimit: env.BACKUP_UPLOAD_MAX_BYTES + 1024 * 1024
  }, uploadBackup);
}
