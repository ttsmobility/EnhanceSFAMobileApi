import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../../../config/env';
import { saveMobileBackup } from '../services/upload.service';

/** Returns the original PHP text contract, including its spelling and HTTP status. */
export async function uploadBackup(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    if (!request.isMultipart()) {
      await reply.type('text/plain').send('fail');
      return;
    }

    const file = await request.file({
      limits: { files: 1, fileSize: env.BACKUP_UPLOAD_MAX_BYTES }
    });

    if (!file || file.fieldname !== 'uploaded_file') {
      file?.file.resume();
      await reply.type('text/plain').send('fail');
      return;
    }

    const query = request.query as Record<string, unknown>;
    await saveMobileBackup(file.file, file.filename, query.id);
    await reply.type('text/plain').send('sucess');
  } catch (error) {
    request.log.error({ err: error }, 'Mobile database backup upload failed');
    await reply.type('text/plain').send('fail');
  }
}
