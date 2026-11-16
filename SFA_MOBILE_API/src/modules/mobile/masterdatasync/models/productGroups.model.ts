import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { buildInClause } from '../../../../shared/utils/commonUtils';
import type { GenericRow } from '../../../../shared/utils/commonUtils';

type PromotionGroupRow = RowDataPacket & {
  qualificationgroup: number | string | null;
  assignmentgroup: number | string | null;
  keyqualificationgroup: number | string | null;
};

/**
 * Resolves route promotions once, then fetches their groups by indexed keys.
 * The header qualification branch checks pkd.qualificationgroup, while returning
 * ppd.qualificationgroup. Assignment groups have no item-mapping restriction.
 * These differences are intentional legacy rules and must not be combined.
 */
export async function getOptimizedProductGroups(connection: PoolConnection, routeId: number) {
  const [promotions] = await connection.execute<PromotionGroupRow[]>(`
    SELECT DISTINCT
      ppd.qualificationgroup,
      ppd.assignmentgroup,
      pkd.qualificationgroup AS keyqualificationgroup
    FROM (
      SELECT DISTINCT cm.promotionkey
      FROM routesequence rs
      INNER JOIN customermaster cm ON cm.customercode = rs.customercode
      WHERE rs.routecode = :routeId
    ) routekeys
    INNER JOIN promokeyheader pkh ON pkh.promotionkey = routekeys.promotionkey
    INNER JOIN promokeydetail pkd ON pkd.promotionkey = pkh.promotionkey
      AND CURRENT_DATE() BETWEEN pkd.startdate AND pkd.enddate
    INNER JOIN promoplanheader pph ON pph.plannumber = pkd.plannumber
    INNER JOIN promoplandetail ppd ON ppd.plannumber = pph.plannumber
  `, { routeId });

  if (promotions.length === 0) {
    return { productgroupheader: [], productgroupdetail: [] };
  }

  const [mappedGroups] = await connection.execute<GenericRow[]>(`
    SELECT DISTINCT pgd.groupnumber
    FROM productgroupdetail pgd
    INNER JOIN routeitemmapping rim ON rim.itemcode = pgd.itemcode
    WHERE rim.routeitemgrpcode = (
      SELECT routeitemgrpcode FROM routemaster WHERE routecode = :routeId LIMIT 1
    )
  `, { routeId });
  const mapped = new Set(mappedGroups.map(row => String(row.groupnumber)));
  const headers = new Map<string, number | string>();
  const details = new Map<string, number | string>();
  const add = (groups: Map<string, number | string>, value: number | string | null) => {
    if (value !== null) groups.set(String(value), value);
  };

  for (const promotion of promotions) {
    add(details, promotion.qualificationgroup);
    add(details, promotion.assignmentgroup);
    add(headers, promotion.assignmentgroup);
    if (promotion.keyqualificationgroup !== null && mapped.has(String(promotion.keyqualificationgroup))) {
      add(headers, promotion.qualificationgroup);
    }
  }

  const headerIds = [...headers.values()];
  const detailIds = [...details.values()];
  const [productgroupheader] = headerIds.length
    ? await connection.execute<GenericRow[]>(`
        SELECT DISTINCT pgh.* FROM productgroupheader pgh
        WHERE pgh.groupnumber IN (${buildInClause(headerIds)})
      `, headerIds)
    : [[]];
  const [productgroupdetail] = detailIds.length
    ? await connection.execute<GenericRow[]>(`
        SELECT DISTINCT pgd.* FROM productgroupdetail pgd
        WHERE pgd.groupnumber IN (${buildInClause(detailIds)})
      `, detailIds)
    : [[]];

  return { productgroupheader, productgroupdetail };
}

/** Uses a consistent read-only snapshot when comparing legacy and optimized SQL. */
export async function beginProductGroupComparison(connection: PoolConnection): Promise<void> {
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.beginTransaction();
}

/** Captures plans on the target database without executing any data changes. */
export async function explainProductGroupQueries(connection: PoolConnection, routeId: number) {
  const plans: { implementation: string; sql: string; plan: GenericRow[] }[] = [];
  async function capture(implementation: string, operation: (profiled: PoolConnection) => Promise<unknown>) {
    const profiled = new Proxy(connection, {
      get(target, property) {
        const method = Reflect.get(target, property);
        if (property !== 'execute') return typeof method === 'function' ? method.bind(target) : method;
        return async (sql: string, params: Parameters<PoolConnection['execute']>[1]) => {
          const [plan] = await target.execute<GenericRow[]>(`EXPLAIN ${sql}`, params);
          plans.push({ implementation, sql: sql.replace(/\s+/g, ' ').trim(), plan });
          return Reflect.apply(method, target, [sql, params]);
        };
      }
    });
    await operation(profiled);
  }
  await capture('legacy-header', profiled => getProductGroupHeader(profiled, routeId));
  await capture('legacy-detail', profiled => getProductGroupDetail(profiled, routeId));
  await capture('optimized', profiled => getOptimizedProductGroups(profiled, routeId));
  return plans;
}


/** Returns route-relevant promotion product-group headers. */
export async function getProductGroupHeader(
  connection: PoolConnection,
  routeId: number,
): Promise<GenericRow[]> {
  const [rows] = await connection.execute<GenericRow[]>(
    `
      SELECT DISTINCT pgh.*
      FROM productgroupheader pgh
      WHERE pgh.groupnumber IN (
        SELECT ppd.qualificationgroup
        FROM promokeyheader pkh
        INNER JOIN promokeydetail pkd
          ON pkh.promotionkey = pkd.promotionkey
          AND CURRENT_DATE() BETWEEN pkd.startdate AND pkd.enddate
        INNER JOIN promoplanheader pph ON pkd.plannumber = pph.plannumber
        INNER JOIN promoplandetail ppd ON pph.plannumber = ppd.plannumber
        WHERE pkh.promotionkey IN (
          SELECT DISTINCT cm.promotionkey
          FROM customermaster cm
          INNER JOIN routesequence rs
            ON cm.customercode = rs.customercode
            AND rs.routecode = :routeId
        )
        AND pkd.qualificationgroup IN (
          SELECT DISTINCT pgd.groupnumber
          FROM productgroupdetail pgd
          WHERE pgd.itemcode IN (
            SELECT DISTINCT rim.itemcode
            FROM routeitemmapping rim
            WHERE rim.routeitemgrpcode = (
              SELECT routeitemgrpcode
              FROM routemaster
              WHERE routecode = :routeId
              LIMIT 1
            )
          )
        )
        UNION
        SELECT ppd.assignmentgroup
        FROM promokeyheader pkh
        INNER JOIN promokeydetail pkd
          ON pkh.promotionkey = pkd.promotionkey
          AND CURRENT_DATE() BETWEEN pkd.startdate AND pkd.enddate
        INNER JOIN promoplanheader pph ON pkd.plannumber = pph.plannumber
        INNER JOIN promoplandetail ppd ON pph.plannumber = ppd.plannumber
        WHERE pkh.promotionkey IN (
          SELECT DISTINCT cm.promotionkey
          FROM customermaster cm
          INNER JOIN routesequence rs
            ON cm.customercode = rs.customercode
            AND rs.routecode = :routeId
        )
      )
    `,
    { routeId },
  );

  return rows;
}


/** Returns items belonging to route-relevant promotion product groups. */
export async function getProductGroupDetail(
  connection: PoolConnection,
  routeId: number,
): Promise<GenericRow[]> {
  const [rows] = await connection.execute<GenericRow[]>(
    `
      SELECT DISTINCT pgd.*
      FROM productgroupdetail pgd
      WHERE pgd.groupnumber IN (
        SELECT ppd.qualificationgroup
        FROM promokeyheader pkh
        INNER JOIN promokeydetail pkd
          ON pkh.promotionkey = pkd.promotionkey
          AND CURRENT_DATE() BETWEEN pkd.startdate AND pkd.enddate
        INNER JOIN promoplanheader pph ON pkd.plannumber = pph.plannumber
        INNER JOIN promoplandetail ppd ON pph.plannumber = ppd.plannumber
        WHERE pkh.promotionkey IN (
          SELECT DISTINCT cm.promotionkey
          FROM customermaster cm
          INNER JOIN routesequence rs
            ON cm.customercode = rs.customercode
            AND rs.routecode = :routeId
        )
        UNION
        SELECT ppd.assignmentgroup
        FROM promokeyheader pkh
        INNER JOIN promokeydetail pkd
          ON pkh.promotionkey = pkd.promotionkey
          AND CURRENT_DATE() BETWEEN pkd.startdate AND pkd.enddate
        INNER JOIN promoplanheader pph ON pkd.plannumber = pph.plannumber
        INNER JOIN promoplandetail ppd ON pph.plannumber = ppd.plannumber
        WHERE pkh.promotionkey IN (
          SELECT DISTINCT cm.promotionkey
          FROM customermaster cm
          INNER JOIN routesequence rs
            ON cm.customercode = rs.customercode
            AND rs.routecode = :routeId
        )
      )
    `,
    { routeId },
  );

  return rows;
}
