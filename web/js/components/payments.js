import state from '../lib/state.js';
import { renderPagedRows, buildPagination } from './pagination.js';
import { esc } from '../lib/format.js';

function parseTimestamp(ts) {
  if (typeof ts === 'number') {
    return ts < 1e11 ? ts * 1000 : ts;
  }
  var parsed = Date.parse(ts);
  return isFinite(parsed) ? parsed : 0;
}

function parseAmount(amt) {
  return typeof amt === 'number' ? amt : (parseFloat(amt) || 0);
}

function updateSortHeaders() {
  var headers = document.querySelectorAll('.payments-card th.sortable');
  var sortBy = state.payments.sortBy;
  var sortDir = state.payments.sortDir;

  for (var i = 0; i < headers.length; i++) {
    var th = headers[i];
    var key = th.getAttribute('data-sort');
    th.classList.remove('sort-asc', 'sort-desc');
    th.removeAttribute('aria-sort');
    
    if (key === sortBy) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
    }
  }
}

function applyPaymentsSort() {
  var raw = state.payments.rawData || state.payments.data || [];
  if (!state.payments.sortBy) {
    state.payments.data = raw.slice();
  } else {
    var sortBy = state.payments.sortBy;
    var sortDir = state.payments.sortDir;
    var mul = sortDir === 'asc' ? 1 : -1;

    state.payments.data = raw.slice().sort(function (a, b) {
      var ta = parseTimestamp(a && a.timestamp);
      var tb = parseTimestamp(b && b.timestamp);
      var amtA = parseAmount(a && a.amount);
      var amtB = parseAmount(b && b.amount);

      if (sortBy === 'time') {
        if (ta !== tb) return (ta - tb) * mul;
        return amtB - amtA;
      }
      if (sortBy === 'amount') {
        if (amtA !== amtB) return (amtA - amtB) * mul;
        return tb - ta;
      }
      return 0;
    });
  }
  updateSortHeaders();
}

function handleSortClick(key) {
  if (state.payments.sortBy !== key) {
    state.payments.sortBy = key;
    state.payments.sortDir = 'asc';
  } else if (state.payments.sortDir === 'asc') {
    state.payments.sortDir = 'desc';
  } else {
    state.payments.sortBy = null;
    state.payments.sortDir = null;
  }
  state.payments.page = 1;
  renderPaymentsTable();
  buildPagination('paymentsPagination', state.payments, renderPaymentsTable);
}

function initPayments() {
  var headers = document.querySelectorAll('.payments-card th.sortable');
  
  for (var i = 0; i < headers.length; i++) {
    (function(th) {
      var key = th.getAttribute('data-sort');
      th.addEventListener('click', function () { handleSortClick(key); });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSortClick(key);
        }
      });
    })(headers[i]);
  }
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
  applyPaymentsSort();
  renderPagedRows(state.payments, 'paymentsTableBody', 3, 'No payments', paymentRow);
}

export { initPayments, renderPaymentsTable };
