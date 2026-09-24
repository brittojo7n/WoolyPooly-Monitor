function num(v) {
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}

function formatEta(hours) {
  if (hours == null || !isFinite(hours) || hours <= 0) return '--';
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + 'm';
  if (hours < 48) return hours.toFixed(1) + 'h';
  return (hours / 24).toFixed(1) + 'd';
}

function formatHashrateClient(hashesPerSec) {
  var h = typeof hashesPerSec === 'number' && isFinite(hashesPerSec) ? hashesPerSec : 0;
  if (h <= 0) return '0.00 H/s';
  if (h >= 1e12) return (h / 1e12).toFixed(2) + ' TH/s';
  if (h >= 1e9) return (h / 1e9).toFixed(2) + ' GH/s';
  if (h >= 1e6) return (h / 1e6).toFixed(2) + ' MH/s';
  if (h >= 1e3) return (h / 1e3).toFixed(2) + ' kH/s';
  return h.toFixed(2) + ' H/s';
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export { num, formatEta, formatHashrateClient, esc };
