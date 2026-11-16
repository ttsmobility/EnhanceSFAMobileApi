/**
 * @author MD.Rabius Sani Raju
 * @date 2026-10-15
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../../../config/env';
import { withTransaction } from '../../../../shared/db/transaction';
import { measureDuration, toFixedDecimalString } from '../../../../shared/utils/commonUtils';
import type { DatabaseQueryTiming } from '../../../../shared/utils/commonUtils';
import { getSettingSyncSections } from '../models/setting.model';
import { getMasterDataSyncSections } from '../models/masterData.model';
import { getTransactionDataSyncSections } from '../models/transactionData.model';

const GET_SYNC_DATA_TABLE_NAMES = [
  'ControlPanel', 'Setup', 'companydetail', 'SalesmanMaster', 'RouteMaster',
  'startendday', 'synctime', 'CurrencyMaster', 'itemmustheader', 'itemmustdetail',
  'itemgroup', 'ItemMaster', 'itempackagemaster', 'routegoal', 'avgsalesqty',
  'outletitemcodes', 'taxmaster', 'startingloaddetail', 'inventorysummarydetail',
  'CustomerMaster', 'salescalender', 'routesequence', 'customerinvoice',
  'discountkeyheader', 'discountkeydetail', 'distributionkeydetails',
  'productgroupheader', 'productgroupdetail', 'promokeyheader', 'promokeydetail',
  'promoplanheader', 'promoplandetail', 'promotionassignmentadvanced',
  'customerpricing1', 'pricingdetail1', 'POSmaster', 'customerposinventory',
  'customerposlimit', 'posinstructions', 'customersurveyplan',
  'customersurveykeyplan', 'customersurveykey', 'customersurveydefinition',
  'customersurveydefassign', 'lookupindexdetail', 'nonservreasons', 'expreasons',
  'expiryreturnreasons', 'retitmreasons', 'freegoodreasons', 'voidreasons',
  'routebook', 'salestrend', 'tempcustinventory', 'customermessages',
  'salesmanmessages', 'vanmaster', 'bankmaster', 'cashdesc', 'inventorylocation',
  'salesorderheader', 'salesorderdetail', 'suggestedsalesinvoice',
  'inventorytransactiondetail', 'customer_foc_balance', 'customer_foc_detail',
  'journeyplancreditlimit', 'batchexpirydetail', 'customer_foc', 'itemnrp',
  'custnrp', 'deletemaster', 'customeritemgrp', 'customeritemmap'
] as const;

/** Loads all sync sections in one transaction and returns the Zend-compatible payload. */
export async function masterDataSyncAction(
  request: FastifyRequest<{ Params: Record<string, string | undefined> }>,
  reply: FastifyReply
) {
  const params = request.params;
  const timings: Record<string, number> = {};
  const queryTimings: DatabaseQueryTiming[] | undefined = env.SYNC_QUERY_TIMING_ENABLED ? [] : undefined;
  let databaseCompleted = false;
  try {
    const result = await withTransaction(async (connection) => {
      const routeId = Number(params.routeid);
      const userId = Number(params.userid);
      const deviceId = params.deviceid;

      const settingSections = await measureDuration(timings, 'settingsMs', () =>
        getSettingSyncSections(connection, { routeId }));
      const masterDataSections = await measureDuration(timings, 'masterDataMs', () =>
        getMasterDataSyncSections(connection, { routeId }, queryTimings));
      const transactionDataSections = await measureDuration(timings, 'transactionDownloadMs', () => getTransactionDataSyncSections(connection, {
        routeId,
        userId,
        deviceId
      }));

      const { ControlPanel, Setup, companydetail, SalesmanMaster, RouteMaster, startendday, synctime, CurrencyMaster } = settingSections;
      const { itemmustheader, itemmustdetail, itemgroup, ItemMaster, itempackagemaster, routegoal, avgsalesqty, outletitemcodes, taxmaster, itemnrp, custnrp, customeritemgrp, customeritemmap, CustomerMaster, salescalender, routesequence, customerinvoice, discountkeyheader, discountkeydetail, distributionkeydetails, productgroupheader, productgroupdetail, promokeyheader, promokeydetail, promoplanheader, promoplandetail, promotionassignmentadvanced, customerpricing1, pricingdetail1, POSmaster, customerposinventory, customerposlimit, posinstructions, customersurveyplan, customersurveykeyplan, customersurveykey, customersurveydefinition, customersurveydefassign, lookupindexdetail, nonservreasons, expreasons, expiryreturnreasons, retitmreasons, freegoodreasons, voidreasons, routebook, salestrend, tempcustinventory, customermessages, salesmanmessages, vanmaster, bankmaster, cashdesc, inventorylocation } = masterDataSections;
      const { startingloaddetail, inventorysummarydetail, salesorderheader, salesorderdetail, suggestedsalesinvoice, inventorytransactiondetail, customer_foc_balance, customer_foc_detail, journeyplancreditlimit, batchexpirydetail, customer_foc, deletemaster } = transactionDataSections;

      return measureDuration(timings, 'responseBuildMs', () => buildMasterDataSyncResponse({
        ControlPanel, Setup, companydetail, SalesmanMaster, RouteMaster, startendday,
        synctime, CurrencyMaster, itemmustheader, itemmustdetail, itemgroup,
        ItemMaster, itempackagemaster, routegoal, avgsalesqty, outletitemcodes,
        taxmaster, startingloaddetail, inventorysummarydetail, CustomerMaster,
        salescalender, routesequence, customerinvoice, discountkeyheader,
        discountkeydetail, distributionkeydetails, productgroupheader,
        productgroupdetail, promokeyheader, promokeydetail, promoplanheader,
        promoplandetail, promotionassignmentadvanced, customerpricing1,
        pricingdetail1, POSmaster, customerposinventory, customerposlimit,
        posinstructions, customersurveyplan, customersurveykeyplan,
        customersurveykey, customersurveydefinition, customersurveydefassign,
        lookupindexdetail, nonservreasons, expreasons, expiryreturnreasons,
        retitmreasons, freegoodreasons, voidreasons, routebook, salestrend,
        tempcustinventory, customermessages, salesmanmessages, vanmaster,
        bankmaster, cashdesc, inventorylocation, salesorderheader, salesorderdetail,
        suggestedsalesinvoice, inventorytransactiondetail, customer_foc_balance,
        customer_foc_detail, journeyplancreditlimit, batchexpirydetail,
        customer_foc, itemnrp, custnrp, deletemaster, customeritemgrp,
        customeritemmap
      }));
    }, timings);
    databaseCompleted = true;

    await reply.send(result);
  } finally {
    if (queryTimings) {
      request.log.info({
        event: 'sync.masterdata.queries',
        routeId: params.routeid,
        databaseCompleted,
        mode: 'sequential-diagnostics',
        queryCount: queryTimings.length,
        totalQueryMs: Math.round(queryTimings.reduce((sum, query) => sum + query.elapsedMs, 0) * 100) / 100,
        // Full SQL is captured only for the ten slowest queries; bind values are omitted.
        slowestQueries: [...queryTimings].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 10),
        queries: queryTimings.map(({ sql, ...summary }) => summary)
      }, 'master data query performance');
    }
    // Section timings are nested within transactionWorkMs; do not add all fields together.
    request.log.info({
      event: 'sync.performance',
      routeId: params.routeid,
      databaseCompleted,
      ...timings
    }, 'master sync performance');
  }
}

/** Orders every response section and supplies an empty array for missing data. */
function buildMasterDataSyncResponse(sections: Record<string, any>) {
  const response: Record<string, any> = {};

  for (const tableName of GET_SYNC_DATA_TABLE_NAMES) {
    response[tableName] = sections[tableName] ?? [];
  }

  applyZendValueFormatting(response);
  response.synccount = buildSyncCount(response);
  return response;
}

/** Builds the legacy synccount array, including duplicated item-must count entries. */
function buildSyncCount(response: Record<string, any>) {
  const syncCount = GET_SYNC_DATA_TABLE_NAMES.map((tableName) => ({
    tablename: tableName,
    tablecount: toZendTableCount(response[tableName]?.length ?? 0)
  }));
  const customerFocIndex = syncCount.findIndex((item) => item.tablename === 'customer_foc');

  syncCount.splice(
    customerFocIndex + 1,
    0,
    {
      tablename: 'itemmustheader',
      tablecount: toZendTableCount(response.itemmustheader?.length ?? 0)
    },
    {
      tablename: 'itemmustdetail',
      tablecount: toZendTableCount(response.itemmustdetail?.length ?? 0)
    }
  );

  return syncCount;
}

/** Converts selected decimal values to the fixed-width strings returned by Zend. */
function applyZendValueFormatting(response: Record<string, any>): void {
  formatDecimalFields(response.CustomerMaster, [
    'creditlimit',
    'tcspecialdiscount',
    'minsaleslimit',
    'maxsaleslimit'
  ]);
  formatDecimalFields(response.RouteMaster, ['minsaleslimit', 'maxsaleslimit']);
}

/** Applies legacy decimal formatting to named fields in each response row. */
function formatDecimalFields(rows: any[], fields: string[]): void {
  for (const row of rows ?? []) {
    for (const field of fields) {
      row[field] = toFixedDecimalString(row[field]);
    }
  }
}

/** Represents an empty table count as an empty string, matching the legacy API. */
function toZendTableCount(count: number) {
  return count === 0 ? '' : count;
}
