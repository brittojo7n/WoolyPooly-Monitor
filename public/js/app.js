/* WoolyPooly Monitor — frontend app.
 * - Consumes the /api/stats payload (history, merge coins, all native income
 *   windows, worker summaries) via SSE + a one-shot fetch.
 * - Batches DOM writes into requestAnimationFrame to keep INP low.
 * - Redraws the canvas through rAF with a devicePixelRatio clamp.
 * - Instruments Core Web Vitals (LCP / CLS / INP) and reports them to the
 *   console so they can be checked in DevTools without a profiler.
 */
(function () {
  'use strict';

  var DEFAULT_WALLET = (document.body && document.body.dataset.defaultWallet) || '';
  var sseSource = null;
  var chart = null;
  var tooltip = null;
  var lastGraphData = null;
  var lastTicker = 'VTC';
  var lastUsdPrice = 0;
  var hoveredIndex = -1;
  var lastPayloadKey = null;

  /* Per-update DOM write cache. All writes are flushed together on the next
     animation frame so a burst of values never forces repeated layout. */
  var pendingText = new Map();
  var rafPending = false;
  var elCache = new Map();

  var chartDirty = false;

  /* ------------------------------------------------------------------ *
   * Core Web Vitals observer (developer instrumentation)
   * ------------------------------------------------------------------ */
  window.__perf = { LCP: null, CLS: 0, INP: null, events: [] };

  function reportPerf() {
    var out = {
      LCP_ms: window.__perf.LCP != null ? Math.round(window.__perf.LCP) : null,
      LCP: window.__perf.LCP != null ? (window.__perf.LCP <= 2500 ? 'good' : window.__perf.LCP <= 4000 ? 'needs-improvement' : 'poor') : null,
      CLS: Number(window.__perf.CLS.toFixed(4)),
      CLS_rating: window.__perf.CLS <= 0.1 ? 'good' : window.__perf.CLS <= 0.25 ? 'needs-improvement' : 'poor',
      INP_ms: window.__perf.INP != null ? Math.round(window.__perf.INP) : null,
      INP: window.__perf.INP != null ? (window.__perf.INP <= 200 ? 'good' : window.__perf.INP <= 500 ? 'needs-improvement' : 'poor') : null
    };
    // eslint-disable-next-line no-console
    console.info('[CWV] %o', out);
    return out;
  }
  window.__perf.report = reportPerf;

  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.entryType === 'largest-contentful-paint') {
            window.__perf.LCP = e.startTime;
          } else if (e.entryType === 'layout-shift' && !e.hadRecentInput) {
            window.__perf.CLS += e.value;
          } else if (e.entryType === 'event') {
            // INP candidate: interaction latency.
            window.__perf.INP = e.duration;
          }
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (!e.hadRecentInput) window.__perf.CLS += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });

      if (PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf('event') !== -1) {
        new PerformanceObserver(function (list) {
          for (var i = 0; i < list.getEntries().length; i++) {
            var e = list.getEntries()[i];
            if (e.interactionId) window.__perf.INP = e.duration;
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      }
    } catch (err) { /* older browsers: skip */ }
  }

  // Emit the final numbers once the page has settled.
  window.addEventListener('load', function () {
    setTimeout(reportPerf, 1500);
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function shortWallet(w) {
    return w.length > 16 ? w.slice(0, 10) + '\u2026' + w.slice(-6) : w;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(id) {
    var node = elCache.get(id);
    if (!node) {
      node = document.getElementById(id);
      if (node) elCache.set(id, node);
    }
    return node;
  }

  function setText(id, txt) {
    pendingText.set(id, txt);
    scheduleApply();
  }

  function scheduleApply() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(applyPending);
  }

  function applyPending() {
    rafPending = false;
    pendingText.forEach(function (v, id) {
      var node = el(id);
      if (node) node.textContent = v;
    });
    pendingText.clear();
  }

  function formatEta(hours) {
    if (!isFinite(hours) || hours <= 0) return '--';
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + 'm';
    if (hours < 48) return hours.toFixed(1) + 'h';
    return (hours / 24).toFixed(1) + 'd';
  }

  function formatHashrateClient(hashesPerSec) {
    var h = typeof hashesPerSec === 'number' && isFinite(hashesPerSec) ? hashesPerSec : 0;
    if (h <= 0) return '0.00 H/s';
    if (h >= 1e12) return (h / 1e12).toFixed(2) + ' TH/s';
    if (h >= 1e9) return (h / 1e9).toFixed(2) + ' GH/s';
    if (h >= 1e6) return (h / 1e6).toFixed(2) + ' MH/s';
    if (h >= 1e3) return (h / 1e3).toFixed(2) + ' KH/s';
    return h.toFixed(2) + ' H/s';
  }

  /* 24h hashrate trend from the pool's hourly performance series
     (hashrate.history is ordered oldest -> newest). */
  function hashrateTrendPct(history) {
    if (!history || history.length < 2) return null;
    var first = null, last = null;
    for (var i = 0; i < history.length; i++) {
      if (history[i].hr > 0) { first = history[i].hr; break; }
    }
    for (var j = history.length - 1; j >= 0; j--) {
      if (history[j].hr > 0) { last = history[j].hr; break; }
    }
    if (first == null || last == null || first <= 0) return null;
    return ((last - first) / first) * 100;
  }

  /* ------------------------------------------------------------------ *
   * Chart
   * ------------------------------------------------------------------ */
  function initChart() {
    chart = document.getElementById('velocityCanvas');
    tooltip = document.getElementById('chartTooltip');
    if (!chart) return;

    function handlePointer(evt) {
      if (!lastGraphData || lastGraphData.length === 0) return;
      var rect = chart.getBoundingClientRect();
      var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      var x = clientX - rect.left;
      var padding = { top: 20, right: 20, bottom: 35, left: 60 };
      var w = rect.width - padding.left - padding.right;
      var count = lastGraphData.length;

      if (x < padding.left || x > rect.width - padding.right) {
        hoveredIndex = -1;
        if (tooltip) tooltip.classList.remove('active');
        markChartDirty();
        return;
      }

      var step = w / (count - 1 || 1);
      var idx = Math.max(0, Math.min(count - 1, Math.round((x - padding.left) / step)));
      hoveredIndex = idx;

      var item = lastGraphData[idx];
      var amount = parseFloat(item.amount) || 0;
      var pointX = padding.left + idx * step;
      var maxVal = Math.max.apply(null, lastGraphData.map(function (g) { return parseFloat(g.amount) || 0; }).concat([0.0001])) * 1.15;
      var h = rect.height - padding.top - padding.bottom;
      var pointY = padding.top + h - (amount / maxVal) * h;

      if (tooltip) {
        var dt = item.created ? new Date(item.created).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Hour ' + (idx + 1);
        var usdStr = (amount * lastUsdPrice) > 0 ? ' ($' + (amount * lastUsdPrice).toFixed(4) + ' USD)' : '';
        var partStr = item.participation ? '<div class="tt-sub">Pool: ' + (item.participation * 100).toFixed(4) + '%</div>' : '';
        tooltip.innerHTML = '<div class="tt-time">' + dt + '</div>' +
          '<div class="tt-val">' + amount.toFixed(4) + ' ' + lastTicker + usdStr + '</div>' +
          partStr;
        tooltip.style.left = Math.max(90, Math.min(rect.width - 90, pointX)) + 'px';
        tooltip.style.top = Math.max(25, pointY) + 'px';
        tooltip.classList.add('active');
      }
      markChartDirty();
    }

    chart.addEventListener('mousemove', handlePointer);
    chart.addEventListener('mouseleave', function () {
      hoveredIndex = -1;
      if (tooltip) tooltip.classList.remove('active');
      markChartDirty();
    });
    chart.addEventListener('touchstart', handlePointer, { passive: true });
    chart.addEventListener('touchmove', handlePointer, { passive: true });
    chart.addEventListener('touchend', function () {
      hoveredIndex = -1;
      if (tooltip) tooltip.classList.remove('active');
      markChartDirty();
    });

    window.addEventListener('resize', function () {
      if (lastGraphData) markChartDirty();
    });
  }

  function markChartDirty() {
    if (chartDirty) return;
    chartDirty = true;
    requestAnimationFrame(drawCanvasChart);
  }

  function drawCanvasChart() {
    chartDirty = false;
    if (!chart || document.hidden) return;
    var ctx = chart.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = chart.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    chart.width = Math.round(rect.width * dpr);
    chart.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!lastGraphData || lastGraphData.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data', rect.width / 2, rect.height / 2);
      return;
    }

    var padding = { top: 20, right: 20, bottom: 35, left: 60 };
    var w = rect.width - padding.left - padding.right;
    var h = rect.height - padding.top - padding.bottom;
    var amounts = lastGraphData.map(function (g) { return parseFloat(g.amount) || 0; });
    var rawMax = Math.max.apply(null, amounts.concat([0.0001]));
    var maxVal = rawMax * 1.15;
    var count = lastGraphData.length;
    var step = w / (count - 1 || 1);

    var gridCount = 4;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var i = 0; i <= gridCount; i++) {
      var ratio = i / gridCount;
      var gy = padding.top + h - ratio * h;
      var gval = ratio * maxVal;
      ctx.beginPath();
      ctx.moveTo(padding.left, gy);
      ctx.lineTo(rect.width - padding.right, gy);
      ctx.stroke();
      ctx.fillText(gval.toFixed(gval < 1 ? 4 : 2), padding.left - 8, gy);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var labelInterval = Math.max(1, Math.floor(count / 5));
    for (var li = 0; li < count; li += labelInterval) {
      var lx = padding.left + li * step;
      var litem = lastGraphData[li];
      var ltime;
      if (litem && litem.created) {
        ltime = new Date(litem.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } else {
        ltime = (count - li) + 'h ago';
      }
      ctx.fillText(ltime, lx, padding.top + h + 10);
    }

    var points = amounts.map(function (val, pi) {
      return { x: padding.left + pi * step, y: padding.top + h - (val / maxVal) * h, val: val };
    });

    var barW = Math.max(4, Math.min(18, step * 0.5));
    amounts.forEach(function (val, bi) {
      var px = padding.left + bi * step;
      var bh = (val / maxVal) * h;
      var by = padding.top + h - bh;
      ctx.fillStyle = (bi === hoveredIndex) ? 'rgba(59, 130, 246, 0.45)' : 'rgba(16, 185, 129, 0.15)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px - barW / 2, by, barW, bh, [3, 3, 0, 0]);
      } else {
        ctx.rect(px - barW / 2, by, barW, bh);
      }
      ctx.fill();
    });

    if (points.length > 1) {
      var areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
      areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
      areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
      ctx.beginPath();
      ctx.moveTo(points[0].x, padding.top + h);
      ctx.lineTo(points[0].x, points[0].y);
      for (var ai = 1; ai < points.length; ai++) ctx.lineTo(points[ai].x, points[ai].y);
      ctx.lineTo(points[points.length - 1].x, padding.top + h);
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();
    }

    if (points.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var si = 1; si < points.length; si++) ctx.lineTo(points[si].x, points[si].y);
      ctx.stroke();
      ctx.restore();
    }

    points.forEach(function (p, di) {
      var isHovered = (di === hoveredIndex);
      ctx.beginPath();
      ctx.arc(p.x, p.y, isHovered ? 6 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#34d399' : '#0f172a';
      ctx.fill();
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.strokeStyle = isHovered ? '#ffffff' : '#10b981';
      ctx.stroke();
    });

    if (hoveredIndex >= 0 && hoveredIndex < points.length) {
      var hp = points[hoveredIndex];
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hp.x, padding.top);
      ctx.lineTo(hp.x, padding.top + h);
      ctx.stroke();
      ctx.restore();
    }
  }

  function renderChart(graph, ticker, usdPrice) {
    lastGraphData = graph || [];
    lastTicker = ticker || 'VTC';
    lastUsdPrice = usdPrice || 0;
    markChartDirty();
  }

  /* ------------------------------------------------------------------ *
   * Data transport
   * ------------------------------------------------------------------ */
  function reconnectStream() {
    if (sseSource) sseSource.close();
    sseSource = new EventSource('/api/stream');
    sseSource.onmessage = function (event) {
      try {
        updateUI(JSON.parse(event.data));
      } catch (e) { /* ignore malformed frames */ }
    };
    fetchDataOnce();
  }

  function fetchDataOnce() {
    fetch('/api/stats')
      .then(function (res) { return res.json(); })
      .then(updateUI)
      .catch(function () { /* SSE will retry on its own */ });
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  function updateUI(data) {
    // Guard against duplicate/malformed payloads.
    if (!data || !data.poolStats || !data.balances || !data.earnings || !data.hashrate) return;

    var ticker = data.coinTicker || 'VTC';
    var price = data.usdPrice || 0;
    var b = data.balances;
    var e = data.earnings;
    var a = data.analytics || {};
    var h = data.hashrate;
    var p = data.poolStats;

    var key = data.timestamp + '|' + ticker + '|' + JSON.stringify(b) + '|' + JSON.stringify(p) + '|' + JSON.stringify(h);
    if (key === lastPayloadKey) return; // nothing changed, skip the whole repaint
    lastPayloadKey = key;

    var modeBadge = el('modeBadge');
    var updated = new Date(data.timestamp).toLocaleTimeString();
    setText('lastRefreshed', 'Updated: ' + updated + (data.stale ? ' (stale)' : ''));
    if (modeBadge) {
      if (data.stale) { modeBadge.textContent = 'STALE'; modeBadge.className = 'badge badge-stale'; }
      else { modeBadge.textContent = 'LIVE'; modeBadge.className = 'badge badge-live'; }
    }
    setText('pricePill', ticker + ' $' + (price).toFixed(4));

    function usd(n) { return '$' + (n * price).toFixed(2); }

    setText('v-unpaid', b.unpaidBalance.toFixed(4) + ' ' + ticker);
    setText('s-unpaid-usd', usd(b.unpaidBalance) + ' USD');
    var payPct = p.minPay > 0 ? Math.min(100, (b.unpaidBalance / p.minPay) * 100) : 100;
    setText('s-unpaid-pct', payPct.toFixed(0) + '% of ' + (p.minPay || 0) + ' min payout');

    setText('v-imm', b.immatureBalance.toFixed(4) + ' ' + ticker);
    setText('s-imm-usd', usd(b.immatureBalance) + ' USD');

    setText('v-paid', b.totalPaid.toFixed(4) + ' ' + ticker);
    setText('s-paid-usd', usd(b.totalPaid) + ' USD');
    setText('s-paid-today', 'Today: ' + (b.todayPaid || 0).toFixed(4) + ' ' + ticker);

    setText('v-earn', e.actual24hCoins.toFixed(4) + ' ' + ticker);
    setText('s-earn-usd', usd(e.actual24hCoins) + ' USD');

    setText('v-est', e.nativeDay.toFixed(4) + ' ' + ticker);
    setText('s-est-usd', usd(e.nativeDay) + ' USD');
    setText('s-est-eff', 'Efficiency: ' + (a.apiEstimationEfficiency || 100).toFixed(1) + '%');

    setText('v-luck', (a.poolLuckRealizedPct || 100).toFixed(1) + '%');
    setText('s-luck-theory', 'Theory: ' + e.theoreticalDailyCoins.toFixed(2) + ' / day');

    setText('v-hr', h.formattedCurrentHr);
    var trend = hashrateTrendPct(h.history);
    var trendStr = trend == null ? '' : ' · 24h ' + (trend >= 0 ? '\u2191' : '\u2193') + Math.abs(trend).toFixed(1) + '%';
    setText('s-hr-stab', 'Stability: ' + (h.stabilityPct || 100).toFixed(1) + '%' + trendStr);

    setText('v-avg', h.formattedAvg24hHr);
    setText('s-avg-6h', '6h avg: ' + (h.formattedAvg6hHr || '0.00 H/s'));

    setText('v-peff', (p.poolEffortPct || 0).toFixed(1) + '%');
    setText('s-peff-pool', 'Pool: ' + (p.formattedPoolHr || '0.00 H/s') + ' (' + (p.poolMiners || 0) + ' miners)');

    setText('v-ueff', (p.userEffortPct || 0).toFixed(1) + '%');
    setText('s-ueff-workers', (p.workersOnline || 0) + '/' + (p.workersTotal || 0) + ' workers online');

    setText('v-net', p.formattedNetHr || '0.00 H/s');
    setText('s-net-diff', 'Difficulty: ' + (p.difficulty || 0).toFixed(2));
    setText('s-net-block', 'Block ' + (p.height || 0) + ' · ' + (p.blockReward || 0) + ' reward');
    var merge = (p.mergeCoins && p.mergeCoins.length) ? 'Merge: ' + p.mergeCoins.join(', ') : 'PPLNS + SOLO';
    setText('s-net-merge', merge);

    var remaining = Math.max(0, (p.minPay || 0) - b.unpaidBalance);
    var rate = e.actual24hHourlyAvg > 0 ? e.actual24hHourlyAvg : e.theoreticalHourlyCoins;
    if (remaining <= 0) {
      setText('v-pay', 'Due');
      setText('s-pay-need', 'Ready for auto payout');
    } else if (!(rate > 0)) {
      setText('v-pay', '--');
      setText('s-pay-need', 'No earnings rate yet');
    } else {
      setText('v-pay', formatEta(remaining / rate));
      setText('s-pay-need', 'Need ' + remaining.toFixed(4) + ' ' + ticker + ' more');
    }

    setText('insightBox', a.discrepancyInsight || '');

    // Comparison table (all API windows are now represented server-side).
    var cmp = el('comparisonTableBody');
    if (cmp && a.comparisons) {
      var html = '';
      a.comparisons.forEach(function (c) {
        html += '<tr>' +
          '<td style="font-weight: 600;">' + esc(c.metric) + '</td>' +
          '<td>' + esc(c.apiNative) + '</td>' +
          '<td style="color: #34d399; font-weight: 700;">' + esc(c.calculatedActual) + '</td>' +
          '<td style="color: #60a5fa;">' + esc(c.calculatedTheoretical) + '</td>' +
          '<td>' + esc(c.variance) + '</td>' +
          '<td><span class="badge badge-live">' + esc(c.status) + '</span></td></tr>';
      });
      cmp.innerHTML = html;
    }

    renderChart(data.profitGraph, ticker, price);
    renderWorkers(data.workers);
    renderPayments(data.payments, ticker);
  }

  function renderWorkers(workers) {
    var tbody = el('workersTableBody');
    if (!tbody) return;
    if (!workers || workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">No workers</td></tr>';
      return;
    }
    var html = '';
    workers.forEach(function (w) {
      var statusClass = w.offline ? 'status-offline' : 'status-online';
      html += '<tr>' +
        '<td><span class="status-dot ' + statusClass + '"></span>' + esc(w.worker || 'unnamed') + '</td>' +
        '<td>' + formatHashrateClient(w.hr) + '</td>' +
        '<td>' + formatHashrateClient(w.hr2) + '</td>' +
        '<td>' + formatHashrateClient(w.hr3) + '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  function renderPayments(payments, ticker) {
    var tbody = el('paymentsTableBody');
    if (!tbody) return;
    if (!payments || payments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No payments</td></tr>';
      return;
    }
    var html = '';
    payments.slice(0, 10).forEach(function (pay) {
      var dt = new Date(pay.timestamp * 1000).toLocaleString();
      html += '<tr>' +
        '<td>' + dt + '</td>' +
        '<td style="color: #34d399; font-weight: 700;">' + (parseFloat(pay.amount) || 0).toFixed(4) + ' ' + esc(ticker) + '</td>' +
        '<td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">' + esc(pay.tx || 'N/A') + '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  if (el('walletTag')) {
    el('walletTag').textContent = DEFAULT_WALLET ? ' · ' + shortWallet(DEFAULT_WALLET) : '';
  }
  initChart();
  reconnectStream();
})();
