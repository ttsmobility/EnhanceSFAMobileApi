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

## Sync performance diagnostics

### Promotion product-group optimization

The optional product-group path resolves eligible route promotions once and
retrieves the matching groups with indexed key lookups. It preserves the legacy
header qualification restriction and the unrestricted assignment branch. All
columns and response section names are retained. The original SQL remains the
default until the target database comparison has passed:

```dotenv
SYNC_PRODUCT_GROUP_OPTIMIZATION_ENABLED=false
```

Build, then run a read-only comparison against the `.env` database:

```bash
npm run build
node scripts/compare-product-group-performance.js --routes 1818,1819,1820 --repeats 3 --explain
```

The script uses a repeatable-read, read-only transaction per route, compares every
returned column/value including duplicate counts, and alternates execution order
between rounds. Row order is ignored because neither implementation specifies an
order. It writes timings, hashes and optional execution plans to
`performance-results/product-groups-*.json`. `--explain` performs additional SELECT
queries to capture plans; it does not alter data or indexes. It requires access to
the configured MySQL database and should run outside an active load test.

If results match and timings improve, enable
`SYNC_PRODUCT_GROUP_OPTIMIZATION_ENABLED=true`, restart the API and compare full
sync responses and load-test results. A false value restores the original SQL.
No production speed improvement is assumed until measured on the target server.

To identify individual master-data queries, temporarily enable:

```dotenv
SYNC_QUERY_TIMING_ENABLED=true
LOG_LEVEL=info
```

After building and restarting, run a few routes with `--concurrency 1` and capture
`sync.masterdata.queries` from server console output. The log includes query count,
per-query elapsed milliseconds, row counts, table names, and the ten slowest SQL
statements. Bind values and response rows are not logged.

This diagnostic mode runs master-data loaders sequentially on the existing
transaction connection. Otherwise, timings around `Promise.all` on one mysql2
connection would include time waiting behind other queries. Each query duration
still includes driver preparation, network transfer, result decoding, and any
database lock wait; it is not pure MySQL execution time. Use execution plans or
database-side query timing to distinguish those costs. Query result contracts and
SQL are unchanged. Set `SYNC_QUERY_TIMING_ENABLED=false` and restart after profiling
to restore normal scheduling before comparing load-test results.

At `LOG_LEVEL=info` (or `debug`), master sync emits a structured server log with
`event: "sync.performance"`, the route ID, and `databaseCompleted`.
The API response is unchanged. Timing fields are milliseconds:

| Field | Measurement |
| --- | --- |
| `connectionWaitMs` | Time acquiring a MySQL connection, including pool wait/setup |
| `settingsMs` | Settings queries, route updates, and sequence maintenance |
| `masterDataMs` | Customer, item, pricing, promotion, and other master reads |
| `transactionDownloadMs` | Inventory, orders, FOC, deletion instructions, and other download reads |
| `responseBuildMs` | Response formatting and sync counts, excluding JSON serialization |
| `beginMs`, `commitMs`, `rollbackMs` | Transaction control operations (`rollbackMs` on failure) |
| `transactionWorkMs` | All work inside the transaction handler |
| `connectionHeldMs` | Time holding the connection through commit/rollback and release |
| `databaseTotalMs` | Connection acquisition plus transaction lifetime |

Section timings are included in `transactionWorkMs`, which is included in
`connectionHeldMs` and `databaseTotalMs`; do not sum every field. Failed operations
also record their elapsed time. `databaseCompleted: true` means the transaction
committed; it does not confirm that a disconnected handset received the response.
Use the existing `request completed` log's `responseTime` for overall request time.

After deployment, run a baseline and then increase concurrency:

```bash
node scripts/benchmark-sync-routes.js --concurrency 1
node scripts/benchmark-sync-routes.js --concurrency 5
node scripts/benchmark-sync-routes.js --concurrency 10
```

High connection wait points to pool queuing/connection setup. High section times
identify where to inspect query plans and lock waits. Save benchmark CSV/JSON and
the corresponding server logs for comparison. A client timeout does not necessarily
cancel server-side database work, so allow the previous workload to finish first.

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
