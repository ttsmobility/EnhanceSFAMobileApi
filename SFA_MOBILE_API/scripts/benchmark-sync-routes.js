// Measures complete sync downloads without retaining response bodies or changing mobile code.
const http = require('http');
const https = require('https');
const fs = require('fs/promises');
const path = require('path');
const { performance } = require('perf_hooks');

const DEFAULT_ROUTES = `
1819 1822 1820 1814 1821 1818 1811 1825 3149 1809 1812 1823 1919 3017 1824 1817
3140 1239 3020 1810 1506 1008 3144 3151 1216 1505 3004 1123 3134 1806 2081 3207
1142 2078 1502 3016 3155 2473 1526 2058 1119 1503 1005 3018 1017 2063 1109 3135
1525 1815 1107 3205 3138 1028 2065 3152 1011 1500 1021 3003 1516 1241 3146 3002
1920 2056 3009 3132 1509 1911 1003 1023 2066 1006 1907 1122 2061 1016 1025 3143
3209 1009 1022 1523 1027 1100 1012 1141 3010 1219 3158 2052 2070 1010 1135 2067
1015 1801 1914 2068 1512 2079 3202 3136 1120 1511 1226 1915 1271 3011 1020 3012
1524 1229 1906 1508 1116 2436 3200 2062 3006 2441 2451 1510 1528 1218 3007 2073
1519 1903 3137 1208 3131 1518 2463 2471 1019 2431 3157 2462 2430 2461 2057 1139
2443 1220 1912 1118 1024 1520 1272 2434 1909 1240 2470 3005 1128 1905 1805 3206
3148 1804 3150 3133 1908 3141 1127 2486 3139 3145 1527 1275 1800 1870 3153 3156
1144 1701 1910 1274 1230 1703 1702 3019 2432 1138 1904 3023 1804
`;

function options(argv) {
  const result = {};
  const known = new Set(['base-url', 'concurrency', 'routes', 'userid', 'deviceid', 'mdate', 'table', 'timeout-ms', 'output']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'dry-run' || key === 'help') result[key] = true;
    else if (!argv[i].startsWith('--') || !known.has(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
      throw new Error(`Invalid argument: ${argv[i]}`);
    } else result[key] = argv[++i];
  }
  return result;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function measure(url, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now();
    let bytes = 0;
    let firstByteMs = null;
    let httpStatus = null;
    let finished = false;
    let timer;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ httpStatus, firstByteMs, totalMs: performance.now() - started, bytes, error: error?.message ?? '' });
    };
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false,
      headers: { accept: 'application/json' }
    }, response => {
      httpStatus = response.statusCode;
      firstByteMs = performance.now() - started;
      response.on('data', chunk => { bytes += chunk.length; });
      response.on('end', () => finish());
      response.on('error', finish);
      response.on('aborted', () => finish(new Error('Response aborted')));
    });
    request.on('error', finish);
    // Absolute deadline includes connection setup and the entire response download.
    timer = setTimeout(() => request.destroy(new Error(`Timeout after ${timeoutMs} ms`)), timeoutMs);
  });
}

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log('node scripts/benchmark-sync-routes.js [--concurrency 5|all] [--base-url http://host:3000] [--routes 1818,1819] [--userid -1] [--deviceid 0] [--mdate 2024-05-25] [--table 4] [--timeout-ms 120000] [--output directory] [--dry-run]');
    return;
  }
  const supplied = (args.routes ?? DEFAULT_ROUTES).trim().split(/[\s,\\]+/).filter(Boolean);
  if (!supplied.length || supplied.some(route => !/^\d+$/.test(route))) throw new Error('Routes must be numeric IDs');
  const routes = [...new Set(supplied)];
  const concurrency = Math.min(routes.length, args.concurrency === 'all' ? routes.length : positiveInteger(args.concurrency ?? 5, 'concurrency'));
  const timeoutMs = positiveInteger(args['timeout-ms'] ?? 120000, 'timeout-ms');
  const base = new URL(args['base-url'] ?? 'http://towelltake.fortiddns.com:3000');
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('base-url must use HTTP or HTTPS');
  const makeUrl = route => {
    const url = new URL(base);
    const segments = ['routeid', route, 'userid', args.userid ?? '-1', 'deviceid', args.deviceid ?? '0', 'mdate', args.mdate ?? '2024-05-25', 'table', args.table ?? '4'];
    url.pathname = `${base.pathname.replace(/\/$/, '')}/api/index/getsyncdata1/${segments.map(encodeURIComponent).join('/')}`;
    url.search = '';
    url.hash = '';
    return url;
  };
  console.log(`${routes.length} unique routes (${supplied.length - routes.length} duplicate entries removed), concurrency ${concurrency}, timeout ${timeoutMs} ms`);
  if (args['dry-run']) {
    console.log(`Routes: ${routes.join(', ')}`);
    console.log(`Example: ${makeUrl(routes[0])}`);
    console.log('Dry run: no HTTP requests sent.');
    return;
  }

  const directory = path.resolve(args.output ?? 'performance-results');
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(directory, `sync-${stamp}.csv`);
  const columns = ['routeId', 'httpStatus', 'firstByteMs', 'totalMs', 'bytes', 'error'];
  await fs.writeFile(csvPath, `${columns.join(',')}\n`);
  const results = [];
  let cursor = 0;
  let writes = Promise.resolve();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < routes.length) {
      const routeId = routes[cursor++];
      const result = { routeId, ...await measure(makeUrl(routeId), timeoutMs) };
      results.push(result);
      const row = columns.map(key => {
        const value = typeof result[key] === 'number' ? Math.round(result[key] * 100) / 100 : result[key] ?? '';
        return `"${String(value).replace(/"/g, '""')}"`;
      }).join(',');
      // Serialize appends so completed results survive a later interruption.
      writes = writes.then(() => fs.appendFile(csvPath, `${row}\n`));
      await writes;
      console.log(`[${results.length}/${routes.length}] route ${routeId}: HTTP ${result.httpStatus ?? '-'}, ${(result.totalMs / 1000).toFixed(2)}s, ${result.bytes} bytes${result.error ? `, ${result.error}` : ''}`);
    }
  }));
  const wallMs = performance.now() - started;
  const passed = results.filter(row => row.httpStatus === 200 && !row.error);
  const times = passed.map(row => row.totalMs).sort((a, b) => a - b);
  const summary = {
    startedAt, baseUrl: base.toString(), concurrency,
    parameters: { userid: args.userid ?? '-1', deviceid: args.deviceid ?? '0', mdate: args.mdate ?? '2024-05-25', table: args.table ?? '4' },
    totalRoutes: routes.length, successfulHttpDownloads: passed.length, failed: results.length - passed.length,
    wallSeconds: wallMs / 1000, completedRequestsPerSecond: results.length / (wallMs / 1000),
    totalResponseBytes: results.reduce((total, row) => total + row.bytes, 0),
    successfulDownloadMs: {
      min: times[0] ?? null, average: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: times[times.length - 1] ?? null
    },
    slowest: [...passed].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10)
  };
  await fs.writeFile(path.join(directory, `sync-${stamp}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Per-route results: ${csvPath}`);
  if (summary.failed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
