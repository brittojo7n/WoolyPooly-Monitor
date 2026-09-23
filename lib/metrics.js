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

function processMetrics(rawData, coinId, wallet, history) {
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

  const sumBuckets = (n) => buckets.slice(-n).reduce((s, x) => s + num(x.amount), 0);
  const observedHour = buckets.length ? num(buckets[buckets.length - 1].amount) : 0;
  const observed6h = sumBuckets(6);
  const observed12h = sumBuckets(12);
  const observed24h = sumBuckets(24);

  const hist = history && history.observed ? history.observed : {};
  function win(key) {
    const w = hist[key];
    return w || { value: 0, available: false };
  }
  const observed7d = win('7d');
  const observed30d = win('30d');
  const historyAgeMs = (history && history.ageMs) || 0;

  const cumulative = paid + balance + immature;

  const apiDay = rawIncome.day;
  const projectedHourly = apiDay / 24;
  const projectedWeekly = apiDay * 7;
  const projectedMonthly = apiDay * 30;

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
  const ratePerHour = apiDay > 0 ? apiDay / 24 : 0;
  const remaining = minPay != null ? Math.max(0, minPay - balance) : null;
  const etaHours = (minPay != null && remaining > 0 && ratePerHour > 0) ? remaining / ratePerHour : null;

  function row(label, apiVal, obsVal, obsAvail, projVal) {
    let deltaStr = null;
    let status = '—';
    if (obsAvail && apiVal != null) {
      const pct = deltaPct(apiVal, obsVal);
      const d = obsVal - apiVal;
      deltaStr = d.toFixed(4) + ' ' + ticker + (pct != null ? ' (' + (d >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : '');
      status = deltaStatus(apiVal, obsVal);
    } else if (!obsAvail && apiVal != null) {
      status = 'Insufficient history';
    }
    return {
      label,
      api: apiVal != null ? fmtCoin(apiVal, ticker) : 'N/A',
      observed: obsAvail ? fmtCoin(obsVal, ticker) : 'N/A — insuff. history',
      projected: projVal != null ? fmtCoin(projVal, ticker) : null,
      delta: deltaStr,
      status
    };
  }

  const obs7dAvail = !!(observed7d.available && historyAgeMs >= 7 * 24 * 3600 * 1000);
  const obs30dAvail = !!(observed30d.available && historyAgeMs >= 30 * 24 * 3600 * 1000);

  const comparisons = [
    row('Hourly', rawIncome.hour, observedHour, buckets.length > 0, null),
    row('12h', rawIncome.halfDay, observed12h, buckets.length >= 12, null),
    row('24h', rawIncome.day, observed24h, buckets.length >= 24, null),
    row('7d', rawIncome.week, observed7d.value, obs7dAvail, projectedWeekly),
    row('30d', rawIncome.month, observed30d.value, obs30dAvail, projectedMonthly)
  ];

  const apiVsObs24 = deltaPct(rawIncome.day, observed24h);
  const summaryStatus = (buckets.length >= 24 && rawIncome.day > 0)
    ? (Math.abs(apiVsObs24) <= 5 ? 'Observed 24h: Within 5% of API 24h' : 'Observed 24h: Outside 5% of API 24h')
    : 'Observed 24h: insufficient history';

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
    observed: {
      earnings: {
        hour: observedHour,
        sixH: observed6h,
        twelveH: observed12h,
        twentyFourH: observed24h
      },
      cumulative: {
        balance,
        immature,
        paid,
        total: cumulative
      },
      windows: {
        '7d': observed7d,
        '30d': observed30d
      },
      historyAgeMs,
      historyDays: historyAgeMs / (24 * 3600 * 1000)
    },
    projected: {
      hourly: projectedHourly,
      weekly: projectedWeekly,
      monthly: projectedMonthly,
      basedOn: 'WoolyPooly API 24h'
    },
    payout: {
      threshold: minPay,
      configuredThreshold,
      poolMinPay: minPayFromApi,
      remaining,
      ratePerHour,
      rateSource: 'WoolyPooly API 24h income ÷ 24',
      etaHours
    },
    analytics: {
      apiVsObserved24hPct: apiVsObs24,
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
