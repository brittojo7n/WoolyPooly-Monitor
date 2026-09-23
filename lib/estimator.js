const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_COVERAGE_HOURS = 6;
const ALIGN_TOLERANCE_MS = 90 * 60 * 1000;

function emptyEstimate() {
  return {
    perHour: 0,
    per12h: 0,
    perDay: 0,
    perWeek: 0,
    perMonth: 0,
    available: false
  };
}

function completedHour(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const a = (typeof raw.amount === 'number') ? raw.amount : parseFloat(raw.amount);
  if (!isFinite(a) || a < 0) return null;
  const t = new Date(raw.created).getTime();
  if (!isFinite(t) || t <= 0 || t > now) return null;
  if (t + HOUR_MS > now) return null;
  return { t, a };
}

function estimateRollingDay(graph, now) {
  const seen = new Set();
  const hours = [];
  const list = Array.isArray(graph) ? graph : [];
  for (const raw of list) {
    const b = completedHour(raw, now);
    if (b && b.t >= now - DAY_MS && !seen.has(b.t)) {
      seen.add(b.t);
      hours.push(b);
    }
  }
  hours.sort((x, y) => x.t - y.t);
  const recent = hours.slice(-24);
  if (recent.length < MIN_COVERAGE_HOURS) return emptyEstimate();
  let income = 0;
  for (const b of recent) income += b.a;
  const span = Math.min(24, Math.round((recent[recent.length - 1].t - recent[0].t) / HOUR_MS) + 1);
  const perHour = income / span;
  return {
    perHour,
    per12h: perHour * 12,
    perDay: perHour * 24,
    perWeek: perHour * 168,
    perMonth: perHour * 720,
    available: true
  };
}

function firstKey(raw, keys) {
  for (const k of keys) {
    if (raw[k] != null) return raw[k];
  }
  return null;
}

function extractSeries(node, now) {
  if (!Array.isArray(node)) return [];
  const out = [];
  const cutoff = now - DAY_MS;
  for (const raw of node) {
    if (raw == null) continue;
    const tr = Array.isArray(raw) ? raw[0] : (typeof raw === 'object' ? firstKey(raw, ['created', 'timestamp', 'time', 't', 'date']) : null);
    const vr = Array.isArray(raw) ? raw[1] : (typeof raw === 'object' ? firstKey(raw, ['hr', 'hashrate', 'h', 'value']) : null);
    const tx = (typeof tr === 'number' && tr < 1e11) ? tr * 1000 : tr;
    const t = new Date(tx).getTime();
    const h = (typeof vr === 'number') ? vr : parseFloat(vr);
    if (!isFinite(t) || t < cutoff || t > now || !isFinite(h) || h < 0) continue;
    out.push({ t, h });
  }
  out.sort((x, y) => x.t - y.t);
  return out;
}

function nearestRate(points, t) {
  let best = null;
  let gap = ALIGN_TOLERANCE_MS + 1;
  for (const p of points) {
    const d = Math.abs(p.t - t);
    if (d < gap) {
      gap = d;
      best = p.h;
    }
  }
  return gap <= ALIGN_TOLERANCE_MS ? best : null;
}

function attachHashrate(buckets, pplns, solo) {
  const out = [];
  const list = Array.isArray(buckets) ? buckets : [];
  const ps = Array.isArray(pplns) ? pplns : [];
  const ss = Array.isArray(solo) ? solo : [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const t = new Date(b.created).getTime();
    const ok = isFinite(t);
    out.push({
      created: b.created,
      amount: b.amount,
      participation: b.participation,
      pplns: ok ? nearestRate(ps, t) : null,
      solo: ok ? nearestRate(ss, t) : null
    });
  }
  out.sort((x, y) => new Date(x.created || 0) - new Date(y.created || 0));
  return out;
}

module.exports = {
  estimateRollingDay,
  extractSeries,
  attachHashrate
};
