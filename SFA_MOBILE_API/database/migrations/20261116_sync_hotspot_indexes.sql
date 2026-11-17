-- Select the intended SFA database before running this one-time migration.
-- Based on sync-hotspots-2026-11-16T12-47-17-185Z.json: these four index
-- prefixes were absent, and EXPLAIN showed full scans for these filters.
-- Recheck deployed indexes before applying if the schema has since changed.
-- Run outside a load test. Index creation consumes I/O and disk and may wait
-- for metadata locks. No existing indexes, columns, or business rows are removed.
-- Explicit INPLACE/NONE makes unsupported online DDL fail instead of silently
-- switching to a blocking table-copy operation. Statements commit independently.

SELECT DATABASE() AS target_database;

ALTER TABLE customermaster
  ADD INDEX idx_sync_template_active (templateindicator, activecustomer),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE invoiceheader
  ADD INDEX idx_sync_invoice_route (routecode, dexflag, invoicenumber, documentnumber),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE arheader
  ADD INDEX idx_sync_ar_route (routecode, invoicenumber, documentnumber),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE salesorderheader
  ADD INDEX idx_sync_order_route (routecode, invoicenumber, documentnumber),
  ALGORITHM=INPLACE, LOCK=NONE;
