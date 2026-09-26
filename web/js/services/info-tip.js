import state from '../lib/state.js';

var lastTouchTime = 0;

function markTouch() {
  lastTouchTime = Date.now();
}

function clearTipTimer() {
  if (state.tipTimer) {
    clearTimeout(state.tipTimer);
    state.tipTimer = null;
  }
}

function clampTip(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function isTextTruncated(el) {
  if (!el) return false;
  var inner = el.querySelector ? el.querySelector('.truncate-text, .worker-name') : null;
  var target = inner || el;
  return target.scrollWidth > Math.ceil(target.clientWidth) + 1;
}

function positionInfoTip(bubble, targetEl) {
  var viewport = window.visualViewport;
  var viewLeft = viewport ? viewport.offsetLeft : 0;
  var viewTop = viewport ? viewport.offsetTop : 0;
  var viewWidth = viewport ? viewport.width : window.innerWidth;
  var viewHeight = viewport ? viewport.height : window.innerHeight;
  var margin = 12;
  var gap = 10;
  var rightEdge = viewLeft + viewWidth - margin;
  var bottomEdge = viewTop + viewHeight - margin;
  var rect = targetEl.getBoundingClientRect();

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
      hideInfoTip();
    }
  });
}

function showInfoTip(targetEl, tip) {
  hideInfoTip();
  var bubble = document.createElement('div');
  bubble.className = 'info-tip';
  bubble.textContent = tip;
  bubble.setAttribute('role', 'tooltip');
  document.body.appendChild(bubble);

  if (!positionInfoTip(bubble, targetEl)) {
    document.body.removeChild(bubble);
    state.tipBtn = null;
    return;
  }
  bubble.classList.add('show');
  state.infoTip = bubble;
  state.tipBtn = targetEl;
  state.tipShownAt = Date.now();
}

function hideInfoTip() {
  if (state.tipTimer) {
    clearTimeout(state.tipTimer);
    state.tipTimer = null;
  }
  if (state.infoTip) {
    if (state.infoTip.parentNode) state.infoTip.parentNode.removeChild(state.infoTip);
    state.infoTip = null;
  }
  state.tipBtn = null;
  state.tipShownAt = 0;
}

function resolveTipTarget(evtTarget) {
  if (!evtTarget || !evtTarget.closest) return null;

  var infoBtn = evtTarget.closest('.info');
  if (infoBtn) {
    var tip = infoBtn.getAttribute('data-tip');
    if (tip) return { el: infoBtn, tip: tip, isWorker: false };
  }

  var tipEl = evtTarget.closest('[data-tip]');
  if (tipEl) {
    var tip = tipEl.getAttribute('data-tip');
    if (tip) return { el: tipEl, tip: tip, isWorker: false };
  }

  var truncTarget = evtTarget.closest('.truncate-text, .worker-name, .metric-value, .metric-sub, td, th, .price-pill, .bar-pct');
  if (truncTarget) {
    if (isTextTruncated(truncTarget)) {
      var targetInner = truncTarget.querySelector ? truncTarget.querySelector('[data-full-text], [data-worker-name]') : null;
      var effectiveEl = targetInner || truncTarget;
      var text = effectiveEl.getAttribute('data-full-text') ||
                 effectiveEl.getAttribute('data-worker-name') ||
                 effectiveEl.textContent.trim();
      if (text) return { el: truncTarget, tip: text, isWorker: true };
    }
  }

  return null;
}

function initInfoTips() {
  document.addEventListener('touchstart', markTouch, { passive: true, capture: true });
  document.addEventListener('pointerdown', function (evt) {
    if (evt.pointerType === 'touch') {
      markTouch();
    }
    if (state.infoTip) {
      var target = resolveTipTarget(evt.target);
      if (!target || target.el !== state.tipBtn) {
        if (!state.infoTip.contains(evt.target)) {
          hideInfoTip();
        }
      }
    }
  }, { passive: true, capture: true });

  document.addEventListener('mouseover', function (evt) {
    if (Date.now() - lastTouchTime < 700) return;

    var target = resolveTipTarget(evt.target);
    if (!target) return;
    if (target.el === state.tipBtn && (state.infoTip || state.tipTimer)) return;
    clearTipTimer();
    state.tipBtn = target.el;
    state.tipTimer = setTimeout(function () {
      state.tipTimer = null;
      showInfoTip(target.el, target.tip);
    }, target.isWorker ? 60 : 100);
  });

  document.addEventListener('focusin', function (evt) {
    if (Date.now() - lastTouchTime < 700) return;

    var target = resolveTipTarget(evt.target);
    if (!target) return;
    clearTipTimer();
    showInfoTip(target.el, target.tip);
  });

  document.addEventListener('mouseout', function (evt) {
    if (Date.now() - lastTouchTime < 700) return;

    var target = resolveTipTarget(evt.target);
    if (!target) return;
    var rel = evt.relatedTarget;
    if (rel && target.el.contains && target.el.contains(rel)) return;
    if (target.el !== state.tipBtn) return;
    clearTipTimer();
    hideInfoTip();
  });

  document.addEventListener('focusout', function (evt) {
    if (Date.now() - lastTouchTime < 700) return;

    var target = resolveTipTarget(evt.target);
    if (!target) return;
    clearTipTimer();
    hideInfoTip();
  });

  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape' || evt.key === 'Esc') {
      if (state.infoTip) {
        hideInfoTip();
      }
    }
  });

  document.addEventListener('click', function (evt) {
    var isTouch = Date.now() - lastTouchTime < 700;
    var target = resolveTipTarget(evt.target);
    if (!target) {
      if (state.infoTip) {
        hideInfoTip();
      }
      return;
    }

    if (isTouch) {
      if (state.tipBtn === target.el && state.infoTip) {
        hideInfoTip();
      } else {
        clearTipTimer();
        showInfoTip(target.el, target.tip);
      }
    } else {
      // Desktop mouse click: keep tooltip visible and avoid sticky focus
      clearTipTimer();
      if (!state.infoTip || state.tipBtn !== target.el) {
        showInfoTip(target.el, target.tip);
      }
      if (typeof target.el.blur === 'function') {
        target.el.blur();
      }
    }
  });

  window.addEventListener('resize', scheduleInfoTipPosition);
  window.addEventListener('scroll', scheduleInfoTipPosition, { passive: true, capture: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleInfoTipPosition);
    window.visualViewport.addEventListener('scroll', scheduleInfoTipPosition);
  }
}

export { initInfoTips, clearTipTimer, hideInfoTip, isTextTruncated };
