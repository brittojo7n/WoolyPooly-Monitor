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
  console.error('PORT is missing or invalid:', process.env.SERVER_PORT);
  process.exit(1);
}

const DEFAULT_WALLET = String(process.env.WALLET || '').trim();
if (!DEFAULT_WALLET) {
  console.error('WALLET is required in .env');
  process.exit(1);
}

const DEFAULT_COIN = resolveCoin(DEFAULT_WALLET) || '';
const REFRESH_INTERVAL_MS = 5000;

function parsePayoutThreshold(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 1;
  const n = Number(s);
  return (Number.isFinite(n) && n > 0) ? n : 1;
}

const PAYOUT_THRESHOLD = parsePayoutThreshold(process.env.PAYOUT_THRESHOLD);

module.exports = {
  COINS,
  COIN_IDS,
  PORT,
  DEFAULT_WALLET,
  DEFAULT_COIN,
  REFRESH_INTERVAL_MS,
  PAYOUT_THRESHOLD,
  detectCoinFromWallet,
  normalizeCoin,
  isValidCoin,
  resolveCoin
};
