const estimator = require('./estimator');

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}

function coinTicker(coinId) {
  return String(coinId || '').split('-')[0].toUpperCase() || '???';
}

function fmtCoin(v, ticker, dp) {
  const n = num(v);
  return n.toFixed(dp == null ? 4 : dp) + ' ' + ticker;
}

function deltaPct(apiVal, obsVal) {
  if (!(apiVal > 0)) return null;
  return ((obsVal - apiVal) / apiVal) * 100;
}

function effortPctOf(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return (isFinite(n) && n >= 0) ? n * 100 : null;
}

function effortModeOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const s = String(entry.mode || entry.payoutScheme || entry.scheme || entry.name || '').toLowerCase();
  if (s.indexOf('solo') !== -1) return 'solo';
  if (s.indexOf('pplns') !== -1) return 'pplns';
  return null;
}

function splitEffort(src) {
  const out = { pplns: null, solo: null };
  if (src != null && !Array.isArray(src) && typeof src === 'object') {
    for (const k of ['pplns', 'solo']) {
      const v = src[k];
      out[k] = (v != null && typeof v === 'object') ? effortPctOf(v.rate) : effortPctOf(v);
    }
    return out;
  }
  const list = Array.isArray(src) ? src : [];
  const vals = [];
  for (const e of list) {
    const pct = (e != null && typeof e === 'object') ? effortPctOf(e.rate) : effortPctOf(e);
    if (pct != null) vals.push({ m: effortModeOf(e), pct });
  }
  if (!vals.some(v => v.m)) {
    if (vals[0]) out.pplns = vals[0].pct;
    if (vals[1]) out.solo = vals[1].pct;
    return out;
  }
  const rest = [];
  for (const v of vals) {
    if (v.m && out[v.m] == null) out[v.m] = v.pct;
    else rest.push(v.pct);
  }
  for (const pct of rest) {
    if (out.pplns == null) out.pplns = pct;
    else if (out.solo == null) out.solo = pct;
  }
  return out;
}

function extractPool(poolStats, hasPool) {
  if (!hasPool) {
    return {
      minPay: null, difficulty: null, height: null,
      netHashrate: null, blockReward: null,
      merge: [],
      poolEffortPct: null, poolHashrate: null, poolMiners: null
    };
  }
  const s = poolStats || {};
  const pplns = (Array.isArray(s.modes) ? s.modes : []).find(m => String(m.payoutScheme).toUpperCase() === 'PPLNS')
    || (Array.isArray(s.modes) ? s.modes[0] : undefined) || {};
  const algo = pplns.algo_stats && pplns.algo_stats.default ? pplns.algo_stats.default : {};
  const pick = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
  return {
    minPay: pick(s.minPay),
    difficulty: pick(s.difficulty),
    height: pick(s.height),
    netHashrate: pick(s.netHashrate),
    blockReward: pick(s.blockReward),
    merge: Array.isArray(s.merge) ? s.merge : [],
    poolEffortPct: pplns.effort != null && isFinite(pplns.effort) ? pplns.effort * 100 : null,
    poolHashrate: pick(algo.hashrate),
    poolMiners: pick(algo.minersTotal)
  };
}

function processMetrics(rawData, coinId, wallet, estimate) {
  const now = Number.isFinite(rawData.snapshotAt) ? rawData.snapshotAt : Date.now();
  const poolOk = !!(rawData.poolOk);
  const accountOk = !!(rawData.accountOk);
  const poolStats = rawData.poolStats;
  const accountStats = rawData.accountStats;
  const usdPrice = num(rawData.usdPrice);
  const ticker = coinTicker(coinId);

  const pool = extractPool(poolStats, poolOk);

  const stats = (accountStats && accountStats.stats) || {};
  const workers = (accountOk && Array.isArray(accountStats.workers)) ? accountStats.workers : [];
  const payments = (accountOk && Array.isArray(accountStats.payments)) ? accountStats.payments : [];

  const income = (stats.income) || {};
  const rawIncome = {
    hour: num(income.income_Hour),
    halfDay: num(income.income_HalfDay),
    day: num(income.income_Day),
    week: num(income.income_Week),
    month: num(income.income_Month)
  };

  const modeStats = (accountStats && accountStats.mode_stats && accountStats.mode_stats.pplns && accountStats.mode_stats.pplns.default) || {};
  const rawHash = {
    current: num(modeStats.currentHashrate),
    sixH: num(modeStats.hashrate),
    day: num(modeStats.dayHashrate)
  };

  const effort = splitEffort(stats.effort);

  const balance = num(stats.balance);
  const immature = num(stats.immature_balance);
  const paid = num(stats.paid);
  const todayPaid = num(stats.todayPaid);

  const buckets = [];
  const graph = Array.isArray(stats.minerProfitGraph) ? stats.minerProfitGraph : [];
  for (const b of graph) {
    if (!b || typeof b !== 'object') continue;
    buckets.push({ created: b.created, amount: b.amount, participation: b.participation });
  }
  buckets.sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0));

  const est = estimate || {};
  const estHour = num(est.perHour);
  const est12h = num(est.per12h);
  const estDay = num(est.perDay);
  const estWeek = num(est.perWeek);
  const estMonth = num(est.perMonth);
  const estAvail = !!est.available;
  const hourlyGraph = accountOk
    ? (Array.isArray(est.hourlyGraph) ? est.hourlyGraph : estimator.buildHourlyGraph(graph, now))
    : [];

  const minPayFromApi = pool.minPay;
  const configuredThreshold = (rawData.payoutThreshold != null && isFinite(rawData.payoutThreshold) && rawData.payoutThreshold > 0)
    ? rawData.payoutThreshold
    : null;
  let minPay = null;
  if (minPayFromApi != null && configuredThreshold != null) {
    minPay = Math.max(minPayFromApi, configuredThreshold);
  } else if (minPayFromApi != null) {
    minPay = minPayFromApi;
  } else if (configuredThreshold != null) {
    minPay = configuredThreshold;
  }
  const ratePerHour = estAvail && estHour > 0 ? estHour : null;
  const remaining = minPay != null ? Math.max(0, minPay - balance) : null;

  function row(label, apiVal, estVal, avail) {
    let deltaStr = null;
    if (avail && apiVal != null) {
      const pct = deltaPct(apiVal, estVal);
      if (pct != null) deltaStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    }
    return {
      label,
      api: apiVal != null ? fmtCoin(apiVal, ticker) : 'N/A',
      estimated: avail ? fmtCoin(estVal, ticker) : 'N/A',
      delta: deltaStr
    };
  }

  const comparisons = [
    row('Hourly', rawIncome.hour, estHour, estAvail),
    row('12h', rawIncome.halfDay, est12h, estAvail),
    row('24h', rawIncome.day, estDay, estAvail),
    row('7d', rawIncome.week, estWeek, estAvail),
    row('30d', rawIncome.month, estMonth, estAvail)
  ];

  return {
    coinId,
    coinTicker: ticker,
    wallet,
    timestamp: now,
    usdPrice,
    api: {
      account: {
        balance,
        immatureBalance: immature,
        paid,
        todayPaid,
        income: rawIncome,
        hashrate: rawHash,
        effort,
        workerCounts: {
          online: (accountOk && accountStats.workersOnline != null) ? num(accountStats.workersOnline) : workers.filter(w => !w.offline).length,
          total: (accountOk && accountStats.workersTotal != null) ? num(accountStats.workersTotal) : workers.length
        }
      },
      pool
    },
    estimated: {
      perHour: estHour,
      per12h: est12h,
      perDay: estDay,
      perWeek: estWeek,
      perMonth: estMonth,
      available: estAvail,
      status: est.status || 'unknown',
      confidence: est.confidence || null,
      observed24h: num(est.observed24h),
      reportedHours: est.reportedHours || 0,
      missingHours: est.missingHours || 0,
      sampleHours: est.sampleHours || 0,
      spanHours: est.spanHours || 0,
      lastReportedAt: est.lastReportedAt || null
    },
    payout: {
      threshold: minPay,
      remaining,
      ratePerHour,
    },
    comparisons,
    workers,
    payments,
    profitGraph: buckets,
    hourlyGraph
  };
}

module.exports = {
  processMetrics
};
