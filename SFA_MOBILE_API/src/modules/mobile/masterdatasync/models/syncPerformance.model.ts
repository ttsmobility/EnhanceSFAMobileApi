import type { PoolConnection } from 'mysql2/promise';
import { buildInClause } from '../../../../shared/utils/commonUtils';
import type { GenericRow } from '../../../../shared/utils/commonUtils';

/** Opens a stable read-only snapshot; diagnostics must never invoke settings writes. */
export async function beginSyncPerformanceComparison(connection: PoolConnection) {
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.beginTransaction();
}

/** Index candidates for review, not automatic schema changes. Existing prefixes are detected. */
export async function getSyncIndexReview(connection: PoolConnection) {
  const candidates = [
    { table: 'customermaster', name: 'idx_sync_template_active', columns: ['templateindicator', 'activecustomer'] },
    { table: 'invoiceheader', name: 'idx_sync_invoice_route', columns: ['routecode', 'dexflag', 'invoicenumber', 'documentnumber'] },
    { table: 'arheader', name: 'idx_sync_ar_route', columns: ['routecode', 'invoicenumber', 'documentnumber'] },
    { table: 'salesorderheader', name: 'idx_sync_order_route', columns: ['routecode', 'invoicenumber', 'documentnumber'] },
    { table: 'inventorytransactionheader', name: 'idx_sync_inventory_route_doc', columns: ['routecode', 'documentnumber'] },
    { table: 'startendday', name: 'idx_sync_closed_route', columns: ['routecode', 'routeclosed', 'routekey'] },
    { table: 'startendday', name: 'idx_sync_route_key', columns: ['routecode', 'routekey'] },
    { table: 'startingloaddetail', name: 'idx_sync_pending_load', columns: ['routecode', 'status', 'ddate', 'totunits'] },
    { table: 'inventorytransactiondetail', name: 'idx_sync_inventory_lines', columns: ['routekey', 'transactiontypecode', 'quantity', 'itemcode'] }
  ];
  const tables = [...new Set([...candidates.map(candidate => candidate.table), 'customerclustermapping'])];
  const [indexes] = await connection.execute<GenericRow[]>(`
    SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
      SEQ_IN_INDEX AS position, COLUMN_NAME AS columnName,
      NON_UNIQUE AS nonUnique, SUB_PART AS prefixLength
    FROM information_schema.statistics
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${buildInClause(tables)})
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
  `, tables);
  const existing = new Map<string, { name: string; columns: string[]; unique: boolean }[]>();
  for (const row of indexes) {
    const table = String(row.tableName);
    const entries = existing.get(table) ?? [];
    let index = entries.find(entry => entry.name === String(row.indexName));
    if (!index) {
      index = { name: String(row.indexName), columns: [], unique: Number(row.nonUnique) === 0 };
      entries.push(index);
    }
    index.columns.push(row.prefixLength === null ? String(row.columnName) : `${row.columnName}(${row.prefixLength})`);
    existing.set(table, entries);
  }
  return {
    existing: Object.fromEntries(existing),
    candidates: candidates.map(candidate => {
      const coveredBy = existing.get(candidate.table)?.find(index =>
        candidate.columns.every((column, position) => index.columns[position]?.toLowerCase() === column.toLowerCase()));
      return {
        ...candidate,
        coveredBy: coveredBy?.name ?? null,
        // Returned for review only; this function never executes DDL.
        proposedSql: coveredBy ? null : `CREATE INDEX \`${candidate.name}\` ON \`${candidate.table}\` (${candidate.columns.map(column => `\`${column}\``).join(', ')});`
      };
    }),
    clusterMappingUnique: (existing.get('customerclustermapping') ?? []).some(index => index.unique &&
      index.columns.length === 2 && ['channel', 'divisioncode'].every(column => index.columns.includes(column)))
  };
}

/** Collects EXPLAIN output for the exact SELECTs used by a diagnostic operation. */
export async function explainSyncReads<T>(connection: PoolConnection, operation: (profiled: PoolConnection) => Promise<T>) {
  const plans: { sql: string; plan: GenericRow[] }[] = [];
  const profiled = new Proxy(connection, {
    get(target, property) {
      const method = Reflect.get(target, property);
      if (property !== 'query' && property !== 'execute') return typeof method === 'function' ? method.bind(target) : method;
      return async (sql: string, params: Parameters<PoolConnection['execute']>[1]) => {
        if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Sync comparison only permits SELECT queries');
        const [plan] = await target.execute<GenericRow[]>(`EXPLAIN ${sql}`, params);
        plans.push({ sql: sql.replace(/\s+/g, ' ').trim(), plan });
        return Reflect.apply(method, target, [sql, params]);
      };
    }
  });
  await operation(profiled);
  return plans;
}
