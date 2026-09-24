import state from './lib/state.js';
import { copyWallet } from './lib/clipboard.js';
import { initChart } from './components/chart.js';
import { initInfoTips } from './services/info-tip.js';
import { reconnectStream } from './services/connection.js';

state.defaultWallet = (document.body && document.body.dataset.defaultWallet) || '';

var walletAddrNode = document.getElementById('walletAddr');
if (walletAddrNode) walletAddrNode.textContent = state.defaultWallet || '';
var walletBtn = document.getElementById('walletCopy');
if (walletBtn) {
  if (!state.defaultWallet) walletBtn.style.display = 'none';
  else walletBtn.addEventListener('click', copyWallet);
}
initChart();
initInfoTips();
reconnectStream();
