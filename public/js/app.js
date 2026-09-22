(function () {
  'use strict';

  var DEFAULT_WALLET = (document.body && document.body.dataset.defaultWallet) || '';
  var PAGE_SIZE = 5;
  var sseSource = null;
  var chart = null;
  var tooltip = null;
  var lastGraphData = null;
  var lastTicker = 'VTC';
  var lastUsdPrice = 0;
  var hoveredIndex = -1;
  var lastPayloadKey = null;

  var pageState = {
    workers: { page: 1, data: [] },
    payments: { page: 1, data: [] }
  };

  var pendingText = new Map();
  var rafPending = false;
  var elCache = new Map();

  var chartDirty = false;
  var infoTip = null;

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
    } catch (err) {}
  }

  window.addEventListener('load', function () {
    setTimeout(reportPerf, 1500);
  });

  function shortWallet(w) {
    var s = String(w || '');
    return s.length > 16 ? s.slice(0, 10) + '\u2026' + s.slice(-6) : s;
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

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function formatEta(hours) {
    if (hours == null || !isFinite(hours) || hours <= 0) return '--';
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

  function reconnectStream() {
    if (sseSource) sseSource.close();
    sseSource = new EventSource('/api/stream');
    sseSource.onerror = function () {};
    sseSource.onmessage = function (event) {
      try {
        updateUI(JSON.parse(event.data));
      } catch (e) {}
    };
    fetchDataOnce();
  }

  function fetchDataOnce() {
    fetch('/api/stats')
      .then(function (res) { return res.json(); })
      .then(updateUI)
      .catch(function () {});
  }

  function buildPagination(boxId, state, tableBodyId) {
    var box = el(boxId);
    if (!box) return;

    var total = state.data.length;
    if (total <= PAGE_SIZE) {
      while (box.firstChild) box.removeChild(box.firstChild);
      box.classList.add('is-empty');
      return;
    }
    box.classList.remove('is-empty');
    while (box.firstChild) box.removeChild(box.firstChild);

    var pages = Math.ceil(total / PAGE_SIZE);
    if (state.page < 1) state.page = 1;
    if (state.page > pages) state.page = pages;

    var start = total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    var end = Math.min(total, state.page * PAGE_SIZE);

    var entry = document.createElement('div');
    entry.className = 'page-row-count';
    entry.textContent = 'Showing ' + start + '–' + end + ' of ' + total;
    box.appendChild(entry);

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹ Prev';
    prevBtn.disabled = state.page <= 1;
    prevBtn.addEventListener('click', function () {
      if (state.page > 1) {
        state.page--;
        renderTable(tableBodyId, state);
        buildPagination(boxId, state, tableBodyId);
      }
    });
    box.appendChild(prevBtn);

    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'page-num';
    input.min = '1';
    input.max = String(pages);
    input.value = String(state.page);
    input.setAttribute('aria-label', 'Page number');

    var commit = function () {
      var raw = input.value;
      if (raw === '') {
        input.value = String(state.page);
        input.blur();
        return;
      }
      var n = parseInt(raw, 10);
      if (!isFinite(n) || n < 1 || n > pages) {
        input.value = String(state.page);
        return;
      }
      state.page = n;
      renderTable(tableBodyId, state);
      buildPagination(boxId, state, tableBodyId);
    };

    input.addEventListener('keydown', function (evt) {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        commit();
        input.blur();
      }
    });
    input.addEventListener('blur', commit);
    box.appendChild(input);

    var scope = document.createElement('span');
    scope.className = 'page-scope';
    scope.textContent = 'Page ' + state.page + ' of ' + pages;
    box.appendChild(scope);

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'page-btn';
    nextBtn.textContent = 'Next ›';
    nextBtn.disabled = state.page >= pages;
    nextBtn.addEventListener('click', function () {
      if (state.page < pages) {
        state.page++;
        renderTable(tableBodyId, state);
        buildPagination(boxId, state, tableBodyId);
      }
    });
    box.appendChild(nextBtn);

    var pill = document.createElement('span');
    pill.className = 'page-pill';
    pill.textContent = pages + ' pages';
    box.appendChild(pill);
  }

  function clampPages(state) {
    var pages = Math.max(1, Math.ceil(state.data.length / PAGE_SIZE));
    if (state.page < 1) state.page = 1;
    if (state.page > pages) state.page = pages;
  }

  function renderWorkersTable() {
    clampPages(pageState.workers);
    var tbody = el('workersTableBody');
    var workers = pageState.workers.data;
    if (!tbody) return;

    if (workers.length <= PAGE_SIZE) {
      if (workers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No workers</td></tr>';
      } else {
        var whole = '';
        workers.forEach(function (w) {
          whole += workerRow(w);
        });
        tbody.innerHTML = whole;
      }
      return;
    }

    if (workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">No workers</td></tr>';
      return;
    }

    var startIdx = (pageState.workers.page - 1) * PAGE_SIZE;
    var slice = workers.slice(startIdx, startIdx + PAGE_SIZE);
    var html = '';
    slice.forEach(function (w) {
      html += workerRow(w);
    });
    tbody.innerHTML = html;
  }

  function workerRow(w) {
    var statusClass = w.offline ? 'status-offline' : 'status-online';
    return '<tr>' +
      '<td><span class="status-dot ' + statusClass + '"></span>' + esc(w.worker || 'unnamed') + '</td>' +
      '<td>' + (w.hr ? formatHashrateClient(w.hr) : '--') + '</td>' +
      '<td>' + (w.hr2 ? formatHashrateClient(w.hr2) : '--') + '</td>' +
      '<td>' + (w.hr3 ? formatHashrateClient(w.hr3) : '--') + '</td></tr>';
  }

  function renderPaymentsTable() {
    clampPages(pageState.payments);
    var tbody = el('paymentsTableBody');
    var payments = pageState.payments.data;
    if (!tbody) return;

    if (payments.length <= PAGE_SIZE) {
      if (payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No payments</td></tr>';
      } else {
        var whole = '';
        payments.forEach(function (pay) {
          whole += paymentRow(pay);
        });
        tbody.innerHTML = whole;
      }
      return;
    }

    if (payments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No payments</td></tr>';
      return;
    }

    var startIdx = (pageState.payments.page - 1) * PAGE_SIZE;
    var slice = payments.slice(startIdx, startIdx + PAGE_SIZE);
    var html = '';
    slice.forEach(function (pay) {
      html += paymentRow(pay);
    });
    tbody.innerHTML = html;
  }

  function paymentRow(pay) {
    var dt = new Date(pay.timestamp * 1000).toLocaleString();
    return '<tr>' +
      '<td>' + dt + '</td>' +
      '<td style="color: #34d399; font-weight: 700;">' + (parseFloat(pay.amount) || 0).toFixed(4) + ' VTC</td>' +
      '<td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">' + esc(pay.tx || 'N/A') + '</td></tr>';
  }

  function updateUI(data) {
    if (!data || !data.api || !data.api.account || !data.observed) return;

    var ticker = data.coinTicker || 'VTC';
    var price = num(data.usdPrice);
    var apiAcc = data.api.account;
    var apiPool = data.api.pool || {};
    var obs = data.observed;
    var payout = data.payout || {};
    var analytics = data.analytics || {};

    var key = data.timestamp + '|' + ticker + '|' + JSON.stringify(apiAcc.income) + '|' +
      JSON.stringify(obs.earnings) + '|' + JSON.stringify(apiPool);
    if (key === lastPayloadKey) return;
    lastPayloadKey = key;

    var income = apiAcc.income || {};
    var hash = apiAcc.hashrate || {};
    var counts = apiAcc.workerCounts || {};

    var modeBadge = el('modeBadge');
    var updated = new Date(data.timestamp).toLocaleTimeString();
    setText('lastRefreshed', 'Updated: ' + updated + (data.stale ? ' (stale)' : ''));
    if (modeBadge) {
      if (data.stale) { modeBadge.textContent = 'STALE'; modeBadge.className = 'badge badge-stale'; }
      else { modeBadge.textContent = 'LIVE'; modeBadge.className = 'badge badge-live'; }
    }
    setText('pricePill', ticker + ' $' + price.toFixed(4));

    function usd(n) { return '$' + (n * price).toFixed(2); }

    var balance = num(apiAcc.balance);
    var immature = num(apiAcc.immatureBalance);
    var paid = num(apiAcc.paid);

    setText('v-unpaid', balance.toFixed(4) + ' ' + ticker);
    setText('s-unpaid-usd', usd(balance) + ' USD');
    var minPay = payout.minPay;
    var payPct = (minPay > 0) ? Math.min(100, (balance / minPay) * 100) : null;
    setText('s-unpaid-pct', payPct != null ? payPct.toFixed(0) + '% of ' + minPay + ' min payout' : 'min payout n/a');

    setText('v-imm', immature.toFixed(4) + ' ' + ticker);
    setText('s-imm-usd', usd(immature) + ' USD');

    setText('v-paid', paid.toFixed(4) + ' ' + ticker);
    setText('s-paid-usd', usd(paid) + ' USD');
    setText('s-paid-today', 'Today: ' + num(apiAcc.todayPaid).toFixed(4) + ' ' + ticker);

    var obs24 = num(obs.earnings.twentyFourH);
    setText('v-obs24', obs24.toFixed(4) + ' ' + ticker);
    setText('s-obs24-usd', usd(obs24) + ' USD');
    var api24 = num(income.day);
    if (api24 > 0) {
      var d24 = obs24 - api24;
      var dpct = (d24 / api24) * 100;
      setText('s-obs24-delta', 'API: ' + api24.toFixed(4) + ' · Δ ' + (d24 >= 0 ? '+' : '') + d24.toFixed(4) + ' (' + (d24 >= 0 ? '+' : '') + dpct.toFixed(1) + '%)');
    } else {
      setText('s-obs24-delta', 'API: n/a · Δ --');
    }

    setText('v-earn', api24.toFixed(4) + ' ' + ticker);
    setText('s-earn-usd', usd(api24) + ' USD');

    var theoryDaily = num(data.theoretical.daily);
    if (obs24 > 0 && theoryDaily != null && theoryDaily > 0) {
      var ratioPct = (obs24 / theoryDaily) * 100;
      setText('v-luck', ratioPct.toFixed(0) + '%');
      setText('s-luck-theory', 'Theory: ' + theoryDaily.toFixed(2) + ' / day · ratio ' + ratioPct.toFixed(1) + '%');
    } else {
      setText('v-luck', 'N/A');
      setText('s-luck-theory', 'Theory: ' + (theoryDaily != null && theoryDaily > 0 ? theoryDaily.toFixed(2) + ' / day' : 'N/A') + (obs24 > 0 ? '' : ' · no observed 24h'));
    }

    var liveHr = num(hash.current);
    var h6 = num(hash.sixH);
    var h24 = num(hash.day);
    setText('v-hr', formatHashrateClient(liveHr));

    var trendStr = '';
    var hrHist = data.hashrateHistory || [];
    if (hrHist && hrHist.length > 1) {
      var t = hashrateTrendPct(hrHist);
      if (t != null) trendStr = ' · 24h ' + (t >= 0 ? '\u2191' : '\u2193') + Math.abs(t).toFixed(1) + '%';
    }
    setText('s-hr-stab', 'Live (kH/s): ' + (liveHr >= 1000 ? (liveHr / 1000).toFixed(2) : 'n/a') + trendStr);

    setText('v-avg', formatHashrateClient(h24));
    setText('s-avg-6h', '6h avg: ' + (h6 > 0 ? formatHashrateClient(h6) : '--'));

    var poolEff = apiPool.poolEffortPct;
    setText('v-peff', poolEff != null ? poolEff.toFixed(1) + '%' : 'N/A');
    setText('s-peff-pool', 'Pool: ' + formatHashrateClient(apiPool.poolHashrate || 0) + ' (' + (apiPool.poolMiners != null ? apiPool.poolMiners : '--') + ' miners)');

    var ueff = apiAcc.userEffortPct;
    setText('v-ueff', ueff != null ? ueff.toFixed(1) + '%' : 'N/A');
    setText('s-ueff-workers', counts.online + '/' + counts.total + ' workers online');

    setText('v-net', formatHashrateClient(apiPool.netHashrate || 0));
    setText('s-net-diff', 'Difficulty: ' + (apiPool.difficulty != null ? num(apiPool.difficulty).toFixed(2) : '--'));
    setText('s-net-block', 'Block ' + (apiPool.height != null ? apiPool.height : '--') + ' · ' + (apiPool.blockReward != null ? num(apiPool.blockReward).toFixed(4) : '--') + ' reward');
    var merge = (apiPool.merge && apiPool.merge.length) ? 'Merge: ' + apiPool.merge.join(', ') : 'PPLNS + SOLO';
    setText('s-net-merge', merge);

    if (payout.remaining != null && payout.remaining > 0 && payout.ratePerHour > 0) {
      var eta = payout.remaining / payout.ratePerHour;
      setText('v-pay', formatEta(eta));
      setText('s-pay-need', 'Need ' + payout.remaining.toFixed(4) + ' ' + ticker + ' more · ' + payout.minPay + ' min');
    } else if (payout.remaining != null && payout.remaining <= 0) {
      setText('v-pay', 'Due');
      setText('s-pay-need', 'Ready for auto payout (min ' + payout.minPay + ')');
    } else {
      setText('v-pay', '--');
      setText('s-pay-need', 'Based on API 24h rate');
    }

    setText('insightBox', analytics.summary || 'No data');

    var cmp = el('comparisonTableBody');
    if (cmp && analytics.comparisons) {
      var html = '';
      analytics.comparisons.forEach(function (c) {
        var statusClass = '';
        if (c.status === 'Within 5%') statusClass = 'badge-live';
        else if (c.status === 'Outside 5%') statusClass = 'badge-stale';
        var status = '<span class="badge ' + (statusClass || 'badge-live') + '">' + esc(c.status) + '</span>';
        html += '<tr>' +
          '<td style="font-weight: 600;">' + esc(c.label) + '</td>' +
          '<td style="color: #38bdf8;">' + esc(c.api) + '</td>' +
          '<td style="color: #34d399; font-weight: 700;">' + esc(c.observed) + '</td>' +
          '<td style="color: #e0a82e;">' + esc(c.projected == null ? '—' : c.projected) + '</td>' +
          '<td style="color: #60a5fa;">' + esc(c.theory == null ? '—' : c.theory) + '</td>' +
          '<td>' + esc(c.delta == null ? '—' : c.delta) + '</td>' +
          '<td>' + status + '</td></tr>';
      });
      cmp.innerHTML = html;
    }

    pageState.workers.data = Array.isArray(data.workers) ? data.workers : [];
    pageState.payments.data = Array.isArray(data.payments) ? data.payments : [];

    renderWorkersTable();
    buildPagination('workersPagination', pageState.workers, 'workersTableBody');
    renderPaymentsTable();
    buildPagination('paymentsPagination', pageState.payments, 'paymentsTableBody');

    renderChart(data.profitGraph, ticker, price);
    window.__lastObserved = data.observed;
  }

  function renderTable(tableBodyId, state) {
    if (tableBodyId === 'workersTableBody') renderWorkersTable();
    else renderPaymentsTable();
  }

  function initInfoTips() {
    document.addEventListener('mouseover', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      var tip = btn.getAttribute('data-tip');
      if (!tip) return;
      showInfoTip(btn, tip);
    });

    document.addEventListener('focusin', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      var tip = btn.getAttribute('data-tip');
      if (!tip) return;
      showInfoTip(btn, tip);
    });

    document.addEventListener('mouseout', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (btn) hideInfoTip();
    });

    document.addEventListener('focusout', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (btn) hideInfoTip();
    });
  }

  function showInfoTip(btn, tip) {
    hideInfoTip();
    var bubble = document.createElement('div');
    bubble.className = 'info-tip';
    bubble.textContent = tip;
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);

    var rect = btn.getBoundingClientRect();
    var bw = bubble.offsetWidth;
    var bh = bubble.offsetHeight;
    var gap = 10;
    var margin = 12;

    var left = rect.right + gap;
    if (left + bw > window.innerWidth - margin) {
      left = rect.left - bw - gap;
    }
    var top = rect.top + rect.height / 2 - bh / 2;
    if (top < margin) top = margin;
    if (top + bh > window.innerHeight - margin) top = window.innerHeight - bh - margin;

    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.classList.add('show');
    infoTip = bubble;
  }

  function hideInfoTip() {
    if (!infoTip) return;
    if (infoTip.parentNode) infoTip.parentNode.removeChild(infoTip);
    infoTip = null;
  }

  if (el('walletTag')) {
    el('walletTag').textContent = DEFAULT_WALLET ? ' · ' + shortWallet(DEFAULT_WALLET) : '';
  }
  initChart();
  initInfoTips();
  reconnectStream();
})();
