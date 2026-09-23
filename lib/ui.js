const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '\'');
}

function renderHtmlPage(config) {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  return html.replace(/{{DEFAULT_WALLET}}/g, escapeHtml(config.DEFAULT_WALLET));
}

module.exports = {
  renderHtmlPage
};