const HOUR_MS = 3600 * 1000;
const WINDOW_HOURS = 24;
const NEXT_BUCKET_GRACE_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = HOUR_MS + NEXT_BUCKET_GRACE_MS;

function buildHourlyGraph(graph, now = Date.now()) {
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const firstHour = currentHour - WINDOW_HOURS * HOUR_MS;
  const byHour = new Map();

  for (const raw of Array.isArray(graph) ? graph : []) {
    if (!raw || typeof raw !== 'object') continue;
    const time = new Date(raw.created).getTime();
    const amount = typeof raw.amount === 'number' ? raw.amount :
      (typeof raw.amount === 'string' && raw.amount.trim() ? Number(raw.amount) : NaN);
    if (!Number.isFinite(time) || time > now || !Number.isFinite(amount) || amount < 0) continue;
    const hour = Math.floor(time / HOUR_MS) * HOUR_MS;
    if (hour < firstHour || hour > currentHour) continue;
    const participation = Number(raw.participation);
    byHour.set(hour, {
      amount,
      participation: raw.participation != null && Number.isFinite(participation) && participation >= 0
        ? participation : null
    });
  }

  const hours = [];
  for (let i = 0; i <= WINDOW_HOURS; i++) {
    const hour = firstHour + i * HOUR_MS;
    const bucket = byHour.get(hour);
    const current = i === WINDOW_HOURS;
    hours.push({
      created: new Date(hour).toISOString(),
      amount: bucket ? bucket.amount : null,
      participation: bucket ? bucket.participation : null,
      status: bucket ? (current ? 'partial' : 'reported')
        : (now - hour < NEXT_BUCKET_GRACE_MS ? 'pending' : 'unreported')
    });
  }
  return hours;
}

function estimateRollingDay(graph, now = Date.now(), options = {}) {
  const hourlyGraph = buildHourlyGraph(graph, now);
  const completed = hourlyGraph.slice(0, WINDOW_HOURS);
  const reportedHours = completed.filter(b => b.status === 'reported').length;
  const observed24h = completed.reduce((total, b) => total + (b.amount == null ? 0 : b.amount), 0);

  let lastReportedIndex = -1;
  for (let i = hourlyGraph.length - 1; i >= 0; i--) {
    if (hourlyGraph[i].amount != null) { lastReportedIndex = i; break; }
  }
  const lastReportedAt = lastReportedIndex < 0 ? null : hourlyGraph[lastReportedIndex].created;

  const base = {
    perHour: 0, per12h: 0, perDay: 0, perWeek: 0, perMonth: 0,
    available: false,
    status: 'unknown', confidence: null,
    observed24h, reportedHours, missingHours: WINDOW_HOURS - reportedHours,
    sampleHours: 0, spanHours: 0,
    lastReportedAt,
    hourlyGraph
  };

  if (options.onlineWorkers === 0) return { ...base, available: true, status: 'paused' };
  if (!(options.onlineWorkers > 0)) return base;

  if (lastReportedIndex < 0) return { ...base, available: true, status: 'waiting' };

  const lastReportedHourStart = Date.parse(lastReportedAt);
  if (now - lastReportedHourStart >= STALE_AFTER_MS) {
    return { ...base, available: true, status: 'stopped', confidence: null };
  }

  const currentIndex = WINDOW_HOURS;
  const hasCurrentBucket = hourlyGraph[currentIndex].status === 'partial';
  const anchorIndex = hasCurrentBucket ? currentIndex : lastReportedIndex;
  const anchorHourStart = Date.parse(hourlyGraph[anchorIndex].created);

  let firstIndex = anchorIndex;
  for (let i = anchorIndex - 1; i >= 0; i--) {
    if (hourlyGraph[i].amount == null) break;
    firstIndex = i;
  }
  firstIndex = Math.max(firstIndex, anchorIndex - WINDOW_HOURS + 1);

  const sample = hourlyGraph.slice(firstIndex, anchorIndex + 1);
  const sampleHours = sample.filter(b => b.amount != null).length;
  const partialWeight = hasCurrentBucket ? (now - anchorHourStart) / HOUR_MS : 0;
  const spanHours = (sample.length - (hasCurrentBucket ? 1 : 0)) + partialWeight;

  if (!(spanHours > 0)) {
    return { ...base, available: true, status: 'waiting', sampleHours, spanHours };
  }

  const income = sample.reduce((total, b) => total + (b.amount == null ? 0 : b.amount), 0);
  const perHour = income / spanHours;
  return {
    ...base,
    perHour, per12h: perHour * 12, perDay: perHour * 24,
    perWeek: perHour * 168, perMonth: perHour * 720,
    available: true, status: 'running',
    confidence: sampleHours < 6 ? 'early' : 'established',
    sampleHours, spanHours
  };
}

module.exports = { buildHourlyGraph, estimateRollingDay };
