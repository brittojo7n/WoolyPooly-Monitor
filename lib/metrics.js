function formatHashrate(hashesPerSec) {
  if (!hashesPerSec || hashesPerSec <= 0) return { val: '0.00', unit: 'H/s', formatted: '0.00 H/s' };
  if (hashesPerSec >= 1e12) return { val: (hashesPerSec / 1e12).toFixed(2), unit: 'TH/s', formatted: (hashesPerSec / 1e12).toFixed(2) + ' TH/s' };
  if (hashesPerSec >= 1e9) return { val: (hashesPerSec / 1e9).toFixed(2), unit: 'GH/s', formatted: (hashesPerSec / 1e9).toFixed(2) + ' GH/s' };
  if (hashesPerSec >= 1e6) return { val: (hashesPerSec / 1e6).toFixed(2), unit: 'MH/s', formatted: (hashesPerSec / 1e6).toFixed(2) + ' MH/s' };
  if (hashesPerSec >= 1e3) return { val: (hashesPerSec / 1e3).toFixed(2), unit: 'KH/s', formatted: (hashesPerSec / 1e3).toFixed(2) + ' KH/s' };
  return { val: hashesPerSec.toFixed(2), unit: 'H/s', formatted: hashesPerSec.toFixed(2) + ' H/s' };
}

function processMetrics(rawData, coinId, wallet) {
  const { poolStats, accountStats, usdPrice } = rawData;
  const coinTicker = coinId.split('-')[0].toUpperCase();

  const stats = accountStats.stats || {};
  const workers = accountStats.workers || [];
  const payments = accountStats.payments || [];
  const profitGraph = stats.minerProfitGraph || [];

  const netHashrate = poolStats.netHashrate || 1;
  const blockReward = poolStats.blockReward || 1;
  const blockTime = poolStats.blockTime || 150;
  const poolFeePct = poolStats.fee || 0.9;
  const minPay = poolStats.minPay || 1.0;
  const height = poolStats.height || 0;
  const difficulty = poolStats.difficulty || 0;

  const pplnsMode = (poolStats.modes || []).find(m => String(m.payoutScheme).toUpperCase() === 'PPLNS') || poolStats.modes?.[0] || {};
  const poolEffort = pplnsMode.effort != null ? pplnsMode.effort : 0;
  const poolEffortPct = poolEffort * 100;
  const poolHashrate = pplnsMode.algo_stats?.default?.hashrate || 0;
  const poolMiners = pplnsMode.algo_stats?.default?.minersTotal || 0;

  const userEffortRate = stats.effort?.[0]?.rate != null ? stats.effort[0].rate : 0;
  const userEffortPct = userEffortRate * 100;

  const currentHr = workers.reduce((sum, w) => sum + (w.hr || 0), 0);
  const avgHr6h = workers.reduce((sum, w) => sum + (w.hr2 || 0), 0);
  const avgHr24h = workers.reduce((sum, w) => sum + (w.hr3 || 0), 0);

  const formattedCurrentHr = formatHashrate(currentHr);
  const formattedAvg6hHr = formatHashrate(avgHr6h);
  const formattedAvg24hHr = formatHashrate(avgHr24h);
  const formattedNetHr = formatHashrate(netHashrate);
  const formattedPoolHr = formatHashrate(poolHashrate);

  const dailyNetworkBlocks = 86400 / blockTime;
  const dailyNetworkCoins = dailyNetworkBlocks * blockReward;

  const theoreticalDailyCoins = (avgHr24h / netHashrate) * dailyNetworkCoins * (1 - poolFeePct / 100);
  const theoreticalHourlyCoins = theoreticalDailyCoins / 24;

  const actual24hCoins = profitGraph.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const actual6hCoins = profitGraph.slice(-6).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const actual1hCoins = profitGraph.length > 0 ? (parseFloat(profitGraph[profitGraph.length - 1].amount) || 0) : 0;

  const actual6hHourlyAvg = actual6hCoins / Math.min(profitGraph.length, 6);
  const actual24hHourlyAvg = actual24hCoins / Math.min(profitGraph.length, 24);

  let ewmaVelocity = actual1hCoins;
  const alpha = 0.25;
  profitGraph.forEach(item => {
    const val = parseFloat(item.amount) || 0;
    ewmaVelocity = alpha * val + (1 - alpha) * ewmaVelocity;
  });

  const nativeIncome = stats.income || {};
  const nativeHour = parseFloat(nativeIncome.income_Hour) || 0;
  const nativeDay = parseFloat(nativeIncome.income_Day) || 0;
  const nativeWeek = parseFloat(nativeIncome.income_Week) || 0;
  const nativeMonth = parseFloat(nativeIncome.income_Month) || 0;

  const unpaidBalance = parseFloat(stats.balance) || 0;
  const immatureBalance = parseFloat(stats.immature_balance) || 0;
  const totalPaid = parseFloat(stats.paid) || 0;
  const todayPaid = parseFloat(stats.todayPaid) || 0;

  const remainingForPayout = Math.max(0, minPay - unpaidBalance);
  const hourlyRateForPayout = actual24hHourlyAvg > 0 ? actual24hHourlyAvg : theoreticalHourlyCoins;
  const hoursToPayout = hourlyRateForPayout > 0 ? (remainingForPayout / hourlyRateForPayout) : 0;

  const hrBaseUnit = avgHr24h > 0 ? avgHr24h : 1;
  const actualYieldPerBaseUnitDay = (actual24hCoins / hrBaseUnit) * 1e6;
  const theoreticalYieldPerBaseUnitDay = ((dailyNetworkCoins * (1 - poolFeePct / 100)) / netHashrate) * 1e6;

  const apiEstimationEfficiency = nativeDay > 0 ? ((actual24hCoins / nativeDay) * 100) : 100;
  const poolLuckRealizedPct = theoreticalDailyCoins > 0 ? ((actual24hCoins / theoreticalDailyCoins) * 100) : 100;
  const hashrateStabilityPct = avgHr24h > 0 ? ((currentHr / avgHr24h) * 100) : 100;

  let discrepancyInsight = '';
  const diffPct = Math.abs(apiEstimationEfficiency - 100);
  if (diffPct < 5) {
    discrepancyInsight = 'API and actual align.';
  } else if (apiEstimationEfficiency > 100) {
    discrepancyInsight = 'Actual above API.';
  } else {
    discrepancyInsight = 'Actual below API.';
  }

  const formatCoinUsd = (amt) => `${amt.toFixed(4)} ${coinTicker} ($${(amt * usdPrice).toFixed(2)})`;

  const comparisons = [
    {
      metric: 'Hourly',
      apiNative: formatCoinUsd(nativeHour),
      calculatedActual: formatCoinUsd(actual1hCoins) + ' (Now)',
      calculatedTheoretical: formatCoinUsd(theoreticalHourlyCoins) + ' (Theory)',
      variance: (actual1hCoins - nativeHour).toFixed(4) + ' ' + coinTicker,
      status: actual1hCoins >= nativeHour ? 'Good' : 'Low'
    },
    {
      metric: `Daily (${coinTicker})`,
      apiNative: formatCoinUsd(nativeDay),
      calculatedActual: formatCoinUsd(actual24hCoins) + ' (24h)',
      calculatedTheoretical: formatCoinUsd(theoreticalDailyCoins) + ' (Theory)',
      variance: (actual24hCoins - nativeDay).toFixed(4) + ' ' + coinTicker + ' (' + apiEstimationEfficiency.toFixed(1) + '%)',
      status: Math.abs(apiEstimationEfficiency - 100) < 10 ? 'Good' : (apiEstimationEfficiency > 100 ? 'High' : 'Low')
    },
    {
      metric: `Weekly (${coinTicker})`,
      apiNative: formatCoinUsd(nativeWeek),
      calculatedActual: formatCoinUsd(actual24hCoins * 7) + ' (24h)',
      calculatedTheoretical: formatCoinUsd(theoreticalDailyCoins * 7) + ' (Theory)',
      variance: ((actual24hCoins * 7) - nativeWeek).toFixed(2) + ' ' + coinTicker,
      status: 'Est.'
    },
    {
      metric: `Monthly (${coinTicker})`,
      apiNative: formatCoinUsd(nativeMonth),
      calculatedActual: formatCoinUsd(actual24hCoins * 30) + ' (24h)',
      calculatedTheoretical: formatCoinUsd(theoreticalDailyCoins * 30) + ' (Theory)',
      variance: ((actual24hCoins * 30) - nativeMonth).toFixed(2) + ' ' + coinTicker,
      status: 'Est.'
    },
    {
      metric: `Yield (${coinTicker})`,
      apiNative: 'N/A',
      calculatedActual: actualYieldPerBaseUnitDay.toFixed(4) + ' ' + coinTicker + '/MH',
      calculatedTheoretical: theoreticalYieldPerBaseUnitDay.toFixed(4) + ' ' + coinTicker + '/MH',
      variance: (actualYieldPerBaseUnitDay - theoreticalYieldPerBaseUnitDay).toFixed(4) + ' ' + coinTicker + '/MH',
      status: poolLuckRealizedPct >= 100 ? 'High' : 'Med.'
    }
  ];

  return {
    coinId,
    coinTicker,
    wallet,
    timestamp: Date.now(),
    usdPrice,
    poolStats: {
      netHashrate,
      formattedNetHr: formattedNetHr.formatted,
      poolHashrate,
      formattedPoolHr: formattedPoolHr.formatted,
      difficulty,
      height,
      blockReward,
      blockTime,
      poolFeePct,
      minPay,
      poolEffortPct,
      userEffortPct,
      poolMiners,
      workersTotal: accountStats.workersTotal || workers.length,
      workersOnline: accountStats.workersOnline || workers.filter(w => !w.offline).length,
      workersOffline: accountStats.workersOffline || workers.filter(w => w.offline).length,
      matureCount: accountStats.mature_count || (accountStats.mature_blocks ? accountStats.mature_blocks.length : 0),
      immatureCount: accountStats.immature_count || (accountStats.immature_blocks ? accountStats.immature_blocks.length : 0)
    },
    balances: {
      unpaidBalance,
      unpaidUsd: unpaidBalance * usdPrice,
      immatureBalance,
      immatureUsd: immatureBalance * usdPrice,
      totalPaid,
      totalPaidUsd: totalPaid * usdPrice,
      todayPaid
    },
    hashrate: {
      currentHr,
      formattedCurrentHr: formattedCurrentHr.formatted,
      avgHr6h,
      formattedAvg6hHr: formattedAvg6hHr.formatted,
      avgHr24h,
      formattedAvg24hHr: formattedAvg24hHr.formatted,
      stabilityPct: hashrateStabilityPct
    },
    earnings: {
      actual1hCoins,
      actual1hUsd: actual1hCoins * usdPrice,
      actual6hCoins,
      actual24hCoins,
      actual24hUsd: actual24hCoins * usdPrice,
      actual6hHourlyAvg,
      actual24hHourlyAvg,
      ewmaVelocity,
      theoreticalDailyCoins,
      theoreticalDailyUsd: theoreticalDailyCoins * usdPrice,
      theoreticalHourlyCoins,
      actualYieldPerBaseUnitDay,
      theoreticalYieldPerBaseUnitDay,
      nativeHour,
      nativeDay,
      nativeWeek,
      nativeMonth
    },
    analytics: {
      apiEstimationEfficiency,
      poolLuckRealizedPct,
      discrepancyInsight,
      comparisons
    },
    profitGraph,
    workers,
    payments
  };
}

module.exports = {
  formatHashrate,
  processMetrics
};
