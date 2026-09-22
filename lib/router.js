const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const config = require('./config');
const woolypooly = require('./woolypooly');
const metrics = require('./metrics');
const ui = require('./ui');
const history = require('./history');

const HEARTBEAT_MS = 15000;

// Static assets (css/js/images) are served from /public.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
const FEED_PRUNE_MS = 10 * 60 * 1000;

let sseClients = []; // { res, key }
const feeds = new Map(); // key -> { key, coin, wallet, data, updatedAt, okAt, error, inFlight }

function feedKey(coin, wallet) {
  return String(coin).toLowerCase() + '|' + String(wallet).toLowerCase();
}

function getFeed(coin, wallet) {
  const key = feedKey(coin, wallet);
  let feed = feeds.get(key);
  if (!feed) {
    feed = { key, coin, wallet, data: null, updatedAt: 0, okAt: 0, error: null, inFlight: null };
    feeds.set(key, feed);
  }
  return feed;
}

// All upstream calls run concurrently. Individual failures are captured
// per-source instead of rejecting, so one bad endpoint can't kill the others.
async function fetchSnapshot(coin, wallet) {
  const [usdPrice, poolResult, accountResult] = await Promise.all([
    woolypooly.getCoinUsdPrice(coin),
    woolypooly.fetchPoolStats(coin).then(
      data => {
        if (!data || typeof data !== 'object') throw new Error('empty payload');
        return { ok: true, data };
      },
      err => ({ ok: false, error: 'pool: ' + err.message })
    ),
    woolypooly.fetchAccountStats(coin, wallet).then(
      data => (data && data.stats
        ? { ok: true, data }
        : { ok: false, error: 'account: empty payload' }),
      err => ({ ok: false, error: 'account: ' + err.message })
    )
  ]);
  return { usdPrice, poolResult, accountResult };
}

// Build the long-window observed earnings + history age for a wallet feed.
function computeHistory(coin, wallet, now) {
  const key = feedKey(coin, wallet);
  const w1h = history.windowObserved(key, 3600 * 1000, now);
  const w12h = history.windowObserved(key, 12 * 3600 * 1000, now);
  const w24h = history.windowObserved(key, 24 * 3600 * 1000, now);
  const w7d = history.windowObserved(key, 7 * 24 * 3600 * 1000, now);
  const w30d = history.windowObserved(key, 30 * 24 * 3600 * 1000, now);
  return {
    observed: { '1h': w1h, '12h': w12h, '24h': w24h, '7d': w7d, '30d': w30d },
    ageMs: history.ageMs(key, now)
  };
}

// Persist a telemetry snapshot on a successful account fetch. Called with the
// raw API values so history never stores fabricated zeros.
function recordHistory(coin, wallet, accountStats, poolStats, now) {
  if (!accountStats || !accountStats.stats) return;
  const stats = accountStats.stats;
  const income = stats.income || {};
  const mode = (accountStats.mode_stats && accountStats.mode_stats.pplns && accountStats.mode_stats.pplns.default) || {};
  const pplns = (Array.isArray(poolStats && poolStats.modes) ? poolStats.modes : [])
    .find(m => String(m.payoutScheme).toUpperCase() === 'PPLNS') || {};
  const algo = pplns.algo_stats && pplns.algo_stats.default ? pplns.algo_stats.default : {};

  history.record(feedKey(coin, wallet), {
    balance: stats.balance,
    immature_balance: stats.immature_balance,
    paid: stats.paid,
    income_Hour: income.income_Hour,
    income_HalfDay: income.income_HalfDay,
    income_Day: income.income_Day,
    income_Week: income.income_Week,
    income_Month: income.income_Month,
    hashrateCurrent: mode.currentHashrate,
    hashrate6h: mode.hashrate,
    hashrate24h: mode.dayHashrate,
    poolHashrate: algo.hashrate,
    poolMiners: algo.minersTotal,
    poolEffortPct: pplns.effort != null ? pplns.effort * 100 : 0,
    netHashrate: poolStats ? poolStats.netHashrate : 0,
    difficulty: poolStats ? poolStats.difficulty : 0,
    workersOnline: accountStats.workersOnline,
    workersTotal: accountStats.workersTotal
  }, now);
}

// Compute the full processed snapshot for a feed.
// NOTE: when an upstream fails we keep serving the last-known-good snapshot,
// only re-flagging it stale. Zeros are never substituted for real data.
function processFeedSnapshot(snapshot, coin, wallet) {
  const poolOk = snapshot.poolResult.ok;
  const accountOk = snapshot.accountResult.ok;
  const now = Date.now();

  if (accountOk) {
    recordHistory(coin, wallet, snapshot.accountResult.data, poolOk ? snapshot.poolResult.data : null, now);
  }

  return metrics.processMetrics(
    {
      poolStats: poolOk ? snapshot.poolResult.data : null,
      accountStats: accountOk ? snapshot.accountResult.data : null,
      usdPrice: snapshot.usdPrice,
      poolOk,
      accountOk,
      payoutThreshold: config.PAYOUT_THRESHOLD
    },
    coin,
    wallet,
    computeHistory(coin, wallet, now)
  );
}

// Refresh a feed once; concurrent callers share the same in-flight promise.
// On any source failure we keep serving the last-known-good snapshot flagged
// as stale, so the UI can show "STALE" instead of fake zeros.
function refreshFeed(feed) {
  if (feed.inFlight) return feed.inFlight;
  feed.inFlight = (async () => {
    try {
      const snapshot = await fetchSnapshot(feed.coin, feed.wallet);
      const poolOk = snapshot.poolResult.ok;
      const accountOk = snapshot.accountResult.ok;
      const prev = feed.data;

      if (poolOk && accountOk) {
        feed.data = processFeedSnapshot(snapshot, feed.coin, feed.wallet);
        feed.data.stale = false;
        feed.data.sources = { pool: true, account: true };
        feed.okAt = Date.now();
        feed.error = null;
      } else if (!prev) {
        // First fetch and something failed: build from what we have. Missing
        // sources are reported as N/A, numbers are never invented.
        feed.data = processFeedSnapshot(snapshot, feed.coin, feed.wallet);
        feed.data.stale = true;
        feed.data.sources = { pool: poolOk, account: accountOk };
        feed.error = [snapshot.poolResult.error, snapshot.accountResult.error].filter(Boolean).join('; ');
        feed.data.error = feed.error;
      } else {
        // Reuse last-known-good values; only flag staleness (no zeroing).
        feed.data.stale = true;
        feed.error = [snapshot.poolResult.error, snapshot.accountResult.error].filter(Boolean).join('; ');
        feed.data.error = feed.error;
        if (prev.sources) feed.data.sources = prev.sources;
        feed.data.lastGoodAt = prev.okAt || prev.timestamp || Date.now();
      }
      feed.updatedAt = Date.now();
      broadcastFeed(feed);
      return feed.data;
    } finally {
      feed.inFlight = null;
    }
  })();
  return feed.inFlight;
}

function broadcastFeed(feed) {
  const payload = 'data: ' + JSON.stringify(feed.data) + '\n\n';
  sseClients.forEach(client => {
    if (client.key !== feed.key) return;
    try {
      client.res.write(payload);
    } catch (err) {}
  });
}

// Shared snapshot for /api/stats: refresh at most once per interval.
async function getMetrics(coin, wallet) {
  const feed = getFeed(coin, wallet);
  if (!feed.data || Date.now() - feed.updatedAt > config.REFRESH_INTERVAL_MS) {
    await refreshFeed(feed);
  }
  return feed.data;
}

async function resolveRequestConfig(searchParams) {
  const wallet = config.DEFAULT_WALLET;
  let coin = searchParams.get('coin');
  if (!coin) {
    coin = await woolypooly.detectPoolForWallet(wallet);
  }
  coin = config.normalizeCoin(coin);
  if (!coin) {
    const err = new Error('Unsupported coin: ' + searchParams.get('coin'));
    err.statusCode = 400;
    throw err;
  }
  return { coin, wallet };
}

function redactWallet(w) {
  const s = String(w || '');
  return s.length > 16 ? s.slice(0, 10) + '…' + s.slice(-6) : s;
}

// Deep-copy with the wallet string replaced anywhere it appears, so raw
// upstream payloads can be inspected without ever echoing the full address.
function deepRedact(value, wallet, depth) {
  const d = depth == null ? 0 : depth;
  if (d > 12) return '[deep]';
  const w = String(wallet || '');
  if (typeof value === 'string') {
    if (w && value.toLowerCase() === w.toLowerCase()) return redactWallet(w);
    if (w && value.indexOf(w) !== -1) return value.split(w).join(redactWallet(w));
    return value;
  }
  if (Array.isArray(value)) return value.map(v => deepRedact(v, wallet, d + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepRedact(value[k], wallet, d + 1);
    return out;
  }
  return value;
}

function sendError(res, err) {
  const statusCode = err.statusCode || 500;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: err.message }));
}

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Debug endpoints
// ---------------------------------------------------------------------------
// /api/debug/woolypooly   → raw (redacted) upstream account+pool+price status
// /api/debug/history      → local telemetry summary
// These exist so an upstream schema change can be inspected without guessing —
// the wallet address is never echoed back in full.
// ---------------------------------------------------------------------------
async function handleDebugWoolypooly(req, res, searchParams) {
  try {
    const { coin, wallet } = await resolveRequestConfig(searchParams);
    const [usdPrice, poolResult, accountResult] = await Promise.all([
      woolypooly.getCoinUsdPrice(coin),
      woolypooly.fetchPoolStats(coin).then(
        data => ({ ok: true, data }),
        err => ({ ok: false, error: err.message })
      ),
      woolypooly.fetchAccountStats(coin, wallet).then(
        data => ({ ok: true, data }),
        err => ({ ok: false, error: err.message })
      )
    ]);

    sendJson(res, 200, {
      requested: { coin, wallet: redactWallet(wallet) },
      price: { ok: usdPrice != null, usd: usdPrice },
      pool: { ok: poolResult.ok, error: poolResult.ok ? null : poolResult.error },
      account: {
        ok: accountResult.ok,
        error: accountResult.ok ? null : accountResult.error,
        raw: accountResult.ok ? deepRedact(accountResult.data, wallet) : null
      }
    });
  } catch (err) {
    sendError(res, err);
  }
}

async function handleDebugHistory(req, res, searchParams) {
  try {
    const { coin, wallet } = await resolveRequestConfig(searchParams);
    const now = Date.now();
    const hs = computeHistory(coin, wallet, now);
    sendJson(res, 200, {
      key: coin + '|' + redactWallet(wallet),
      wallet: redactWallet(wallet),
      coin,
      historyAgeMs: hs.ageMs,
      historyDays: +(hs.ageMs / 86400000).toFixed(2),
      observed: hs.observed,
      snapshotIntervalMs: history.snapshotIntervalMs,
      keepMs: history.keepMs
    });
  } catch (err) {
    sendError(res, err);
  }
}

const GZIP_TYPES = new Set(['text/html', 'text/css', 'text/javascript', 'application/json', 'image/svg+xml']);

// Stream a buffer to res, applying gzip when the client accepts it and the
// content type is compressible. Assets are served with `no-cache` so the
// always-fresh dashboard behaves the same after redeploys (revalidates, but
// still benefits from conditional 304s via ETag).
function sendBuffer(res, statusCode, contentType, buffer, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {});

  const acceptEncoding = String(res.req.headers['accept-encoding'] || '');
  const typeBase = String(contentType).split(';')[0];
  if (buffer.length > 860 && GZIP_TYPES.has(typeBase) && /\bgzip\b/.test(acceptEncoding)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(statusCode, headers);
    res.end(zlib.gzipSync(buffer));
  } else {
    if (GZIP_TYPES.has(typeBase)) headers['Vary'] = 'Accept-Encoding';
    res.writeHead(statusCode, headers);
    res.end(buffer);
  }
}

// Serve static files (css/js/images) from /public, with a conservative
// allow-list and path traversal protection.
function handleStatic(res, pathname) {
  const ext = path.extname(pathname).toLowerCase();
  const contentType = STATIC_TYPES[ext];
  if (!contentType) return false;

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return true;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }
    sendBuffer(res, 200, contentType, data);
  });
  return true;
}

function handleRequest(req, res) {
  const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = reqUrl.pathname;
  const searchParams = reqUrl.searchParams;

  if (pathname === '/' || pathname === '/index.html') {
    sendBuffer(res, 200, 'text/html; charset=utf-8', Buffer.from(ui.renderHtmlPage(config)));
    return;
  }

  if (handleStatic(res, pathname)) return;

  if (pathname === '/api/stats') {
    resolveRequestConfig(searchParams)
      .then(requestConfig => getMetrics(requestConfig.coin, requestConfig.wallet))
      .then(data => {
        sendBuffer(res, 200, 'application/json', Buffer.from(JSON.stringify(data)), {
          'Access-Control-Allow-Origin': '*'
        });
      })
      .catch(err => {
        sendError(res, err);
      });
    return;
  }

  if (pathname === '/api/stream') {
    resolveRequestConfig(searchParams)
      .then(async requestConfig => {
        const feed = getFeed(requestConfig.coin, requestConfig.wallet);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write('retry: 15000\n\n');

        const clientObj = { res, key: feed.key };
        let closed = false;

        req.on('close', () => {
          closed = true;
          sseClients = sseClients.filter(c => c.res !== res);
        });

        // Immediate first snapshot; the interval ticker handles the rest.
        // The client is attached only after the first push so a broadcast
        // racing the initial refresh can't deliver a duplicate.
        try {
          const data = await getMetrics(feed.coin, feed.wallet);
          if (closed || res.destroyed || res.writableEnded) return;
          res.write('data: ' + JSON.stringify(data) + '\n\n');
          sseClients.push(clientObj);
        } catch (err) {
          try {
            res.write('event: error\ndata: ' + JSON.stringify({ error: 'snapshot failed' }) + '\n\n');
          } catch (ignored) {}
        }
      })
      .catch(err => {
        sendError(res, err);
      });
    return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (pathname === '/api/debug/woolypooly') {
    handleDebugWoolypooly(req, res, searchParams);
    return;
  }

  if (pathname === '/api/debug/history') {
    handleDebugHistory(req, res, searchParams);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// Single shared ticker: one upstream refresh per watched wallet per interval,
// broadcast to all its viewers. Idle feeds are pruned.
setInterval(() => {
  const now = Date.now();
  const activeKeys = new Set(sseClients.map(c => c.key));
  for (const [key, feed] of feeds) {
    if (activeKeys.has(key)) {
      refreshFeed(feed).catch(() => {});
    } else if (now - feed.updatedAt > FEED_PRUNE_MS) {
      feeds.delete(key);
    }
  }
}, config.REFRESH_INTERVAL_MS);

// Comment heartbeat so proxies/NAT don't silently kill idle streams.
setInterval(() => {
  sseClients.forEach(client => {
    try {
      client.res.write(': ping\n\n');
    } catch (err) {}
  });
}, HEARTBEAT_MS);

module.exports = {
  handleRequest
};
