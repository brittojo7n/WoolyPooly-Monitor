import state from '../lib/state.js';
import { esc } from '../lib/format.js';
import { clearTipTimer, hideInfoTip } from '../services/info-tip.js';

function markChartDirty() {
  if (state.chartDirty) return;
  state.chartDirty = true;
  requestAnimationFrame(drawCanvasChart);
}

function initChart() {
  state.chart = document.getElementById('velocityCanvas');
  state.tooltip = document.getElementById('chartTooltip');
  if (!state.chart) return;

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

  state.chart.addEventListener('mousemove', queuePointer);
  state.chart.addEventListener('mouseleave', function () {
    state.hoveredIndex = -1;
    state.lastTipIdx = -1;
    if (state.tooltip) state.tooltip.classList.remove('active');
    markChartDirty();
  });
  state.chart.addEventListener('touchstart', queuePointer, { passive: true });
  state.chart.addEventListener('touchmove', queuePointer, { passive: true });
  document.addEventListener('touchstart', function (evt) {
    if (evt.target !== state.chart && state.touchPinned !== -1) {
      state.touchPinned = -1;
      state.hoveredIndex = -1;
      state.lastTipIdx = -1;
      if (state.tooltip) state.tooltip.classList.remove('active');
      markChartDirty();
    }
    if (!evt.target.closest || !evt.target.closest('.info')) {
      clearTipTimer();
      state.tipBtn = null;
      hideInfoTip();
    }
  }, { passive: true });

  window.addEventListener('resize', function () {
    if (state.graphData) markChartDirty();
  });
}

function handlePointer(clientX, type, isTouch) {
  if (!state.graphData || state.graphData.length === 0) return;
  var rect = state.chart.getBoundingClientRect();
  var x = clientX - rect.left;
  var padding = { top: 20, right: 20, bottom: 35, left: 60 };
  var w = rect.width - padding.left - padding.right;
  var count = state.graphData.length;

  if (x < padding.left || x > rect.width - padding.right) {
    if (state.hoveredIndex === -1 && state.touchPinned === -1) return;
    state.hoveredIndex = -1;
    state.touchPinned = -1;
    state.lastTipIdx = -1;
    if (state.tooltip) state.tooltip.classList.remove('active');
    markChartDirty();
    return;
  }

  var step = w / (count - 1 || 1);
  var idx = Math.max(0, Math.min(count - 1, Math.round((x - padding.left) / step)));
  if (type === 'touchstart' && idx === state.touchPinned) {
    state.touchPinned = -1;
    state.hoveredIndex = -1;
    state.lastTipIdx = -1;
    if (state.tooltip) state.tooltip.classList.remove('active');
    markChartDirty();
    return;
  }
  if (idx === state.hoveredIndex && idx === state.lastTipIdx) return;
  if (isTouch) state.touchPinned = idx;
  state.hoveredIndex = idx;

  var item = state.graphData[idx];
  var reported = item.amount != null && isFinite(Number(item.amount)) && Number(item.amount) >= 0;
  var waiting = !reported && item.status === 'pending';
  var amount = reported ? Number(item.amount) : 0;
  var pointX = padding.left + idx * step;
  var maxVal = state.graphMax;
  var h = rect.height - padding.top - padding.bottom;
  var pointY = padding.top + h - (amount / maxVal) * h;

  if (state.tooltip) {
    var dt = item.created ? new Date(item.created).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Hour ' + (idx + 1);
    var usdStr = reported && (amount * state.usdPrice) > 0 ? '<div class="tt-usd">($' + (amount * state.usdPrice).toFixed(4) + ' USD)</div>' : '';
    var partStr = reported && item.participation ? '<div class="tt-sub">Pool: ' + (item.participation * 100).toFixed(4) + '%</div>' : '';
    var subStr = reported ? '' : '<div class="tt-sub">N/A</div>';
    state.tooltip.innerHTML = waiting
      ? '<div class="tt-val">Waiting</div><div class="tt-sub">for data</div>'
      : '<div class="tt-time">' + esc(dt) + '</div>' +
      '<div class="tt-val">' + (reported ? amount.toFixed(4) + ' ' + esc(state.ticker) : 'Unreported') + '</div>' +
      usdStr + partStr + subStr;
    var ttHalf = state.tooltip.offsetWidth / 2 + 8;
    var tipX = Math.max(ttHalf, Math.min(rect.width - ttHalf, pointX));
    var tipY = Math.max(25, pointY);
    state.tooltip.style.transform = 'translate(' + tipX + 'px,' + tipY + 'px) translate(-50%, calc(-100% - 14px))';
    state.tooltip.classList.add('active');
    state.lastTipIdx = idx;
  }
  markChartDirty();
}

function drawCanvasChart() {
  state.chartDirty = false;
  if (!state.chart || document.hidden) return;
  var ctx = state.chart.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var rect = state.chart.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  state.chart.width = Math.round(rect.width * dpr);
  state.chart.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!state.graphData || state.graphData.length === 0) {
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
  var reported = state.graphData.map(function (g) {
    return g.amount != null && isFinite(Number(g.amount)) && Number(g.amount) >= 0;
  });
  var amounts = state.graphData.map(function (g, i) { return reported[i] ? Number(g.amount) : 0; });
  var maxVal = state.graphMax;
  var count = state.graphData.length;
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

  ctx.textBaseline = 'top';
  var minLabelSpacing = 75;
  var maxLabelsAllowed = Math.max(2, Math.floor(w / minLabelSpacing) + 1);
  var intervals = [1, 2, 3, 4, 6, 8, 12, 24];
  var chosenInterval = intervals[intervals.length - 1];
  for (var k = 0; k < intervals.length; k++) {
    var numLabels = Math.floor((count - 1) / intervals[k]) + 1;
    if (numLabels <= maxLabelsAllowed) {
      chosenInterval = intervals[k];
      break;
    }
  }

  var labelIndices = [];
  for (var idx = count - 1; idx >= 0; idx -= chosenInterval) {
    labelIndices.unshift(idx);
  }

  for (var li = 0; li < labelIndices.length; li++) {
    var index = labelIndices[li];
    var lx = padding.left + index * step;
    var litem = state.graphData[index];
    var ltime = litem && litem.created
      ? new Date(litem.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : (count - index) + 'h ago';

    if (index === count - 1) {
      ctx.textAlign = 'right';
    } else if (index === 0) {
      ctx.textAlign = 'left';
    } else {
      ctx.textAlign = 'center';
    }

    ctx.fillText(ltime, lx, padding.top + h + 10);
  }

  var points = amounts.map(function (val, pi) {
    return { x: padding.left + pi * step, y: padding.top + h - (val / maxVal) * h, val: val };
  });

  var areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
  areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + h);
  ctx.lineTo(points[0].x, points[0].y);
  for (var ai = 1; ai < count; ai++) ctx.lineTo(points[ai].x, points[ai].y);
  ctx.lineTo(points[count - 1].x, padding.top + h);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(16, 185, 129, 0.6)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (var li = 1; li < count; li++) ctx.lineTo(points[li].x, points[li].y);
  ctx.stroke();
  ctx.restore();

  if (state.hoveredIndex >= 0 && state.hoveredIndex < points.length) {
    var hp = points[state.hoveredIndex];
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(hp.x, padding.top);
    ctx.lineTo(hp.x, padding.top + h);
    ctx.stroke();
    ctx.restore();
  }
}

function renderChart(graph, ticker, usdPrice) {
  state.graphData = Array.isArray(graph) ? graph : [];
  state.ticker = ticker || 'VTC';
  state.usdPrice = usdPrice || 0;
  state.hoveredIndex = -1;
  state.touchPinned = -1;
  state.lastTipIdx = -1;
  if (state.tooltip) state.tooltip.classList.remove('active');
  var m = 0.0001;
  for (var i = 0; i < state.graphData.length; i++) {
    var v = state.graphData[i].amount == null ? 0 : Number(state.graphData[i].amount);
    if (isFinite(v) && v > m) m = v;
  }
  state.graphMax = m * 1.15;
  markChartDirty();
}

export { initChart, renderChart, markChartDirty, drawCanvasChart };
