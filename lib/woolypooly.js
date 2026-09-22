const priceCache = {};

const COIN_GECKO_MAP = {
  'vtc': 'vertcoin',
  'kas': 'kaspa',
  'cfx': 'conflux-token',
  'etc': 'ethereum-classic',
  'firo': 'firo',
  'octa': 'octa-space',
  'rvn': 'ravencoin',
  'erg': 'ergo',
  'zec': 'zcash',
  'clore': 'clore-ai',
  'zeph': 'zephyr-protocol',
  'neox': 'neoxa'
};

async function fetchJson(endpointUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(endpointUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WoolyPooly-MultiCoin-Monitor/1.0' }
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function getCoinUsdPrice(coinCode) {
  const cleanCode = String(coinCode || '').split('-')[0].toLowerCase();
  if (!cleanCode) return 0;
  const geckoId = COIN_GECKO_MAP[cleanCode] || cleanCode;
  const now = Date.now();

  if (priceCache[geckoId] && (now - priceCache[geckoId].timestamp < 120000)) {
    return priceCache[geckoId].price;
  }

  try {
    const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`);
    if (data && data[geckoId] && data[geckoId].usd) {
      priceCache[geckoId] = { price: data[geckoId].usd, timestamp: now };
      return data[geckoId].usd;
    }
  } catch (err) {}

  return priceCache[geckoId] ? priceCache[geckoId].price : 0;
}

async function fetchPoolStats(poolId) {
  return await fetchJson(`https://api.woolypooly.com/api/${poolId}/stats`);
}

async function fetchAccountStats(poolId, wallet) {
  return await fetchJson(`https://api.woolypooly.com/api/${poolId}/accounts/${wallet}`);
}

async function detectPoolForWallet(wallet) {
  const cleanWallet = String(wallet || '').trim();
  if (!cleanWallet) return 'vtc-1';

  try {
    const list = await fetchJson(`https://api.woolypooly.com/api/accounts/${cleanWallet}`);
    if (Array.isArray(list) && list.length > 0 && list[0].poolId) {
      return list[0].poolId;
    }
  } catch (err) {}

  const lower = cleanWallet.toLowerCase();
  if (lower.startsWith('vtc1') || lower.startsWith('v')) return 'vtc-1';
  if (lower.startsWith('kaspa:') || lower.startsWith('kas:')) return 'kas-1';
  if (lower.startsWith('cfx:')) return 'cfx-1';
  if (lower.startsWith('0x')) return 'etc-1';
  if (/^[rR][1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanWallet)) return 'rvn-1';
  if (/^9[1-9A-HJ-NP-Za-km-z]{50}$/.test(cleanWallet)) return 'erg-1';
  if (/^a[1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanWallet)) return 'firo-1';
  if (/^t1[1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanWallet)) return 'zec-1';

  return 'vtc-1';
}

module.exports = {
  getCoinUsdPrice,
  fetchPoolStats,
  fetchAccountStats,
  detectPoolForWallet
};
