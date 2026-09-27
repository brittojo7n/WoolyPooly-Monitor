const fs = require('fs');
const path = require('path');

let cachedHtml = null;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtmlPage(config) {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, '..', '..', 'web', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  cachedHtml = html.replace(/{{DEFAULT_WALLET}}/g, escapeHtml(config.DEFAULT_WALLET));
  return cachedHtml;
}

module.exports = {
  renderHtmlPage
};
