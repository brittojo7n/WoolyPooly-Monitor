import state from '../lib/state.js';
import { el, setText } from '../lib/dom.js';
import { num, formatEta, formatHashrateClient, esc } from '../lib/format.js';
import { renderChart } from '../components/chart.js';
import { renderWorkersTable } from '../components/workers.js';
import { renderPaymentsTable } from '../components/payments.js';
import { buildPagination } from '../components/pagination.js';

function updateUI(data) {
  if (!data || !data.api || !data.api.account || !data.estimated) return;

  var ticker = data.coinTicker || 'VTC';
  var price = num(data.usdPrice);
  var apiAcc = data.api.account;
  var apiPool = data.api.pool || {};
  var est = data.estimated;
  var payout = data.payout || {};

  var key = JSON.stringify(data, function (k, v) { return k === 'timestamp' ? 0 : v; });
  if (key === state.payloadKey) return;
  state.payloadKey = key;

  var income = apiAcc.income || {};
  var hash = apiAcc.hashrate || {};
  var counts = apiAcc.workerCounts || {};

  var modeBadge = el('modeBadge');
  if (modeBadge) {
    if (data.stale) { modeBadge.textContent = 'STALE'; modeBadge.className = 'badge badge-stale'; }
    else { modeBadge.textContent = 'LIVE'; modeBadge.className = 'badge badge-live'; }
  }
  setText('pricePill', ticker + ' $' + price.toFixed(4));

  function usd(n) { return '$' + (n * price).toFixed(2); }

  var balance = num(apiAcc.balance);
  var immature = num(apiAcc.immatureBalance);
  var paid = num(apiAcc.paid);

  state.ticker = ticker;
  var totalBal = balance + immature;
  setText('v-bal', totalBal.toFixed(4) + ' ' + ticker);
  setText('s-bal-usd', usd(totalBal) + ' USD');
  var thr = payout.threshold;
  if (thr > 0) {
    var balPct = Math.min(100, (balance / thr) * 100);
    setText('s-bal-pct', balPct.toFixed(0) + '%');
    var balBar = el('s-bal-bar-fill');
    if (balBar) balBar.style.transform = 'scaleX(' + (balPct / 100) + ')';
    if (payout.remaining != null && payout.remaining > 0) {
      setText('s-bal-need', payout.remaining.toFixed(4) + ' ' + ticker + ' more to ' + thr + ' ' + ticker + ' payout');
    } else {
      setText('s-bal-need', 'Ready for payout');
    }
  } else {
    setText('s-bal-pct', '--');
    setText('s-bal-need', 'payout threshold n/a');
  }
  if (payout.remaining != null && payout.remaining > 0 && data.stale) {
    setText('s-bal-eta', 'ETA unavailable · pool data stale');
  } else if (payout.remaining != null && payout.remaining > 0 && est.status === 'paused') {
    setText('s-bal-eta', 'ETA paused · no workers online');
  } else if (payout.remaining != null && payout.remaining > 0 && payout.ratePerHour > 0) {
    setText('s-bal-eta', '≈' + formatEta(payout.remaining / payout.ratePerHour) + ' to payout');
  } else if (payout.remaining != null && payout.remaining > 0 && est.status === 'stopped') {
    setText('s-bal-eta', 'ETA paused · no recent graph bucket');
  } else if (payout.remaining != null && payout.remaining > 0) {
    setText('s-bal-eta', est.status === 'waiting' ? 'ETA unavailable · awaiting pool credits' :
        'ETA unavailable · insufficient recent data');
  } else {
    setText('s-bal-eta', '');
  }

  setText('v-paid', paid.toFixed(4) + ' ' + ticker);
  setText('s-paid-usd', usd(paid) + ' USD');
  setText('s-paid-today', 'Today: ' + num(apiAcc.todayPaid).toFixed(4) + ' ' + ticker);

  var estHour = num(est.perHour);
  var estDay = num(est.perDay);
  if (data.stale) {
    setText('v-est', 'N/A');
    setText('s-est-d', 'Pool data stale');
  } else if (est.status === 'stopped' || est.status === 'paused' || est.status === 'waiting') {
    setText('v-est', '0.0000 ' + ticker + '/h');
    setText('s-est-d', '0.0000 ' + ticker + '/d · ' +
      (est.status === 'paused' ? 'No workers online' :
        (est.status === 'stopped' ? 'No recent graph bucket' : 'Awaiting pool credits')));
  } else if (est.available) {
    setText('v-est', '≈' + estHour.toFixed(4) + ' ' + ticker + '/h');
    setText('s-est-d', '≈' + estDay.toFixed(4) + ' ' + ticker + '/d' +
      (est.confidence === 'early' ? ' · early estimate' : ''));
  } else {
    setText('v-est', 'N/A');
    setText('s-est-d', 'Worker data unavailable');
  }
  setText('s-est-usd', est.status === 'running' && !data.stale ? usd(estDay) + ' USD/d' :
    '24h reported: ' + num(est.observed24h).toFixed(4) + ' ' + ticker);

  var apiHour = num(income.hour);
  var api24 = num(income.day);
  setText('v-api', apiHour.toFixed(4) + ' ' + ticker + '/h');
  setText('s-api-d', api24.toFixed(4) + ' ' + ticker + '/d');
  setText('s-api-usd', usd(api24) + ' USD');

  var liveHr = num(hash.current);
  var h3 = num(hash.sixH);
  var h24 = num(hash.day);
  setText('v-hr', formatHashrateClient(liveHr));

  setText('s-hr-3h', '3H: ' + (h3 > 0 ? formatHashrateClient(h3) : '--'));
  setText('s-hr-24h', '24H: ' + (h24 > 0 ? formatHashrateClient(h24) : '--'));

  var poolEff = apiPool.poolEffortPct;
  setText('v-peff', poolEff != null ? poolEff.toFixed(1) + '%' : 'N/A');
  setText('s-peff-pool', 'Pool: ' + formatHashrateClient(apiPool.poolHashrate || 0));
  setText('s-peff-miners', apiPool.poolMiners != null ? apiPool.poolMiners + ' miners' : '-- miners');

  var ueff = apiAcc.effort || {};
  setText('v-ueff-pplns', ueff.pplns != null ? ueff.pplns.toFixed(1) + '%' : 'N/A');
  setText('v-ueff-solo', ueff.solo != null ? ueff.solo.toFixed(1) + '%' : 'N/A');
  setText('s-ueff-workers', counts.online + '/' + counts.total + ' workers online');

  setText('v-net', formatHashrateClient(apiPool.netHashrate || 0));
  setText('s-net-diff', 'Difficulty: ' + (apiPool.difficulty != null ? num(apiPool.difficulty).toFixed(2) : '--'));
  setText('s-net-block', 'Block ' + (apiPool.height != null ? apiPool.height : '--') + ' · ' + (apiPool.blockReward != null ? num(apiPool.blockReward).toFixed(4) : '--') + ' reward');
  var merge = (apiPool.merge && apiPool.merge.length) ? 'Merge: ' + apiPool.merge.join(', ') : 'PPLNS + SOLO';
  setText('s-net-merge', merge);

  var cmp = el('comparisonTableBody');
  if (cmp && data.comparisons) {
    var html = '';
    data.comparisons.forEach(function (c) {
      html += '<tr>' +
        '<td style="font-weight: 600;">' + esc(c.label) + '</td>' +
        '<td style="color: #38bdf8;">' + esc(c.api) + '</td>' +
        '<td style="color: #34d399; font-weight: 700;">' + esc(c.estimated) + '</td>' +
        '<td>' + esc(c.delta == null ? '—' : c.delta) + '</td></tr>';
    });
    cmp.innerHTML = html;
  }

  state.workers.data = Array.isArray(data.workers) ? data.workers : [];
  state.payments.data = Array.isArray(data.payments) ? data.payments : [];

  renderWorkersTable();
  buildPagination('workersPagination', state.workers, renderWorkersTable);
  renderPaymentsTable();
  buildPagination('paymentsPagination', state.payments, renderPaymentsTable);

  renderChart(data.hourlyGraph, ticker, price);
}

export { updateUI };
