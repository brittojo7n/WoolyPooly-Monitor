import state from './state.js';
import { el } from './dom.js';

function copyWallet() {
  var btn = el('walletCopy');
  function done(ok) {
    if (!btn) return;
    if (btn.classList.toggle) btn.classList.toggle('copied', !!ok);
    else if (ok) btn.classList.add('copied');
    if (state.walletCopyTimer) clearTimeout(state.walletCopyTimer);
    state.walletCopyTimer = setTimeout(function () {
      btn.classList.remove('copied');
    }, 1200);
  }
  function legacyCopy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = state.defaultWallet;
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
  if (!state.defaultWallet) {
    done(false);
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(state.defaultWallet).then(function () {
      done(true);
    }, legacyCopy);
  } else {
    legacyCopy();
  }
}

export { copyWallet };
