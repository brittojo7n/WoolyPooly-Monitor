const HOUR_MS = 3600 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const WINDOW_BUCKETS = 24;

function emptyEstimate() {
  return {
    perHour: 0,
    per12h: 0,
    perDay: 0,
    perWeek: 0,
    perMonth: 0,
    windowBuckets: 0,
    windowIncome: 0,
    sessionActive: false,
    sessionId: null,
    sessionStartT: null,
    available: false
  };
}

function normalizeBucket(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const a = (typeof raw.amount === 'number') ? raw.amount : parseFloat(raw.amount);
  if (!isFinite(a) || a < 0) return null;
  const t = new Date(raw.created).getTime();
  if (!isFinite(t) || t <= 0 || t > now) return null;
  if (t + HOUR_MS > now) return null;
  return { t, a };
}

function cleanList(input) {
  const out = [];
  const arr = Array.isArray(input) ? input : [];
  for (const b of arr) {
    if (b && isFinite(b.t) && isFinite(b.a) && b.a >= 0) out.push({ t: b.t, a: b.a });
  }
  return out;
}

function mergeBuckets(existing, candidates) {
  const seen = new Set();
  const out = [];
  for (const b of cleanList(existing)) {
    if (!seen.has(b.t)) {
      seen.add(b.t);
      out.push(b);
    }
  }
  let added = 0;
  for (const c of cleanList(candidates)) {
    if (!seen.has(c.t)) {
      seen.add(c.t);
      out.push(c);
      added++;
    }
  }
  out.sort((x, y) => x.t - y.t);
  return { buckets: out, added };
}

function estimateFromBuckets(buckets, now) {
  const list = cleanList(buckets).sort((x, y) => x.t - y.t);
  if (!list.length) return emptyEstimate();

  let seq = 0;
  let active = false;
  let sessionStartT = null;
  let zeros = 0;
  for (const b of list) {
    if (b.a > 0) {
      if (!active) {
        seq++;
        active = true;
        sessionStartT = b.t;
      }
      zeros = 0;
    } else {
      zeros++;
      if (zeros >= 2) active = false;
    }
  }

  let sum = 0;
  let n = 0;
  if (active) {
    const cutoff = now - WINDOW_MS;
    const win = [];
    for (const b of list) {
      if (b.t >= sessionStartT && b.t >= cutoff && b.t <= now) win.push(b);
    }
    const tail = win.slice(-WINDOW_BUCKETS);
    for (const b of tail) sum += b.a;
    n = tail.length;
  }

  const perHour = n > 0 ? sum / n : 0;
  return {
    perHour,
    per12h: perHour * 12,
    perDay: perHour * 24,
    perWeek: perHour * 168,
    perMonth: perHour * 720,
    windowBuckets: n,
    windowIncome: sum,
    sessionActive: active,
    sessionId: seq > 0 ? 's' + seq + '-' + sessionStartT : null,
    sessionStartT,
    available: n > 0
  };
}

module.exports = {
  HOUR_MS,
  WINDOW_MS,
  WINDOW_BUCKETS,
  normalizeBucket,
  mergeBuckets,
  estimateFromBuckets
};
