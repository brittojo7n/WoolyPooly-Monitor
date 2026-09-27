import state from '../lib/state.js';
import { renderPagedRows } from './pagination.js';
import { esc } from '../lib/format.js';

function parseTimestamp(ts) {
  if (typeof ts === 'number') {
    return ts < 1e11 ? ts * 1000 : ts;
  }
  var parsed = Date.parse(ts);
  return isFinite(parsed) ? parsed : null;
}

function paymentRow(pay) {
  var ms = parseTimestamp(pay.timestamp);
  var dt = ms ? new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'N/A';
  var amt = (parseFloat(pay.amount) || 0).toFixed(4) + ' ' + (state.ticker || 'VTC');
  var tx = pay.tx || 'N/A';
  return '<tr>' +
    '<td><span class="truncate-text" data-full-text="' + esc(dt) + '">' + esc(dt) + '</span></td>' +
    '<td style="color: var(--green-bright); font-weight: 700;"><span class="truncate-text" data-full-text="' + esc(amt) + '">' + esc(amt) + '</span></td>' +
    '<td style="font-family: var(--mono); font-size: 12px; color: var(--text-muted);"><span class="truncate-text" data-full-text="' + esc(tx) + '">' + esc(tx) + '</span></td></tr>';
}

function renderPaymentsTable() {
  renderPagedRows(state.payments, 'paymentsTableBody', 3, 'No payments', paymentRow);
}

export { renderPaymentsTable, paymentRow };
