const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHourlyGraph, estimateRollingDay } = require('../lib/estimator');
const { processMetrics } = require('../lib/metrics');

// Hourly amounts from an idle VTC account's pool response on 2026-09-24.
// The pool omits subsequent hours rather than appending zero-valued entries.
const amounts = [
  0.127681441704, 0.055046540790, 0.129614473597, 0.094986018423,
  0.043595186783, 0.081102934665, 0.082931306885, 0.166527130670,
  0.085719462866, 0.106233156368, 0.109005200228, 0.090439525191,
  0.135584266588, 0.114120184108, 0.085353124251, 0.109321175330,
  0.057398616837, 0.078508167703, 0.085476283885, 0.103407299246,
  0.137746923769, 0.084141536870, 0.072333275918, 0.006452725369
];
const recorded = amounts.map((amount, i) => ({
  created: new Date(Date.UTC(2026, 8, 23, 5 + i)).toISOString(), amount
}));
const at = iso => Date.parse(iso);

// 07:30 UTC is 13:00 IST; the most recent pool bucket is 04:00 UTC / 09:30 IST.
const idleTime = at('2026-09-24T07:30:00Z');

test('clock-based chart places real reports, omitted completed hours and current hour at their correct UTC slots', () => {
  const hours = buildHourlyGraph(recorded, idleTime);
  assert.equal(hours.length, 25);
  assert.equal(hours[0].created, '2026-09-23T07:00:00.000Z');
  assert.equal(hours[21].created, '2026-09-24T04:00:00.000Z');
  assert.equal(hours[21].amount, 0.006452725369);
  assert.equal(hours[22].created, '2026-09-24T05:00:00.000Z');
  assert.deepEqual([hours[22].status, hours[23].status, hours[24].status],
    ['unreported', 'unreported', 'pending']);
  assert.equal(hours[22].amount, null); // unknown/unreported is not a measured zero
  assert.equal(hours[24].created, '2026-09-24T07:00:00.000Z');
});

test('historical last 24h matches the pool while forward projections stop for an offline wallet', () => {
  const result = estimateRollingDay(recorded, idleTime, { onlineWorkers: 0 });
  assert.ok(Math.abs(result.observed24h - 2.059997975550) < 1e-12); // income_Day from pool
  assert.equal(result.reportedHours, 22);
  assert.equal(result.missingHours, 2);
  assert.equal(result.lastReportedAt, '2026-09-24T04:00:00.000Z');
  assert.equal(result.status, 'paused');
  assert.equal(result.available, false);
  assert.equal(result.perHour, 0);
  assert.equal(result.perDay, 0);

  // A worker marked online but still without recent credits must not reuse the old streak.
  const onlineWithoutCredits = estimateRollingDay(recorded, idleTime, { onlineWorkers: 1 });
  assert.equal(onlineWithoutCredits.status, 'waiting');
  assert.equal(onlineWithoutCredits.available, false);
});

test('a new current-hour bucket appears immediately on the chart but is not projected until completed', () => {
  const resumed = [...recorded, { created: '2026-09-24T14:00:00+00:00', amount: 0.05 }];
  const first = estimateRollingDay(resumed, at('2026-09-24T14:30:00Z'), { onlineWorkers: 1 });
  assert.equal(first.hourlyGraph[24].status, 'partial');
  assert.equal(first.hourlyGraph[24].amount, 0.05);
  assert.equal(first.status, 'warming');
  assert.equal(first.available, false);
  assert.ok(!first.observed24h.toFixed(12).includes('NaN'));

  const oneCompleted = estimateRollingDay(resumed, at('2026-09-24T15:30:00Z'), { onlineWorkers: 1 });
  assert.equal(oneCompleted.sampleHours, 1);
  assert.equal(oneCompleted.available, false);
});

test('a late pool credit is plotted but does not restart forecasts while workers remain offline', () => {
  const delayedCredit = [...recorded, { created: '2026-09-24T14:00:00Z', amount: 0.05 }];
  const result = estimateRollingDay(delayedCredit, at('2026-09-24T14:30:00Z'), { onlineWorkers: 0 });
  assert.equal(result.hourlyGraph[24].status, 'partial');
  assert.equal(result.hourlyGraph[24].amount, 0.05);
  assert.equal(result.status, 'paused');
  assert.equal(result.available, false);
});

test('after restart, forecasts use a new continuous run rather than old pre-idle buckets', () => {
  const resumed = [...recorded,
    { created: '2026-09-24T14:00:00Z', amount: 0.10 },
    { created: '2026-09-24T15:00:00Z', amount: 0.12 },
    { created: '2026-09-24T16:00:00Z', amount: 0.09 }];
  const result = estimateRollingDay(resumed, at('2026-09-24T17:30:00Z'), { onlineWorkers: 1 });
  assert.equal(result.status, 'running');
  assert.equal(result.available, true);
  assert.equal(result.confidence, 'early');
  assert.equal(result.sampleHours, 3);
  assert.equal(result.spanHours, 3);
  assert.ok(Math.abs(result.perHour - 0.31 / 3) < 1e-12);
  assert.ok(Math.abs(result.perDay - 2.48) < 1e-12);
  assert.equal(result.hourlyGraph[24].status, 'pending');
});

test('one unreported hour within a live run is included in the clock-hour denominator', () => {
  const samples = [
    { created: '2026-09-24T14:00:00Z', amount: 0.1 },
    { created: '2026-09-24T16:00:00Z', amount: 0.2 },
    { created: '2026-09-24T17:00:00Z', amount: 0.3 }
  ];
  const result = estimateRollingDay(samples, at('2026-09-24T18:30:00Z'), { onlineWorkers: 1 });
  assert.equal(result.available, true);
  assert.equal(result.sampleHours, 3);
  assert.equal(result.spanHours, 4);
  assert.ok(Math.abs(result.perHour - 0.6 / 4) < 1e-12);
  assert.equal(result.hourlyGraph[21].status, 'unreported'); // 15:00 UTC
});

test('invalid entries are ignored and later revisions replace, not double-count, a bucket', () => {
  const graph = [
    { created: 'invalid', amount: 0.1 },
    { created: '2026-09-24T15:00:00Z', amount: 99 }, // future
    { created: '2026-09-24T14:00:00Z', amount: -1 },
    { created: '2026-09-24T14:00:00Z', amount: 0.1 },
    { created: '2026-09-24T14:00:00Z', amount: 0.2 }
  ];
  const hours = buildHourlyGraph(graph, at('2026-09-24T14:30:00Z'));
  assert.equal(hours[24].amount, 0.2);
  assert.equal(hours[24].status, 'partial');
});

test('metrics retain the raw API graph and history but suppress ETA and projected comparisons while idle', () => {
  const estimate = estimateRollingDay(recorded, idleTime, { onlineWorkers: 0 });
  const result = processMetrics({
    accountOk: true, poolOk: true, snapshotAt: idleTime, payoutThreshold: 5,
    poolStats: { minPay: 1, modes: [] },
    accountStats: {
      mode_stats: {}, workers: [], workersTotal: 0, workersOnline: 0,
      stats: {
        balance: 4.133566767870, immature_balance: 0, paid: 35.591119227507,
        income: { income_Hour: 0, income_Day: 2.059997975550 },
        minerProfitGraph: recorded
      }
    }
  }, 'vtc-1', 'example-wallet', estimate);
  assert.equal(result.timestamp, idleTime);
  assert.equal(result.api.account.income.day, 2.059997975550);
  assert.equal(result.api.account.workerCounts.online, 0);
  assert.equal(result.estimated.status, 'paused');
  assert.equal(result.estimated.observed24h, 2.059997975550);
  assert.ok(Math.abs(result.payout.remaining - 0.86643323213) < 1e-12);
  assert.equal(result.payout.ratePerHour, null);
  assert.equal(result.comparisons[2].estimated, 'N/A');
  assert.equal(result.comparisons[4].delta, null);
  assert.equal(result.profitGraph.length, 24);
  assert.equal(result.hourlyGraph.length, 25);
});
