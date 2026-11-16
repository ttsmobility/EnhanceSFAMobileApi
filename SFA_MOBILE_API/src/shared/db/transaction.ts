/**
 * @author MD.Rabius Sani Raju
 * @date 2026-10-15
 */

import type { PoolConnection } from 'mysql2/promise';
import { performance } from 'perf_hooks';
import { mysqlPool } from './mysqlPool';
import { measureDuration } from '../utils/commonUtils';

export async function withTransaction<T>(
  handler: (connection: PoolConnection) => Promise<T>,
  timings?: Record<string, number>
): Promise<T> {
  const started = performance.now();
  try {
    const connection = await measureDuration(timings, 'connectionWaitMs', () => mysqlPool.getConnection());
    const acquired = performance.now();
    try {
      await measureDuration(timings, 'beginMs', () => connection.beginTransaction());
      const result = await measureDuration(timings, 'transactionWorkMs', () => handler(connection));
      await measureDuration(timings, 'commitMs', () => connection.commit());
      return result;
    } catch (error) {
      await measureDuration(timings, 'rollbackMs', () => connection.rollback());
      throw error;
    } finally {
      connection.release();
      if (timings) timings.connectionHeldMs = Math.round((performance.now() - acquired) * 100) / 100;
    }
  } finally {
    if (timings) timings.databaseTotalMs = Math.round((performance.now() - started) * 100) / 100;
  }
}
