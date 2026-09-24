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

const COIN_GECKO_MAP = {
  'vtc': 'vertcoin',
  'kas': 'kaspa',
  'cfx': 'conflux-token',
  'etc': 'ethereum-classic',
  'firo': 'zcoin',
  'octa': 'octaspace',
  'erg': 'ergo',
  'raven': 'ravencoin'
};

const WOOLYPOOLY_API_BASE = 'https://api.woolypooly.com/api';
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const REFRESH_INTERVAL_MS = 20000;
const REQUEST_TIMEOUT_MS = 6000;

module.exports = {
  COINS,
  COIN_IDS,
  COIN_ALIASES,
  COIN_GECKO_MAP,
  WOOLYPOOLY_API_BASE,
  COINGECKO_API_BASE,
  REFRESH_INTERVAL_MS,
  REQUEST_TIMEOUT_MS
};
