// SELECT-only customer/sequence comparison. This never runs the settings UPDATEs.
const fs = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');
const { createHash } = require('crypto');

function fingerprint(value) {
  const rows = Array.isArray(value) ? value : [value];
  const canonical = rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))).sort();
  return { rows: rows.length, hash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--help' || key === '--explain') args[key] = true;
    else if (['--routes', '--repeats', '--output'].includes(key) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) args[key] = process.argv[++i];
    else throw new Error(`Invalid argument: ${key}`);
  }
  if (args['--help']) {
    console.log('node scripts/compare-sync-hotspots.js [--routes 1818,1819,1820] [--repeats 3] [--explain] [--output performance-results]');
    return;
  }
  const supplied = (args['--routes'] ?? '1818,1819,1820').split(/[\s,\\]+/).filter(Boolean);
  if (!supplied.length || supplied.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('Routes must be numeric IDs');
  const repeats = Number(args['--repeats'] ?? 3);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('repeats must be between 1 and 20');
  const { mysqlPool } = require('../dist/shared/db/mysqlPool');
  const { getCustomerMaster, getRouteCustomerCodes } = require('../dist/modules/mobile/masterdatasync/models/masterData.model');
  const { getRouteSequenceValues } = require('../dist/modules/mobile/masterdatasync/models/routeSequence.model');
  const { beginSyncPerformanceComparison, getSyncIndexReview, explainSyncReads } = require('../dist/modules/mobile/masterdatasync/models/syncPerformance.model');
  const results = [];
  let indexReview;
  let allRowsMatch = true;
  try {
    for (const routeId of [...new Set(supplied)].map(Number)) {
      const connection = await mysqlPool.getConnection();
      try {
        await beginSyncPerformanceComparison(connection);
        if (!indexReview) indexReview = await getSyncIndexReview(connection);
        const codes = await getRouteCustomerCodes(connection, routeId);
        const operations = {
          CustomerMaster: {
            legacy: db => getCustomerMaster(db, routeId, codes, false),
            optimized: db => getCustomerMaster(db, routeId, codes, true)
          },
          routeSequences: {
            legacy: db => getRouteSequenceValues(db, routeId, false),
            optimized: db => getRouteSequenceValues(db, routeId, true)
          }
        };
        const route = { routeId, cases: {} };
        for (const [name, operationsForCase] of Object.entries(operations)) {
          const rounds = [];
          for (let round = 0; round < repeats; round++) {
            const pair = {};
            for (const implementation of round % 2 === 0 ? ['legacy', 'optimized'] : ['optimized', 'legacy']) {
              const started = performance.now();
              const value = await operationsForCase[implementation](connection);
              pair[implementation] = { ms: Math.round((performance.now() - started) * 100) / 100, ...fingerprint(value) };
            }
            const match = pair.legacy.hash === pair.optimized.hash;
            allRowsMatch &&= match;
            const result = { round: round + 1, match, ...pair };
            rounds.push(result);
            console.log(JSON.stringify({ routeId, section: name, ...result }));
          }
          const average = key => Math.round(rounds.reduce((sum, round) => sum + round[key].ms, 0) / rounds.length * 100) / 100;
          const result = { legacyAverageMs: average('legacy'), optimizedAverageMs: average('optimized'), rounds };
          if (args['--explain']) {
            result.legacyPlans = await explainSyncReads(connection, operationsForCase.legacy);
            result.optimizedPlans = await explainSyncReads(connection, operationsForCase.optimized);
          }
          route.cases[name] = result;
        }
        results.push(route);
      } finally {
        try { await connection.rollback(); } finally { connection.release(); }
      }
    }
    const directory = path.resolve(args['--output'] ?? 'performance-results');
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, `sync-hotspots-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(filename, JSON.stringify({ allRowsMatch, indexReview, results }, null, 2));
    console.log(`${allRowsMatch ? 'All compared values match.' : 'MISMATCH: leave the new optimizations disabled.'} Results: ${filename}`);
    console.log('Index SQL is provided for review only. No indexes or records were changed.');
    if (!indexReview.clusterMappingUnique) console.log('Customer cluster uniqueness is not enforced: leave customer optimization disabled pending review.');
    if (!allRowsMatch) process.exitCode = 1;
  } finally {
    await mysqlPool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
