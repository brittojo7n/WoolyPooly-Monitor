const fs = require('fs');
const path = require('path');

const COINS = [
  {
    id: 'vtc-1',
    code: 'vtc',
    label: 'VTC',
    detect: (address, lowerAddress) => lowerAddress.startsWith('vtc1')
  },
  {
    id: 'kas-1',
    code: 'kas',
    label: 'KAS',
    detect: (address, lowerAddress) => lowerAddress.startsWith('kaspa:')
  },
  {
    id: 'cfx-1',
    code: 'cfx',
    label: 'CFX',
    detect: (address, lowerAddress) => lowerAddress.startsWith('cfx:')
  },
  {
    id: 'etc-1',
    code: 'etc',
    label: 'ETC'
  },
  {
    id: 'firo-1',
    code: 'firo',
    label: 'FIRO',
    detect: (address) => /^a[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
  },
  {
    id: 'octa-1',
    code: 'octa',
    label: 'OCTA'
  },
  {
    id: 'raven-1',
    code: 'rvn',
    label: 'RVN',
    detect: (address) => /^[rR][1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
  },
  {
    id: 'ergo-1',
    code: 'erg',
    label: 'ERG',
    detect: (address) => /^9[1-9A-HJ-NP-Za-km-z]{50}$/.test(address)
  }
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

function isValidCoin(coin) {
  return normalizeCoin(coin) != null;
}

function detectCoinFromWallet(wallet) {
  const address = String(wallet || '').trim();
  const lowerAddress = address.toLowerCase();
  const coin = COINS.find(item => item.detect && item.detect(address, lowerAddress));
  return coin ? coin.id : null;
}

function resolveCoin(wallet, requestedCoin) {
  const requested = normalizeCoin(requestedCoin);
  if (requestedCoin && !requested) return null;
  return requested || detectCoinFromWallet(wallet);
}

loadEnv();

const PORT = Number(process.env.SERVER_PORT);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('SERVER_PORT is missing or invalid:', process.env.SERVER_PORT);
  process.exit(1);
}

const DEFAULT_WALLET = String(process.env.DEFAULT_WALLET || '').trim();
if (!DEFAULT_WALLET) {
  console.error('DEFAULT_WALLET is required in .env');
  process.exit(1);
}

const DEFAULT_COIN = resolveCoin(DEFAULT_WALLET) || '';

const REFRESH_INTERVAL_SEC = Number(process.env.REFRESH_INTERVAL_SEC || 20);
if (!Number.isInteger(REFRESH_INTERVAL_SEC) || REFRESH_INTERVAL_SEC < 5 || REFRESH_INTERVAL_SEC > 300) {
  console.error('REFRESH_INTERVAL_SEC must be an integer between 5 and 300 (seconds):', process.env.REFRESH_INTERVAL_SEC);
  process.exit(1);
}
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_SEC * 1000;

// Fallback payout threshold used only when the pool stats endpoint is
// unavailable (WoolyPooly reports minPay per-coin in its stats endpoint;
// for VTC it is 1). Optional override via .env.
const PAYOUT_THRESHOLD = Number(process.env.PAYOUT_THRESHOLD || 1);

module.exports = {
  COINS,
  COIN_IDS,
  PORT,
  DEFAULT_WALLET,
  DEFAULT_COIN,
  REFRESH_INTERVAL_SEC,
  REFRESH_INTERVAL_MS,
  PAYOUT_THRESHOLD,
  detectCoinFromWallet,
  normalizeCoin,
  isValidCoin,
  resolveCoin
};
