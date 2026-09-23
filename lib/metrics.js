function formatHashrate(hashesPerSec) {
  const n = (typeof hashesPerSec === 'number' && isFinite(hashesPerSec)) ? hashesPerSec : 0;
  if (n <= 0) return { val: '0.00', unit: 'H/s', formatted: '0.00 H/s' };
  if (n >= 1e12) return { val: (n / 1e12).toFixed(2), unit: 'TH/s', formatted: (n / 1e12).toFixed(2) + ' TH/s' };
  if (n >= 1e9) return { val: (n / 1e9).toFixed(2), unit: 'GH/s', formatted: (n / 1e9).toFixed(2) + ' GH/s' };
  if (n >= 1e6) return { val: (n / 1e6).toFixed(2), unit: 'MH/s', formatted: (n / 1e6).toFixed(2) + ' MH/s' };
  if (n >= 1e3) return { val: (n / 1e3).toFixed(2), unit: 'kH/s', formatted: (n / 1e3).toFixed(2) + ' kH/s' };
  return { val: n.toFixed(2), unit: 'H/s', formatted: n.toFixed(2) + ' H/s' };
}

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

function deltaStatus(apiVal, obsVal) {
  if (!(apiVal > 0)) return '—';
  const pct = ((obsVal - apiVal) / apiVal) * 100;
  if (Math.abs(pct) <= 5) return 'Within 5%';
  return 'Outside 5%';
}

function deltaPct(apiVal, obsVal) {
  if (!(apiVal > 0)) return null;
  return ((obsVal - apiVal) / apiVal) * 100;
}

function extractPool(poolStats, hasPool) {
  if (!hasPool) {
    return {
      minPay: null, feePct: null, difficulty: null, height: null,
      netHashrate: null, blockTime: null, blockReward: null,
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
    feePct: pick(s.fee),
    difficulty: pick(s.difficulty),
    height: pick(s.height),
    netHashrate: pick(s.netHashrate),
    blockTime: pick(s.blockTime),
    blockReward: pick(s.blockReward),
    merge: Array.isArray(s.merge) ? s.merge : [],
    poolEffortPct: pplns.effort != null && isFinite(pplns.effort) ? pplns.effort * 100 : null,
    poolHashrate: pick(algo.hashrate),
    poolMiners: pick(algo.minersTotal)
  };
}

function processMetrics(rawData, coinId, wallet, estimate) {
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

  const userEffortPct = (Array.isArray(stats.effort) && stats.effort.length > 0 && stats.effort[0].rate != null)
    ? num(stats.effort[0].rate) * 100 : null;

  const balance = num(stats.balance);
  const immature = num(stats.immature_balance);
  const paid = num(stats.paid);
  const todayPaid = num(stats.todayPaid);

  const buckets = (Array.isArray(stats.minerProfitGraph) ? stats.minerProfitGraph : [])
    .slice()
    .sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0));

  const est = estimate || {};
  const estHour = num(est.perHour);
  const est12h = num(est.per12h);
  const estDay = num(est.perDay);
  const estWeek = num(est.perWeek);
  const estMonth = num(est.perMonth);
  const estAvail = !!est.available;

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
  const ratePerHour = estHour > 0 ? estHour : 0;
  const remaining = minPay != null ? Math.max(0, minPay - balance) : null;
  const etaHours = (minPay != null && remaining > 0 && ratePerHour > 0) ? remaining / ratePerHour : null;

  function row(label, apiVal, estVal, avail) {
    let deltaStr = null;
    let status = '—';
    if (avail && apiVal != null) {
      const pct = deltaPct(apiVal, estVal);
      const d = estVal - apiVal;
      deltaStr = d.toFixed(4) + ' ' + ticker + (pct != null ? ' (' + (d >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : '');
      status = deltaStatus(apiVal, estVal);
    } else if (!avail && apiVal != null) {
      status = 'Insufficient data';
    }
    return {
      label,
      api: apiVal != null ? fmtCoin(apiVal, ticker) : 'N/A',
      estimated: avail ? fmtCoin(estVal, ticker) : 'N/A — insuff. data',
      delta: deltaStr,
      status
    };
  }

  const comparisons = [
    row('Hourly', rawIncome.hour, estHour, estAvail),
    row('12h', rawIncome.halfDay, est12h, estAvail),
    row('24h', rawIncome.day, estDay, estAvail),
    row('7d', rawIncome.week, estWeek, estAvail),
    row('30d', rawIncome.month, estMonth, estAvail)
  ];

  const apiVsEst24 = deltaPct(rawIncome.day, estDay);
  const summaryStatus = (estAvail && rawIncome.day > 0)
    ? (Math.abs(apiVsEst24) <= 5 ? 'Estimated 24h: Within 5% of API 24h' : 'Estimated 24h: Outside 5% of API 24h')
    : 'Estimated 24h: insufficient data';

  return {
    coinId,
    coinTicker: ticker,
    wallet,
    timestamp: Date.now(),
    usdPrice,
    api: {
      account: {
        balance,
        immatureBalance: immature,
        paid,
        todayPaid,
        income: rawIncome,
        hashrate: rawHash,
        userEffortPct,
        workerCounts: {
          online: (accountOk && accountStats.workersOnline != null) ? num(accountStats.workersOnline) : workers.filter(w => !w.offline).length,
          total: (accountOk && accountStats.workersTotal != null) ? num(accountStats.workersTotal) : workers.length,
          offline: (accountOk && accountStats.workersOffline != null) ? num(accountStats.workersOffline) : workers.filter(w => w.offline).length
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
      windowBuckets: Math.floor(num(est.windowBuckets)),
      windowIncome: num(est.windowIncome),
      windowHours: Math.floor(num(est.windowHours)),
      available: estAvail
    },
    payout: {
      threshold: minPay,
      configuredThreshold,
      poolMinPay: minPayFromApi,
      remaining,
      ratePerHour,
      rateSource: 'Estimated rate from trailing 24h',
      etaHours
    },
    analytics: {
      apiVsEstimated24hPct: apiVsEst24,
      summary: summaryStatus,
      comparisons
    },
    workers,
    payments,
    profitGraph: buckets
  };
}

module.exports = {
  formatHashrate,
  coinTicker,
  processMetrics,
  deltaStatus,
  deltaPct
};
