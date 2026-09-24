const fs = require('fs');
const path = require('path');
const constants = require('./constants');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}

function normalizeCoin(coin) {
  const key = String(coin || '').trim().toLowerCase();
  return constants.COIN_ALIASES[key] || (constants.COIN_IDS.includes(key) ? key : null);
}

function parsePayoutThreshold(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 1;
  const n = Number(s);
  return (Number.isFinite(n) && n > 0) ? n : 1;
}

loadEnv();

const PORT = Number(process.env.SERVER_PORT);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT is missing or invalid:', process.env.SERVER_PORT);
  process.exit(1);
}

const DEFAULT_WALLET = String(process.env.WALLET || '').trim();
if (!DEFAULT_WALLET) {
  console.error('WALLET is required in .env');
  process.exit(1);
}

const PAYOUT_THRESHOLD = parsePayoutThreshold(process.env.PAYOUT_THRESHOLD);

module.exports = {
  PORT,
  DEFAULT_WALLET,
  PAYOUT_THRESHOLD,
  REFRESH_INTERVAL_MS: constants.REFRESH_INTERVAL_MS,
  normalizeCoin
};
