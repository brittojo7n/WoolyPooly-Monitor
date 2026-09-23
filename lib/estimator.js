const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_COVERAGE_HOURS = 6;

function emptyEstimate() {
  return {
    perHour: 0,
    per12h: 0,
    perDay: 0,
    perWeek: 0,
    perMonth: 0,
    windowBuckets: 0,
    windowIncome: 0,
    windowHours: 0,
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
    windowBuckets: recent.length,
    windowIncome: income,
    windowHours: span,
    available: true
  };
}

module.exports = {
  estimateRollingDay
};
