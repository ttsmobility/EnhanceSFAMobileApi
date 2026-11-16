# SFA Mobile API

Node.js TypeScript API for migrating the current Zend Framework mobile API.

## Rules

- Keep the PhoneGap mobile app unchanged.
- Keep existing endpoint paths and response shapes.
- Do not call MySQL stored procedures.
- Replace procedure behavior with TypeScript services and repositories.

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```

## First Endpoint

```text
GET /health
```

## Mobile database backup upload

The native app's `DBHelper.java` posts database backups to
`POST /upload/upload.php?id=1` using multipart field `uploaded_file`.
The `.mp3` filename is a legacy name for a SQLite database backup. This endpoint
stores the raw file; it does not import its transactions into MySQL.

Responses preserve the PHP contract: HTTP 200 with plain text `sucess` on success
or `fail` on upload failure. `/api/image/upload` remains the separate image API.

Configure `.env`:

```dotenv
BACKUP_UPLOAD_DIR=./upload
BACKUP_UPLOAD_MAX_BYTES=52428800
```

Files are saved under `<BACKUP_UPLOAD_DIR>/<category>/<YYYYMMDD>/<filename>`.
The date uses the server's local timezone, as the PHP implementation did.
Categories are `sfaind` for id 1, `tab_db_safat` for id 2, `tab_db_gtrc` for id 3,
and `tab_db_other` for other/missing ids. Set an absolute storage root in production
if backups should be kept outside the application directory. This replaces the
PHP script's hardcoded drive-relative `D:sfaind` location with configurable storage.

The app hardcodes `https://routepro.enhance-group.com/upload/upload.php?id=1`.
To keep the mobile app unchanged, configure that server's reverse proxy to forward
`/upload/upload.php` (including its query string and multipart body) to Node. Allow
the configured upload size at the proxy too. Updating the mobile API base URL alone
does not change this backup destination.

Verify without a database connection:

```bash
npm run typecheck
npm run build
node scripts/test-backup-upload.js
```
