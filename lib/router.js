const config = require('./config');
const woolypooly = require('./woolypooly');
const metrics = require('./metrics');
const ui = require('./ui');

const HEARTBEAT_MS = 15000;
const FEED_PRUNE_MS = 10 * 60 * 1000;

let sseClients = []; // { res, key }
const feeds = new Map(); // key -> { key, coin, wallet, data, updatedAt, okAt, error, inFlight }

function getEmptyAccountStats() {
  return {
    stats: {
      balance: 0,
      immature_balance: 0,
      paid: 0,
      todayPaid: 0,
      income: {
        income_Hour: 0,
        income_HalfDay: 0,
        income_Day: 0,
        income_Week: 0,
        income_Month: 0
      },
      minerProfitGraph: []
    },
    payments: [],
    workers: [],
    workersTotal: 0,
    workersOnline: 0,
    workersOffline: 0
  };
}

function defaultPoolStats() {
  return {
    minPay: 1.0,
    fee: 0.9,
    difficulty: 0,
    netHashrate: 1,
    blockTime: 150,
    blockReward: 1,
    modes: []
  };
}

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

// All three upstream calls run concurrently. Individual failures are captured
// per-source instead of rejecting, so one bad endpoint can't kill the others.
async function fetchSnapshot(coin, wallet) {
  const [usdPrice, poolResult, accountResult] = await Promise.all([
    woolypooly.getCoinUsdPrice(coin),
    woolypooly.fetchPoolStats(coin).then(
      data => ({ ok: true, data }),
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

      if (poolOk && accountOk) {
        feed.data = metrics.processMetrics(
          { poolStats: snapshot.poolResult.data, accountStats: snapshot.accountResult.data, usdPrice: snapshot.usdPrice },
          feed.coin,
          feed.wallet
        );
        feed.data.stale = false;
        feed.data.sources = { pool: true, account: true };
        feed.okAt = Date.now();
        feed.error = null;
      } else if (!feed.data) {
        feed.data = metrics.processMetrics(
          {
            poolStats: poolOk ? snapshot.poolResult.data : defaultPoolStats(),
            accountStats: accountOk ? snapshot.accountResult.data : getEmptyAccountStats(),
            usdPrice: snapshot.usdPrice
          },
          feed.coin,
          feed.wallet
        );
        feed.data.stale = true;
        feed.data.sources = { pool: poolOk, account: accountOk };
        feed.error = [snapshot.poolResult.error, snapshot.accountResult.error].filter(Boolean).join('; ');
        feed.data.error = feed.error;
      } else {
        feed.data.stale = true;
        feed.error = [snapshot.poolResult.error, snapshot.accountResult.error].filter(Boolean).join('; ');
        feed.data.error = feed.error;
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
  return { coin, wallet };
}

function sendError(res, err) {
  const statusCode = err.statusCode || 500;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: err.message }));
}

function handleRequest(req, res) {
  const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = reqUrl.pathname;
  const searchParams = reqUrl.searchParams;

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ui.renderHtmlPage(config));
    return;
  }

  if (pathname === '/api/stats') {
    resolveRequestConfig(searchParams)
      .then(requestConfig => getMetrics(requestConfig.coin, requestConfig.wallet))
      .then(data => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(data));
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
