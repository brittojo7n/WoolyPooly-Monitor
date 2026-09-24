import state from '../lib/state.js';
import { renderPagedRows } from './pagination.js';
import { formatHashrateClient, esc } from '../lib/format.js';

function workerRow(w) {
  var statusClass = w.offline ? 'status-offline' : 'status-online';
  return '<tr>' +
    '<td><span class="status-dot ' + statusClass + '"></span>' + esc(w.worker || 'unnamed') + '</td>' +
    '<td>' + (w.hr != null ? formatHashrateClient(w.hr) : '--') + '</td>' +
    '<td>' + (w.hr2 != null ? formatHashrateClient(w.hr2) : '--') + '</td>' +
    '<td>' + (w.hr3 != null ? formatHashrateClient(w.hr3) : '--') + '</td></tr>';
}

function renderWorkersTable() {
  renderPagedRows(state.workers, 'workersTableBody', 4, 'No workers', workerRow);
}

export { renderWorkersTable, workerRow };
