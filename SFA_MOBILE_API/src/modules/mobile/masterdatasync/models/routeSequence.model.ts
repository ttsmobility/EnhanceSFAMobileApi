import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Reads the six route sequence values without changing database records. */
export async function getRouteSequenceValues(connection: PoolConnection, routeId: number, optimized = false) {
  const [routeRows] = await connection.execute<
    (RowDataPacket & { transactionnoseq: number | null })[]
  >(
    `
      SELECT COALESCE(transactionnoseq, 0) AS transactionnoseq
      FROM routemaster
      WHERE routecode = :routeId
      LIMIT 1
    `,
    { routeId }
  );

  const useDexFlagSequences = Number(routeRows[0]?.transactionnoseq ?? 0) > 0;
  const maxima = optimized ? await getConsolidatedSequenceMaxima(connection, routeId) : undefined;

  const invoiceNumber = maxima
    ? String(useDexFlagSequences ? maxima.invoice0 : maxima.invoiceAll)
    : useDexFlagSequences
      ? await getMaxInvoiceNumber(connection, routeId, 0)
      : await getMaxInvoiceNumber(connection, routeId);
  const invoiceReturnNumber = maxima
    ? String(useDexFlagSequences ? maxima.invoice1 : maxima.invoiceAll)
    : useDexFlagSequences
      ? await getMaxInvoiceNumber(connection, routeId, 1)
      : invoiceNumber;
  const swapNumber = maxima
    ? String(useDexFlagSequences ? maxima.invoice2 : maxima.invoiceAll)
    : useDexFlagSequences
      ? await getMaxInvoiceNumber(connection, routeId, 2)
      : invoiceNumber;
  const arNumber = maxima ? String(maxima.arNumber) : await getMaxArNumber(connection, routeId);
  const orderNumber = maxima ? String(maxima.orderNumber) : await getMaxSalesOrderNumber(connection, routeId);
  const documentNumber = maxima ? String(maxima.documentNumber) : await getMaxDocumentNumber(connection, routeId);

  return {
    invoiceSequence: toRouteTransactionSequence(invoiceNumber, routeId, true),
    invoiceReturnSequence: toRouteTransactionSequence(invoiceReturnNumber, routeId, true),
    swapSequence: toRouteTransactionSequence(swapNumber, routeId, true),
    arSequence: toRouteTransactionSequence(arNumber, routeId, true),
    orderSequence: toRouteTransactionSequence(orderNumber, routeId, true),
    documentSequence: toRouteTransactionSequence(documentNumber, routeId, false)
  };
}

/** Scans each route's transaction rows once rather than revisiting each table. */
async function getConsolidatedSequenceMaxima(connection: PoolConnection, routeId: number) {
  const [rows] = await connection.execute<(RowDataPacket & Record<string, string | number>)[]>(`
    SELECT inv.invoiceAll, inv.invoice0, inv.invoice1, inv.invoice2,
      ar.arNumber, orders.orderNumber,
      GREATEST(inv.documentNumber, ar.documentNumber, orders.documentNumber, inventory.documentNumber) AS documentNumber
    FROM (
      SELECT COALESCE(MAX(invoicenumber), 0) AS invoiceAll,
        COALESCE(MAX(CASE WHEN dexflag = 0 THEN invoicenumber END), 0) AS invoice0,
        COALESCE(MAX(CASE WHEN dexflag = 1 THEN invoicenumber END), 0) AS invoice1,
        COALESCE(MAX(CASE WHEN dexflag = 2 THEN invoicenumber END), 0) AS invoice2,
        COALESCE(MAX(documentnumber), 0) AS documentNumber
      FROM invoiceheader WHERE routecode = :routeId
    ) inv
    CROSS JOIN (
      SELECT COALESCE(MAX(invoicenumber), 0) AS arNumber,
        COALESCE(MAX(documentnumber), 0) AS documentNumber
      FROM arheader WHERE routecode = :routeId
    ) ar
    CROSS JOIN (
      SELECT COALESCE(MAX(invoicenumber), 0) AS orderNumber,
        COALESCE(MAX(documentnumber), 0) AS documentNumber
      FROM salesorderheader WHERE routecode = :routeId
    ) orders
    CROSS JOIN (
      SELECT COALESCE(MAX(documentnumber), 0) AS documentNumber
      FROM inventorytransactionheader WHERE routecode = :routeId
    ) inventory
  `, { routeId });
  return rows[0];
}


/** Returns the highest invoice number currently stored for the route. */
async function getMaxInvoiceNumber(
  connection: PoolConnection,
  routeId: number,
  dexFlag?: number
): Promise<string> {
  const dexFlagFilter = dexFlag === undefined ? '' : 'AND dexflag = :dexFlag';
  const params: Record<string, number> =
    dexFlag === undefined ? { routeId } : { routeId, dexFlag };
  const [rows] = await connection.execute<
    (RowDataPacket & { invoicenumber: number | null })[]
  >(
    `
      SELECT COALESCE(MAX(invoicenumber), 0) AS invoicenumber
      FROM invoiceheader
      WHERE routecode = :routeId
      ${dexFlagFilter}
    `,
    params
  );

  return String(rows[0]?.invoicenumber ?? '0');
}


/** Returns the highest AR document number currently stored for the route. */
async function getMaxArNumber(
  connection: PoolConnection,
  routeId: number
): Promise<string> {
  const [rows] = await connection.execute<
    (RowDataPacket & { invoicenumber: number | null })[]
  >(
    `
      SELECT COALESCE(MAX(invoicenumber), 0) AS invoicenumber
      FROM arheader
      WHERE routecode = :routeId
    `,
    { routeId }
  );

  return String(rows[0]?.invoicenumber ?? '0');
}


/** Returns the highest sales-order number currently stored for the route. */
async function getMaxSalesOrderNumber(
  connection: PoolConnection,
  routeId: number
): Promise<string> {
  const [rows] = await connection.execute<
    (RowDataPacket & { invoicenumber: number | null })[]
  >(
    `
      SELECT COALESCE(MAX(invoicenumber), 0) AS invoicenumber
      FROM salesorderheader
      WHERE routecode = :routeId
    `,
    { routeId }
  );

  return String(rows[0]?.invoicenumber ?? '0');
}


/** Returns the highest document number across route transaction tables. */
async function getMaxDocumentNumber(
  connection: PoolConnection,
  routeId: number
): Promise<string> {
  const [rows] = await connection.execute<
    (RowDataPacket & { maxdocumentnumber: number | null })[]
  >(
    `
      SELECT MAX(maxdocumentnumber) AS maxdocumentnumber
      FROM (
        SELECT COALESCE(MAX(documentnumber), 0) AS maxdocumentnumber
        FROM inventorytransactionheader
        WHERE routecode = :routeId
        UNION
        SELECT COALESCE(MAX(documentnumber), 0) AS maxdocumentnumber
        FROM invoiceheader
        WHERE routecode = :routeId
        UNION
        SELECT COALESCE(MAX(documentnumber), 0) AS maxdocumentnumber
        FROM salesorderheader
        WHERE routecode = :routeId
        UNION
        SELECT COALESCE(MAX(documentnumber), 0) AS maxdocumentnumber
        FROM arheader
        WHERE routecode = :routeId
      ) tblmax
    `,
    { routeId }
  );

  return String(rows[0]?.maxdocumentnumber ?? '0');
}


/** Converts a maximum document number into the next route sequence component. */
function toRouteTransactionSequence(
  value: string,
  routeId: number,
  hasSeparatorAfterRoute: boolean
): number {
  if (value === '0') {
    return 1;
  }

  const prefixLength = String(routeId).length + (hasSeparatorAfterRoute ? 1 : 0);
  const sequencePart = value.slice(prefixLength);
  const sequence = Number.parseInt(sequencePart, 10);

  return Number.isNaN(sequence) ? 0 : sequence;
}
