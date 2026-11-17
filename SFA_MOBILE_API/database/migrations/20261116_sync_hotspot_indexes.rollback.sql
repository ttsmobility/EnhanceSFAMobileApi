-- Run only to remove indexes successfully created by the matching forward migration.
-- Select the same SFA database. If the forward migration was only partly applied,
-- run only the DROP statements for indexes it actually created.

ALTER TABLE salesorderheader DROP INDEX idx_sync_order_route, ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE arheader DROP INDEX idx_sync_ar_route, ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE invoiceheader DROP INDEX idx_sync_invoice_route, ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE customermaster DROP INDEX idx_sync_template_active, ALGORITHM=INPLACE, LOCK=NONE;
