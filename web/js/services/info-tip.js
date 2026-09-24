import state from '../lib/state.js';

function clearTipTimer() {
  if (state.tipTimer) {
    clearTimeout(state.tipTimer);
    state.tipTimer = null;
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
  if (!state.infoTip || !state.tipBtn || state.tipPositionPending) return;
  state.tipPositionPending = true;
  requestAnimationFrame(function () {
    state.tipPositionPending = false;
    if (state.infoTip && state.tipBtn && !positionInfoTip(state.infoTip, state.tipBtn)) {
      state.tipBtn = null;
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
    state.tipBtn = null;
    return;
  }
  bubble.classList.add('show');
  state.infoTip = bubble;
}

function hideInfoTip() {
  if (!state.infoTip) return;
  if (state.infoTip.parentNode) state.infoTip.parentNode.removeChild(state.infoTip);
  state.infoTip = null;
}

function initInfoTips() {
  document.addEventListener('mouseover', function (evt) {
    var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
    if (!btn) return;
    if (btn === state.tipBtn && (state.infoTip || state.tipTimer)) return;
    clearTipTimer();
    state.tipBtn = btn;
    var tip = btn.getAttribute('data-tip');
    if (!tip) {
      state.tipBtn = null;
      return;
    }
    state.tipTimer = setTimeout(function () {
      state.tipTimer = null;
      showInfoTip(btn, tip);
    }, 100);
  });

  document.addEventListener('focusin', function (evt) {
    var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
    if (!btn) return;
    var tip = btn.getAttribute('data-tip');
    if (!tip) return;
    clearTipTimer();
    state.tipBtn = btn;
    showInfoTip(btn, tip);
  });

  document.addEventListener('mouseout', function (evt) {
    var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
    if (!btn) return;
    var rel = evt.relatedTarget;
    if (rel && btn.contains && btn.contains(rel)) return;
    if (btn !== state.tipBtn || document.activeElement === btn) return;
    clearTipTimer();
    state.tipBtn = null;
    hideInfoTip();
  });

  document.addEventListener('focusout', function (evt) {
    var btn = evt.target && (evt.target.closest ? evt.target.closest('.info') : null);
    if (!btn) return;
    clearTipTimer();
    state.tipBtn = null;
    hideInfoTip();
  });

  window.addEventListener('resize', scheduleInfoTipPosition);
  window.addEventListener('scroll', scheduleInfoTipPosition, { passive: true, capture: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleInfoTipPosition);
    window.visualViewport.addEventListener('scroll', scheduleInfoTipPosition);
  }
}

export { initInfoTips, clearTipTimer, hideInfoTip };
