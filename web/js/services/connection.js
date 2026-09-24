import state from '../lib/state.js';
import { updateUI } from './ui.js';

function reconnectStream() {
  if (state.sseSource) state.sseSource.close();
  state.sseSource = new EventSource('/api/stream');
  state.sseSource.onerror = function () { };
  state.sseSource.onmessage = function (event) {
    try {
      updateUI(JSON.parse(event.data));
    } catch (e) {
      console.error('SSE updateUI error:', e);
    }
  };
  fetchDataOnce();
}

function fetchDataOnce() {
  fetch('/api/stats')
    .then(function (res) { return res.json(); })
    .then(updateUI)
    .catch(function (err) {
      console.error('fetchDataOnce error:', err);
    });
}

export { reconnectStream, fetchDataOnce };
