const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const config = require('../utils/config');
const woolypooly = require('../api/client');
const metrics = require('../api/metrics');
const ui = require('./ui');
const estimator = require('../api/estimator');
const limiter = require('./limiter');

const HEARTBEAT_MS = 15000;
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'web');

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

let sseClients = [];
const feeds = new Map();

function feedKey(coin, wallet) {
  return String(coin).toLowerCase() + '|' + String(wallet).toLowerCase();
}

function getFeed(coin, wallet) {
  const key = feedKey(coin, wallet);
  let feed = feeds.get(key);
  if (!feed) {
    feed = { key, coin, wallet, data: null, updatedAt: 0, inFlight: null };
    feeds.set(key, feed);
  }
  return feed;
}

async function fetchSnapshot(coin, wallet) {
  const [usdPrice, poolResult, accountResult] = await Promise.all([
    woolypooly.getCoinUsdPrice(coin),
    woolypooly.fetchPoolStats(coin).then(
      data => (data && typeof data === 'object' ? { ok: true, data } : { ok: false }),
      () => ({ ok: false })
    ),
    woolypooly.fetchAccountStats(coin, wallet).then(
      data => (data && data.stats ? { ok: true, data } : { ok: false }),
      () => ({ ok: false })
    )
  ]);
  return { usdPrice, poolResult, accountResult };
}

function estimateDay(accountStats, now) {
  const graph = accountStats && accountStats.stats ? accountStats.stats.minerProfitGraph : null;
  let onlineWorkers = null;
  if (accountStats) {
    if (accountStats.workersOnline != null && Number.isFinite(Number(accountStats.workersOnline))) {
      onlineWorkers = Number(accountStats.workersOnline);
    } else if (Array.isArray(accountStats.workers)) {
      onlineWorkers = accountStats.workers.filter(w => w && !w.offline).length;
    } else {
      const modeObj = accountStats.mode_stats && (
        (accountStats.mode_stats.pplns && (accountStats.mode_stats.pplns.default || Object.values(accountStats.mode_stats.pplns)[0])) ||
        (accountStats.mode_stats.solo && (accountStats.mode_stats.solo.default || Object.values(accountStats.mode_stats.solo)[0]))
      );
      const current = modeObj && modeObj.currentHashrate;
      if (Number(current) > 0) onlineWorkers = 1;
    }
  }
  return estimator.estimateRollingDay(graph, now, { onlineWorkers });
}

function processFeedSnapshot(snapshot, coin, wallet) {
  const poolOk = snapshot.poolResult.ok;
  const accountOk = snapshot.accountResult.ok;
  const now = Date.now();

  const estimate = estimateDay(accountOk ? snapshot.accountResult.data : null, now);

  return metrics.processMetrics(
    {
      poolStats: poolOk ? snapshot.poolResult.data : null,
      accountStats: accountOk ? snapshot.accountResult.data : null,
      usdPrice: snapshot.usdPrice,
      poolOk,
      accountOk,
      snapshotAt: now,
      payoutThreshold: config.PAYOUT_THRESHOLD
    },
    coin,
    wallet,
    estimate
  );
}

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
      } else if (!prev) {
        feed.data = processFeedSnapshot(snapshot, feed.coin, feed.wallet);
        feed.data.stale = true;
      } else {
        feed.data.stale = true;
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

const GZIP_TYPES = new Set(['text/html', 'text/css', 'text/javascript', 'application/json', 'image/svg+xml']);
const staticCache = new Map();
const gzipCache = new Map();

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
    const clientIp = limiter.getClientIp(req);
    const limit = limiter.checkRateLimit(clientIp);
    if (!limit.allowed) {
      setTimeout(() => {
        sendBuffer(res, 200, 'text/html; charset=utf-8', Buffer.from(ui.renderHtmlPage(config)));
      }, limit.waitMs);
      return;
    }
    sendBuffer(res, 200, 'text/html; charset=utf-8', Buffer.from(ui.renderHtmlPage(config)));
    return;
  }

  if (handleStatic(res, pathname)) return;

  if (pathname === '/api/stats') {
    const clientIp = limiter.getClientIp(req);
    const limit = limiter.checkRateLimit(clientIp);
    if (!limit.allowed) {
      setTimeout(() => {
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
      }, limit.waitMs);
      return;
    }
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

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

setInterval(() => {
  if (sseClients.length === 0 && feeds.size === 0) return;
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

setInterval(() => {
  if (sseClients.length === 0) return;
  sseClients.forEach(client => {
    try {
      client.res.write(': ping\n\n');
    } catch (err) {}
  });
}, HEARTBEAT_MS);

module.exports = {
  handleRequest
};
