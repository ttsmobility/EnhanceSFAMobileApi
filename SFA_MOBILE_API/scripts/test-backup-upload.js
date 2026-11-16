// Run after npm run build. Uses Fastify injection and temporary storage; no DB calls.
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sfa-backup-upload-'));
  process.env.BACKUP_UPLOAD_DIR = root;
  process.env.BACKUP_UPLOAD_MAX_BYTES = String(12 * 1024 * 1024);
  process.env.FILE_LOG_ENABLED = 'false';
  process.env.LOG_LEVEL = 'silent';
  const { buildApp } = require('../dist/app');
  const { mysqlPool } = require('../dist/shared/db/mysqlPool');
  const app = await buildApp();
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  async function upload(id, filename, data, field = 'uploaded_file') {
    const boundary = 'sfa-native-backup-boundary';
    // Match DBHelper: unquoted field/filename and no per-file Content-Type header.
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name=${field};filename=${filename}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    return app.inject({
      method: 'POST',
      url: `/upload/upload.php${id === undefined ? '' : `?id=${id}`}`,
      headers: { 'content-type': `multipart/form-data;boundary=${boundary}` },
      payload
    });
  }

  try {
    const bytes = Buffer.from([0, 1, 255, 13, 10, 0, 128]);
    for (const [id, folder] of [['1', 'sfaind'], ['2', 'tab_db_safat'], ['3', 'tab_db_gtrc'], ['99', 'tab_db_other'], [undefined, 'tab_db_other']]) {
      const result = await upload(id, '/mnt/sdcard/download/1818_123.mp3', bytes);
      assert.equal(result.statusCode, 200);
      assert.equal(result.body, 'sucess');
      assert.deepEqual(await fs.readFile(path.join(root, folder, day, '1818_123.mp3')), bytes);
    }

    const replacement = Buffer.from('replacement database');
    assert.equal((await upload('1', '1818_123.mp3', replacement)).body, 'sucess');
    assert.deepEqual(await fs.readFile(path.join(root, 'sfaind', day, '1818_123.mp3')), replacement);

    // Backups must not inherit the separate image endpoint's 10 MiB limit.
    const large = Buffer.alloc(10 * 1024 * 1024 + 1, 17);
    assert.equal((await upload('1', 'large.mp3', large)).body, 'sucess');
    assert.equal((await fs.stat(path.join(root, 'sfaind', day, 'large.mp3'))).size, large.length);

    assert.equal((await upload('1', 'too-large.mp3', Buffer.alloc(12 * 1024 * 1024 + 1))).body, 'fail');
    await assert.rejects(fs.access(path.join(root, 'sfaind', day, 'too-large.mp3')));
    assert.equal((await upload('1', 'wrong-field.mp3', bytes, 'file')).body, 'fail');
    await assert.rejects(fs.access(path.join(root, 'sfaind', day, 'wrong-field.mp3')));
    assert.equal((await app.inject({ method: 'POST', url: '/upload/upload.php?id=1', payload: {} })).body, 'fail');
    assert.equal((await upload('1', '../../safe.mp3', bytes)).body, 'sucess');
    assert.deepEqual(await fs.readFile(path.join(root, 'sfaind', day, 'safe.mp3')), bytes);
    assert.ok(!(await fs.readdir(path.join(root, 'sfaind', day))).some(name => name.endsWith('.part')));
    console.log('Backup upload checks passed: native multipart, all categories, binary integrity, overwrite, >10 MiB, size limit, invalid input, path handling, temporary cleanup.');
  } finally {
    await app.close();
    await mysqlPool.end();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
