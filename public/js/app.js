(function () {
  var DEFAULT_WALLET = (document.body && document.body.dataset.defaultWallet) || '';
  var PAGE_SIZE = 5;
  var sseSource = null;
  var chart = null;
  var tooltip = null;
  var lastGraphData = null;
  var lastTicker = 'VTC';
  var lastUsdPrice = 0;
  var hoveredIndex = -1;
  var touchPinned = -1;
  var lastTipIdx = -1;
  var lastGraphMax = 0.0001;
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
  var tipTimer = null;
  var tipBtn = null;
  var tipPositionPending = false;

  function clearTipTimer() {
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var walletCopyTimer = null;

  function copyWallet() {
    var btn = el('walletCopy');
    function done(ok) {
      if (!btn) return;
      if (btn.classList.toggle) btn.classList.toggle('copied', !!ok);
      else if (ok) btn.classList.add('copied');
      if (walletCopyTimer) clearTimeout(walletCopyTimer);
      walletCopyTimer = setTimeout(function () {
        btn.classList.remove('copied');
      }, 1200);
    }
    function legacyCopy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = DEFAULT_WALLET;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (ignored) {
          ok = false;
        }
        document.body.removeChild(ta);
        done(!!ok);
      } catch (err) {
        done(false);
      }
    }
    if (!DEFAULT_WALLET) {
      done(false);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(DEFAULT_WALLET).then(function () {
        done(true);
      }, legacyCopy);
    } else {
      legacyCopy();
    }
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
    if (h >= 1e3) return (h / 1e3).toFixed(2) + ' kH/s';
    return h.toFixed(2) + ' H/s';
  }

  function initChart() {
    chart = document.getElementById('velocityCanvas');
    tooltip = document.getElementById('chartTooltip');
    if (!chart) return;

    var pointerQueued = false;
    var pointerX = 0;
    var pointerType = '';
    var pointerIsTouch = false;

    function queuePointer(evt) {
      pointerX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      pointerType = evt.type;
      pointerIsTouch = !!evt.touches;
      if (!pointerQueued) {
        pointerQueued = true;
        requestAnimationFrame(runPointer);
      }
    }

    function runPointer() {
      pointerQueued = false;
      handlePointer(pointerX, pointerType, pointerIsTouch);
    }

    function handlePointer(clientX, type, isTouch) {
      if (!lastGraphData || lastGraphData.length === 0) return;
      var rect = chart.getBoundingClientRect();
      var x = clientX - rect.left;
      var padding = { top: 20, right: 20, bottom: 35, left: 60 };
      var w = rect.width - padding.left - padding.right;
      var count = lastGraphData.length;

      if (x < padding.left || x > rect.width - padding.right) {
        if (hoveredIndex === -1 && touchPinned === -1) return;
        hoveredIndex = -1;
        touchPinned = -1;
        lastTipIdx = -1;
        if (tooltip) tooltip.classList.remove('active');
        markChartDirty();
        return;
      }

      var step = w / (count - 1 || 1);
      var idx = Math.max(0, Math.min(count - 1, Math.round((x - padding.left) / step)));
      if (type === 'touchstart' && idx === touchPinned) {
        touchPinned = -1;
        hoveredIndex = -1;
        lastTipIdx = -1;
        if (tooltip) tooltip.classList.remove('active');
        markChartDirty();
        return;
      }
      if (idx === hoveredIndex && idx === lastTipIdx) return;
      if (isTouch) touchPinned = idx;
      hoveredIndex = idx;

      var item = lastGraphData[idx];
      var reported = item.amount != null && isFinite(Number(item.amount)) && Number(item.amount) >= 0;
      var amount = reported ? Number(item.amount) : 0;
      var currentHour = item.status === 'partial' || item.status === 'pending';
      var showAmount = reported && !currentHour;
      var pointX = padding.left + idx * step;
      var maxVal = lastGraphMax;
      var h = rect.height - padding.top - padding.bottom;
      var pointY = padding.top + h - (amount / maxVal) * h;

      if (tooltip) {
        var dt = item.created ? new Date(item.created).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Hour ' + (idx + 1);
        var usdStr = showAmount && (amount * lastUsdPrice) > 0 ? '<div class="tt-usd">($' + (amount * lastUsdPrice).toFixed(4) + ' USD)</div>' : '';
        var partStr = showAmount && item.participation ? '<div class="tt-sub">Pool: ' + (item.participation * 100).toFixed(4) + '%</div>' : '';
        var subStr = currentHour ? '<div class="tt-sub">Awaiting Data</div>' :
          (showAmount ? '' : '<div class="tt-sub">N/A</div>');
        tooltip.innerHTML = '<div class="tt-time">' + esc(dt) + '</div>' +
          '<div class="tt-val">' + (showAmount ? amount.toFixed(4) + ' ' + esc(lastTicker) : 'Unreported') + '</div>' +
          usdStr + partStr + subStr;
        var ttHalf = tooltip.offsetWidth / 2 + 8;
        var tipX = Math.max(ttHalf, Math.min(rect.width - ttHalf, pointX));
        var tipY = Math.max(25, pointY);
        tooltip.style.transform = 'translate(' + tipX + 'px,' + tipY + 'px) translate(-50%, calc(-100% - 14px))';
        tooltip.classList.add('active');
        lastTipIdx = idx;
      }
      markChartDirty();
    }

    chart.addEventListener('mousemove', queuePointer);
    chart.addEventListener('mouseleave', function () {
      hoveredIndex = -1;
      lastTipIdx = -1;
      if (tooltip) tooltip.classList.remove('active');
      markChartDirty();
    });
    chart.addEventListener('touchstart', queuePointer, { passive: true });
    chart.addEventListener('touchmove', queuePointer, { passive: true });
    document.addEventListener('touchstart', function (evt) {
      if (evt.target !== chart && touchPinned !== -1) {
        touchPinned = -1;
        hoveredIndex = -1;
        lastTipIdx = -1;
        if (tooltip) tooltip.classList.remove('active');
        markChartDirty();
      }
      if (!evt.target.closest || !evt.target.closest('.info')) {
        clearTipTimer();
        tipBtn = null;
        hideInfoTip();
      }
    }, { passive: true });

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
    var reported = lastGraphData.map(function (g) {
      return g.amount != null && isFinite(Number(g.amount)) && Number(g.amount) >= 0;
    });
    var amounts = lastGraphData.map(function (g, i) { return reported[i] ? Number(g.amount) : 0; });
    var maxVal = lastGraphMax;
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
    var labelCount = Math.min(count, Math.max(2, Math.min(6, Math.floor(w / 90) + 1)));
    for (var label = 0; label < labelCount; label++) {
      var li = Math.round(label * (count - 1) / (labelCount - 1 || 1));
      var lx = padding.left + li * step;
      var litem = lastGraphData[li];
      var ltime = litem && litem.created
        ? new Date(litem.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : (count - li) + 'h ago';
      ctx.fillText(ltime, lx, padding.top + h + 10);
    }

    var points = amounts.map(function (val, pi) {
      return { x: padding.left + pi * step, y: padding.top + h - (val / maxVal) * h, val: val };
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    var inGap = false;
    for (var gi = 0; gi < count; gi++) {
      if (!reported[gi]) {
        if (!inGap) {
          var before = gi > 0 ? points[gi - 1] : points[gi];
          ctx.moveTo(before.x, gi > 0 && reported[gi - 1] ? before.y : padding.top + h);
        }
        ctx.lineTo(points[gi].x, padding.top + h);
        inGap = true;
      } else if (inGap) {
        ctx.lineTo(points[gi].x, points[gi].y);
        inGap = false;
      }
    }
    ctx.stroke();
    ctx.restore();

    var areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
    areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    for (var start = 0; start < count;) {
      if (!reported[start]) { start++; continue; }
      var end = start;
      while (end + 1 < count && reported[end + 1]) end++;
      if (end > start) {
        ctx.beginPath();
        ctx.moveTo(points[start].x, padding.top + h);
        ctx.lineTo(points[start].x, points[start].y);
        for (var ai = start + 1; ai <= end; ai++) ctx.lineTo(points[ai].x, points[ai].y);
        ctx.lineTo(points[end].x, padding.top + h);
        ctx.closePath();
        ctx.fillStyle = areaGrad;
        ctx.fill();

        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(points[start].x, points[start].y);
        for (var si = start + 1; si <= end; si++) ctx.lineTo(points[si].x, points[si].y);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(points[start].x, points[start].y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
      }
      start = end + 1;
    }

    if (!reported.some(function (hasBucket) { return hasBucket; })) {
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No hourly income reported', rect.width / 2, padding.top + h / 2);
    }

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

      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#34d399';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function renderChart(graph, ticker, usdPrice) {
    lastGraphData = Array.isArray(graph) ? graph : [];
    lastTicker = ticker || 'VTC';
    lastUsdPrice = usdPrice || 0;
    hoveredIndex = -1;
    touchPinned = -1;
    lastTipIdx = -1;
    if (tooltip) tooltip.classList.remove('active');
    var m = 0.0001;
    for (var i = 0; i < lastGraphData.length; i++) {
      var v = lastGraphData[i].amount == null ? 0 : Number(lastGraphData[i].amount);
      if (isFinite(v) && v > m) m = v;
    }
    lastGraphMax = m * 1.15;
    markChartDirty();
  }

  function reconnectStream() {
    if (sseSource) sseSource.close();
    sseSource = new EventSource('/api/stream');
    sseSource.onerror = function () { };
    sseSource.onmessage = function (event) {
      try {
        updateUI(JSON.parse(event.data));
      } catch (e) { }
    };
    fetchDataOnce();
  }

  function fetchDataOnce() {
    fetch('/api/stats')
      .then(function (res) { return res.json(); })
      .then(updateUI)
      .catch(function () { });
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

    var left = document.createElement('div');
    left.className = 'page-left';
    left.textContent = 'Showing ' + start + '–' + end + ' of ' + total;

    var controls = document.createElement('div');
    controls.className = 'page-controls';

    var right = document.createElement('div');
    right.className = 'page-right';
    right.textContent = 'Page ' + state.page + ' of ' + pages;

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
    controls.appendChild(prevBtn);

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
    controls.appendChild(input);

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
    controls.appendChild(nextBtn);

    box.appendChild(left);
    box.appendChild(controls);
    box.appendChild(right);
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
    var dt = new Date(pay.timestamp * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return '<tr>' +
      '<td>' + dt + '</td>' +
      '<td style="color: var(--green-bright); font-weight: 700;">' + (parseFloat(pay.amount) || 0).toFixed(4) + ' ' + (lastTicker || 'VTC') + '</td>' +
      '<td style="font-family: var(--mono); font-size: 12px; color: var(--text-muted);">' + esc(pay.tx || 'N/A') + '</td></tr>';
  }

  function updateUI(data) {
    if (!data || !data.api || !data.api.account || !data.estimated) return;

    var ticker = data.coinTicker || 'VTC';
    var price = num(data.usdPrice);
    var apiAcc = data.api.account;
    var apiPool = data.api.pool || {};
    var est = data.estimated;
    var payout = data.payout || {};

    var key = JSON.stringify(data, function (k, v) { return k === 'timestamp' ? 0 : v; });
    if (key === lastPayloadKey) return;
    lastPayloadKey = key;

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

    lastTicker = ticker;
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
    } else if (payout.remaining != null && payout.remaining > 0) {
      setText('s-bal-eta', est.status === 'warming' ? 'ETA unavailable · warming up' :
        (est.status === 'waiting' ? 'ETA unavailable · awaiting pool credits' :
          'ETA unavailable · insufficient recent data'));
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
    } else if (est.available) {
      setText('v-est', '≈' + estHour.toFixed(4) + ' ' + ticker + '/h');
      setText('s-est-d', '≈' + estDay.toFixed(4) + ' ' + ticker + '/d' +
        (est.confidence === 'early' ? ' · early estimate' : ''));
    } else if (est.status === 'paused') {
      setText('v-est', 'PAUSED');
      setText('s-est-d', 'No workers online');
    } else if (est.status === 'warming') {
      setText('v-est', 'N/A');
      setText('s-est-d', 'Warming up · ' + num(est.sampleHours) + '/3 reported hours');
    } else if (est.status === 'waiting') {
      setText('v-est', 'N/A');
      setText('s-est-d', 'Awaiting recent pool credits');
    } else {
      setText('v-est', 'N/A');
      setText('s-est-d', 'Worker data unavailable');
    }
    setText('s-est-usd', est.available && !data.stale ? usd(estDay) + ' USD/d' :
      '24h reported: ' + num(est.observed24h).toFixed(4) + ' ' + ticker);

    var apiHour = num(income.hour);
    var api24 = num(income.day);
    setText('v-api', apiHour.toFixed(4) + ' ' + ticker + '/h');
    setText('s-api-d', api24.toFixed(4) + ' ' + ticker + '/d');
    setText('s-api-usd', usd(api24) + ' USD');

    var liveHr = num(hash.current);
    var h6 = num(hash.sixH);
    var h24 = num(hash.day);
    setText('v-hr', formatHashrateClient(liveHr));

    setText('s-hr-6h', '6H: ' + (h6 > 0 ? formatHashrateClient(h6) : '--'));
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

    pageState.workers.data = Array.isArray(data.workers) ? data.workers : [];
    pageState.payments.data = Array.isArray(data.payments) ? data.payments : [];

    renderWorkersTable();
    buildPagination('workersPagination', pageState.workers, 'workersTableBody');
    renderPaymentsTable();
    buildPagination('paymentsPagination', pageState.payments, 'paymentsTableBody');

    renderChart(data.hourlyGraph, ticker, price);
  }

  function renderTable(tableBodyId, state) {
    if (tableBodyId === 'workersTableBody') renderWorkersTable();
    else renderPaymentsTable();
  }

  function initInfoTips() {
    document.addEventListener('mouseover', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      if (btn === tipBtn && (infoTip || tipTimer)) return;
      clearTipTimer();
      tipBtn = btn;
      var tip = btn.getAttribute('data-tip');
      if (!tip) {
        tipBtn = null;
        return;
      }
      tipTimer = setTimeout(function () {
        tipTimer = null;
        showInfoTip(btn, tip);
      }, 100);
    });

    document.addEventListener('focusin', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      var tip = btn.getAttribute('data-tip');
      if (!tip) return;
      clearTipTimer();
      tipBtn = btn;
      showInfoTip(btn, tip);
    });

    document.addEventListener('mouseout', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      var rel = evt.relatedTarget;
      if (rel && btn.contains && btn.contains(rel)) return;
      if (btn !== tipBtn || document.activeElement === btn) return;
      clearTipTimer();
      tipBtn = null;
      hideInfoTip();
    });

    document.addEventListener('focusout', function (evt) {
      var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
      if (!btn) return;
      clearTipTimer();
      tipBtn = null;
      hideInfoTip();
    });

    window.addEventListener('resize', scheduleInfoTipPosition);
    window.addEventListener('scroll', scheduleInfoTipPosition, { passive: true, capture: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleInfoTipPosition);
      window.visualViewport.addEventListener('scroll', scheduleInfoTipPosition);
    }
  }

  function clampTip(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function positionInfoTip(bubble, btn) {
    var viewport = window.visualViewport;
    var viewLeft = viewport ? viewport.offsetLeft : 0;
    var viewTop = viewport ? viewport.offsetTop : 0;
    var viewWidth = viewport ? viewport.width : window.innerWidth;
    var viewHeight = viewport ? viewport.height : window.innerHeight;
    var margin = 12;
    var gap = 10;
    var rightEdge = viewLeft + viewWidth - margin;
    var bottomEdge = viewTop + viewHeight - margin;
    var rect = btn.getBoundingClientRect();

    bubble.style.maxWidth = Math.max(0, viewWidth - margin * 2) + 'px';
    bubble.style.maxHeight = Math.max(0, viewHeight - margin * 2) + 'px';
    var bw = bubble.offsetWidth;
    var bh = bubble.offsetHeight;
    if (rect.bottom < viewTop || rect.top > viewTop + viewHeight ||
        rect.right < viewLeft || rect.left > viewLeft + viewWidth) return false;

    var left;
    var top;
    if (viewWidth > 640 && rect.right + gap + bw <= rightEdge) {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - bh / 2;
    } else if (viewWidth > 640 && rect.left - gap - bw >= viewLeft + margin) {
      left = rect.left - gap - bw;
      top = rect.top + rect.height / 2 - bh / 2;
    } else {
      left = rect.left + rect.width / 2 - bw / 2;
      if (rect.bottom + gap + bh <= bottomEdge) {
        top = rect.bottom + gap;
      } else if (rect.top - gap - bh >= viewTop + margin) {
        top = rect.top - gap - bh;
      } else {
        top = rect.top + rect.height / 2 - bh / 2;
      }
    }

    bubble.style.left = clampTip(left, viewLeft + margin, rightEdge - bw) + 'px';
    bubble.style.top = clampTip(top, viewTop + margin, bottomEdge - bh) + 'px';
    return true;
  }

  function scheduleInfoTipPosition() {
    if (!infoTip || !tipBtn || tipPositionPending) return;
    tipPositionPending = true;
    requestAnimationFrame(function () {
      tipPositionPending = false;
      if (infoTip && tipBtn && !positionInfoTip(infoTip, tipBtn)) {
        tipBtn = null;
        hideInfoTip();
      }
    });
  }

  function showInfoTip(btn, tip) {
    hideInfoTip();
    var bubble = document.createElement('div');
    bubble.className = 'info-tip';
    bubble.textContent = tip;
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);

    if (!positionInfoTip(bubble, btn)) {
      document.body.removeChild(bubble);
      tipBtn = null;
      return;
    }
    bubble.classList.add('show');
    infoTip = bubble;
  }

  function hideInfoTip() {
    if (!infoTip) return;
    if (infoTip.parentNode) infoTip.parentNode.removeChild(infoTip);
    infoTip = null;
  }

  var walletAddrNode = el('walletAddr');
  if (walletAddrNode) walletAddrNode.textContent = DEFAULT_WALLET || '';
  var walletBtn = el('walletCopy');
  if (walletBtn) {
    if (!DEFAULT_WALLET) walletBtn.style.display = 'none';
    else walletBtn.addEventListener('click', copyWallet);
  }
  initChart();
  initInfoTips();
  reconnectStream();
})();
