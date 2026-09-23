const fs = require('fs');
const path = require('path');
const estimator = require('./estimator');

const DATA_DIR = process.env.WP_HISTORY_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'telemetry.json');
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const KEEP_MS = 31 * 24 * 3600 * 1000;

let store = { entries: {} };
let lastRecordTs = {};
let loaded = false;

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && raw.entries && typeof raw.entries === 'object') {
      for (const key of Object.keys(raw.entries)) {
        const arr = raw.entries[key];
        if (Array.isArray(arr)) {
          store.entries[key] = arr
            .filter(e => e && typeof e.ts === 'number')
            .sort((a, b) => a.ts - b.ts);
        }
      }
    }
  } catch (err) {}
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), entries: store.entries }));
    fs.renameSync(tmp, FILE);
  } catch (err) {}
}

function record(key, fields, now) {
  ensureLoaded();
  const ts = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
  if (ts - (lastRecordTs[key] || 0) < SNAPSHOT_INTERVAL_MS) return;
  lastRecordTs[key] = ts;

  const b = num(fields.balance);
  const i = num(fields.immature_balance);
  const p = num(fields.paid);
  const entry = {
    ts,
    b,
    i,
    p,
    e: p + b + i,
    api: {
      hour: num(fields.income_Hour),
      halfDay: num(fields.income_HalfDay),
      day: num(fields.income_Day),
      week: num(fields.income_Week),
      month: num(fields.income_Month)
    },
    hr: {
      now: num(fields.hashrateCurrent),
      h6: num(fields.hashrate6h),
      h24: num(fields.hashrate24h)
    },
    pool: {
      hashrate: num(fields.poolHashrate),
      miners: num(fields.poolMiners),
      effortPct: num(fields.poolEffortPct)
    },
    net: {
      hashrate: num(fields.netHashrate),
      difficulty: num(fields.difficulty)
    },
    workers: {
      online: num(fields.workersOnline),
      total: num(fields.workersTotal)
    }
  };

  const arr = store.entries[key] || (store.entries[key] = []);
  arr.push(entry);
  const cutoff = ts - KEEP_MS;
  while (arr.length && arr[0].ts < cutoff) arr.shift();
  save();
}

const BUCKET_FILE = path.join(DATA_DIR, 'buckets.json');

let bucketStore = { buckets: {} };
let bucketsLoaded = false;

function ensureBucketsLoaded() {
  if (bucketsLoaded) return;
  bucketsLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(BUCKET_FILE, 'utf8'));
    if (raw && raw.buckets && typeof raw.buckets === 'object') {
      for (const key of Object.keys(raw.buckets)) {
        if (Array.isArray(raw.buckets[key])) {
          bucketStore.buckets[key] = estimator.mergeBuckets([], raw.buckets[key]).buckets;
        }
      }
    }
  } catch (err) {}
}

function saveBuckets() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = BUCKET_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), buckets: bucketStore.buckets }));
    fs.renameSync(tmp, BUCKET_FILE);
  } catch (err) {}
}

function recordBuckets(key, candidates) {
  ensureBucketsLoaded();
  const res = estimator.mergeBuckets(bucketStore.buckets[key] || [], candidates);
  bucketStore.buckets[key] = res.buckets;
  if (res.added > 0) saveBuckets();
  return res.buckets;
}

function getBuckets(key) {
  ensureBucketsLoaded();
  return (bucketStore.buckets[key] || []).slice();
}

function listFor(key) {
  ensureLoaded();
  return store.entries[key] || [];
}

function windowObserved(key, periodMs, now) {
  const arr = listFor(key);
  if (!arr.length) return { value: 0, available: false };
  const target = now - periodMs;

  let baseline = null;
  for (let k = 0; k < arr.length; k++) {
    if (arr[k].ts <= target) baseline = arr[k];
    else break;
  }
  if (!baseline) return { value: 0, available: false };

  const latest = arr[arr.length - 1];
  if (latest.ts <= baseline.ts) return { value: 0, available: false };

  return { value: latest.e - baseline.e, available: true };
}

function ageMs(key, now) {
  const arr = listFor(key);
  return arr.length ? now - arr[0].ts : 0;
}

module.exports = {
  record,
  recordBuckets,
  getBuckets,
  windowObserved,
  ageMs,
  snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  keepMs: KEEP_MS
};
