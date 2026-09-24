const fs = require('fs');
const path = require('path');

const COINS = [
  { id: 'vtc-1', code: 'vtc' },
  { id: 'kas-1', code: 'kas' },
  { id: 'cfx-1', code: 'cfx' },
  { id: 'etc-1', code: 'etc' },
  { id: 'firo-1', code: 'firo' },
  { id: 'octa-1', code: 'octa' },
  { id: 'raven-1', code: 'rvn' },
  { id: 'ergo-1', code: 'erg' }
];

const COIN_IDS = COINS.map(coin => coin.id);
const COIN_ALIASES = Object.fromEntries(COINS.map(coin => [coin.code, coin.id]));

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
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
  return COIN_ALIASES[key] || (COIN_IDS.includes(key) ? key : null);
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

const REFRESH_INTERVAL_MS = 20000;

function parsePayoutThreshold(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 1;
  const n = Number(s);
  return (Number.isFinite(n) && n > 0) ? n : 1;
}

const PAYOUT_THRESHOLD = parsePayoutThreshold(process.env.PAYOUT_THRESHOLD);

module.exports = {
  PORT,
  DEFAULT_WALLET,
  REFRESH_INTERVAL_MS,
  PAYOUT_THRESHOLD,
  normalizeCoin
};
