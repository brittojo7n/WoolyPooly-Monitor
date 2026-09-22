/*
 * lib/history.js — local telemetry history for WoolyPooly Monitor.
 *
 * Purpose: keep append-only snapshots of the account's cumulative credited
 * value and key API fields so that long-window *observed* earnings
 * (7d / 30d) can be computed payout-resistant, and so history survives
 * process restarts.
 *
 * The cumulative credited value is defined as:
 *
 *   E(t) = paid(t) + balance(t) + immature_balance(t)
 *
 * This quantity does not change when the pool pays out (balance decreases by
 * the same amount `paid` increases), which is exactly what makes observed
 * earnings over a window immune to payout events:
 *
 *   observed(period) = E(now) - E(now - period)
 *
 * Storage: a single JSON file at <repo>/data/telemetry.json (gitignored).
 * One snapshot per wallet key is persisted at most every SNAPSHOT_INTERVAL_MS
 * (15 minutes), and entries older than KEEP_MS (31 days) are pruned. This is
 * deliberate: 15-minute granularity is more than enough for 7d/30d windows
 * while keeping the file small.
 *
 * IMPORTANT: a window is only reported as "available" when a snapshot at or
 * before (now - period) actually exists. Until then the app shows
 * "N/A — insufficient history". We never extrapolate or fabricate history.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// WP_HISTORY_DIR lets tests (and advanced deployments) relocate the telemetry
// store; default is <repo>/data (gitignored).
const DATA_DIR = process.env.WP_HISTORY_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'telemetry.json');
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const KEEP_MS = 31 * 24 * 3600 * 1000;       // 31 days

// key -> array of ascending { ts, b, i, p, e, api, hr, pool, net, workers }
let store = { entries: {} };
let lastRecordTs = {}; // key -> last persisted ts (throttle)
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
  } catch (err) {
    // No file yet (or unreadable) — start with an empty store.
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), entries: store.entries }));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    // Persistence is best-effort; in-memory history is still valid this run.
  }
}

/*
 * Record one snapshot. `now` is injectable for tests; defaults to Date.now().
 * Snapshot fields fed from the raw account/pool API responses (never zeros
 * fabricated on failure — callers only invoke this on a successful fetch).
 */
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
    e: p + b + i, // cumulative credited = paid + balance + immature
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

function listFor(key) {
  ensureLoaded();
  return store.entries[key] || [];
}

/*
 * Observed earned over `periodMs` ending at `now`, from cumulative credited.
 * Returns { value, available }. `available` is false until a snapshot exists
 * at or before (now - period), i.e. we have genuinely covered the window.
 */
function windowObserved(key, periodMs, now) {
  const arr = listFor(key);
  if (!arr.length) return { value: 0, available: false };
  const target = now - periodMs;

  let baseline = null;
  for (let k = 0; k < arr.length; k++) {
    if (arr[k].ts <= target) baseline = arr[k]; // latest snapshot <= target
    else break;
  }
  if (!baseline) return { value: 0, available: false };

  const latest = arr[arr.length - 1];
  // A window needs an observed ENDPOINT distinct from the baseline; with a
  // single snapshot there is nothing genuinely after the window start to
  // measure, so we never claim "0 earned" for an unobserved interval.
  if (latest.ts <= baseline.ts) return { value: 0, available: false };

  return { value: latest.e - baseline.e, available: true };
}

// Age of the oldest retained snapshot in ms (0 when empty).
function ageMs(key, now) {
  const arr = listFor(key);
  return arr.length ? now - arr[0].ts : 0;
}

module.exports = {
  record,
  windowObserved,
  ageMs,
  snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  keepMs: KEEP_MS
};
