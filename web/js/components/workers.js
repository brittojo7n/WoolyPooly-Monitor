import state from '../lib/state.js';
import { renderPagedRows } from './pagination.js';
import { formatHashrateClient, esc } from '../lib/format.js';

function workerRow(w) {
  var statusClass = w.offline ? 'status-offline' : 'status-online';
  var rawName = String(w.worker || 'unnamed');
  var nameEsc = esc(rawName);
  var hr1 = w.hr != null ? formatHashrateClient(w.hr) : '--';
  var hr2 = w.hr2 != null ? formatHashrateClient(w.hr2) : '--';
  var hr3 = w.hr3 != null ? formatHashrateClient(w.hr3) : '--';
  return '<tr>' +
    '<td class="worker-col">' +
      '<div class="worker-item">' +
        '<span class="status-dot ' + statusClass + '"></span>' +
        '<span class="worker-name truncate-text" data-full-text="' + nameEsc + '">' + nameEsc + '</span>' +
      '</div>' +
    '</td>' +
    '<td><span class="truncate-text" data-full-text="' + esc(hr1) + '">' + esc(hr1) + '</span></td>' +
    '<td><span class="truncate-text" data-full-text="' + esc(hr2) + '">' + esc(hr2) + '</span></td>' +
    '<td><span class="truncate-text" data-full-text="' + esc(hr3) + '">' + esc(hr3) + '</span></td></tr>';
}

function renderWorkersTable() {
  renderPagedRows(state.workers, 'workersTableBody', 4, 'No workers', workerRow);
}

export { renderWorkersTable, workerRow };
