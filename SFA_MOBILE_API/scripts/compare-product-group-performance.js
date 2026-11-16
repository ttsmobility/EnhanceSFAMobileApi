// Uses .env database settings. All comparisons use read-only transaction snapshots.
const fs = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');
const { createHash } = require('crypto');

function canonical(rows) {
  return rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))).sort();
}

async function timed(operation) {
  const start = performance.now();
  const rows = await operation();
  return { rows, ms: Math.round((performance.now() - start) * 100) / 100 };
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
    console.log('node scripts/compare-product-group-performance.js [--routes 1818,1819,1820] [--repeats 3] [--explain] [--output performance-results]');
    return;
  }
  const supplied = (args['--routes'] ?? '1818,1819,1820').split(/[\s,\\]+/).filter(Boolean);
  if (!supplied.length || supplied.some(route => !/^\d+$/.test(route) || !Number.isSafeInteger(Number(route)))) throw new Error('Routes must be numeric IDs');
  const routes = [...new Set(supplied)].map(Number);
  const repeats = Number(args['--repeats'] ?? 3);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('repeats must be between 1 and 20');
  const { mysqlPool } = require('../dist/shared/db/mysqlPool');
  const {
    getProductGroupHeader, getProductGroupDetail, getOptimizedProductGroups,
    beginProductGroupComparison, explainProductGroupQueries
  } = require('../dist/modules/mobile/masterdatasync/models/productGroups.model');
  const results = [];
  let mismatch = false;
  try {
    for (const routeId of routes) {
      const connection = await mysqlPool.getConnection();
      try {
        await beginProductGroupComparison(connection);
        const rounds = [];
        const legacy = async () => ({
          productgroupheader: await getProductGroupHeader(connection, routeId),
          productgroupdetail: await getProductGroupDetail(connection, routeId)
        });
        const optimized = () => getOptimizedProductGroups(connection, routeId);
        for (let round = 0; round < repeats; round++) {
          // Alternate execution order to reduce consistent first-query cache bias.
          const first = await timed(round % 2 === 0 ? legacy : optimized);
          const second = await timed(round % 2 === 0 ? optimized : legacy);
          const baseline = round % 2 === 0 ? first : second;
          const candidate = round % 2 === 0 ? second : first;
          const sections = {};
          for (const section of ['productgroupheader', 'productgroupdetail']) {
            const before = JSON.stringify(canonical(baseline.rows[section]));
            const after = JSON.stringify(canonical(candidate.rows[section]));
            const match = before === after;
            mismatch ||= !match;
            sections[section] = {
              match, legacyRows: baseline.rows[section].length, optimizedRows: candidate.rows[section].length,
              legacyHash: createHash('sha256').update(before).digest('hex'),
              optimizedHash: createHash('sha256').update(after).digest('hex')
            };
          }
          const result = { round: round + 1, legacyMs: baseline.ms, optimizedMs: candidate.ms, sections };
          rounds.push(result);
          console.log(JSON.stringify({ routeId, ...result }));
        }
        const average = field => Math.round(rounds.reduce((sum, round) => sum + round[field], 0) / rounds.length * 100) / 100;
        const result = { routeId, legacyAverageMs: average('legacyMs'), optimizedAverageMs: average('optimizedMs'), rounds };
        if (args['--explain']) result.plans = await explainProductGroupQueries(connection, routeId);
        results.push(result);
      } finally {
        try { await connection.rollback(); } finally { connection.release(); }
      }
    }
    const directory = path.resolve(args['--output'] ?? 'performance-results');
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, `product-groups-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(filename, JSON.stringify({ allRowsMatch: !mismatch, results }, null, 2));
    console.log(`${mismatch ? 'MISMATCH: leave optimization disabled.' : 'All compared row values and columns match (unordered).'} Results: ${filename}`);
    if (mismatch) process.exitCode = 1;
  } finally {
    await mysqlPool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
