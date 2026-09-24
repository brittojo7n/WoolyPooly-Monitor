const HOUR_MS = 3600 * 1000;
const COMPLETED_HOURS = 24;
const MIN_REPORTED_HOURS = 3;
const MAX_RECENT_GAP_HOURS = 1;

function buildHourlyGraph(graph, now = Date.now()) {
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const firstHour = currentHour - COMPLETED_HOURS * HOUR_MS;
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
  for (let i = 0; i <= COMPLETED_HOURS; i++) {
    const hour = firstHour + i * HOUR_MS;
    const bucket = byHour.get(hour);
    const current = i === COMPLETED_HOURS;
    hours.push({
      created: new Date(hour).toISOString(),
      amount: bucket ? bucket.amount : null,
      participation: bucket ? bucket.participation : null,
      status: bucket ? (current ? 'partial' : 'reported') : (current ? 'pending' : 'unreported')
    });
  }
  return hours;
}

function estimateRollingDay(graph, now = Date.now(), options = {}) {
  const hourlyGraph = buildHourlyGraph(graph, now);
  const completed = hourlyGraph.slice(0, COMPLETED_HOURS);
  const reportedHours = completed.filter(b => b.status === 'reported').length;
  const observed24h = completed.reduce((total, b) => total + (b.amount == null ? 0 : b.amount), 0);
  let lastCompletedIndex = -1;
  for (let i = COMPLETED_HOURS - 1; i >= 0; i--) {
    if (completed[i].status === 'reported') { lastCompletedIndex = i; break; }
  }
  const base = {
    perHour: 0, per12h: 0, perDay: 0, perWeek: 0, perMonth: 0,
    available: false,
    status: 'unknown', confidence: null,
    observed24h, reportedHours, missingHours: COMPLETED_HOURS - reportedHours,
    sampleHours: 0, spanHours: 0,
    lastReportedAt: lastCompletedIndex < 0 ? null : completed[lastCompletedIndex].created,
    hourlyGraph
  };

  if (options.onlineWorkers === 0) return { ...base, status: 'paused' };
  if (!(options.onlineWorkers > 0)) return base;

  const currentIndex = COMPLETED_HOURS;
  const hasCurrentBucket = hourlyGraph[currentIndex].status === 'partial';
  const anchorIndex = hasCurrentBucket ? currentIndex : lastCompletedIndex;
  if (anchorIndex < 0 || (!hasCurrentBucket &&
      COMPLETED_HOURS - 1 - lastCompletedIndex > MAX_RECENT_GAP_HOURS)) {
    return { ...base, status: 'waiting' };
  }

  let firstIndex = anchorIndex;
  let consecutiveMissing = 0;
  for (let i = anchorIndex - 1; i >= 0; i--) {
    if (hourlyGraph[i].amount != null) {
      firstIndex = i;
      consecutiveMissing = 0;
    } else if (++consecutiveMissing >= 2) {
      break;
    }
  }
  firstIndex = Math.max(firstIndex, anchorIndex - COMPLETED_HOURS + 1);
  const sample = hourlyGraph.slice(firstIndex, anchorIndex + 1);
  const sampleHours = sample.filter(b => b.amount != null).length;
  const spanHours = sample.length;
  if (!hasCurrentBucket && sampleHours < MIN_REPORTED_HOURS) {
    return { ...base, status: 'warming', sampleHours, spanHours };
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
