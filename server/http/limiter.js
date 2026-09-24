const clients = new Map();
const CLEANUP_INTERVAL_MS = 60000;
const BURST_THRESHOLD = 2;
const WINDOW_MS = 3000;
const INITIAL_COOLDOWN_MS = 3000;
const ESCALATED_COOLDOWN_MS = 5000;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = String(forwarded).split(',')[0].trim();
    if (ip) return ip;
  }
  return req.socket ? (req.socket.remoteAddress || '127.0.0.1') : '127.0.0.1';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let record = clients.get(ip);

  if (!record) {
    record = {
      timestamps: [now],
      blockedUntil: 0,
      currentCooldown: 0
    };
    clients.set(ip, record);
    return { allowed: true, waitMs: 0 };
  }

  if (now < record.blockedUntil) {
    record.currentCooldown = ESCALATED_COOLDOWN_MS;
    record.blockedUntil = now + ESCALATED_COOLDOWN_MS;
    const waitMs = record.blockedUntil - now;
    return {
      allowed: false,
      waitMs,
      retryAfterSec: Math.ceil(waitMs / 1000)
    };
  }

  record.timestamps = record.timestamps.filter(t => now - t <= WINDOW_MS);
  record.timestamps.push(now);

  if (record.timestamps.length > BURST_THRESHOLD) {
    const cooldown = INITIAL_COOLDOWN_MS;
    record.currentCooldown = cooldown;
    record.blockedUntil = now + cooldown;
    const waitMs = cooldown;
    return {
      allowed: false,
      waitMs,
      retryAfterSec: Math.ceil(waitMs / 1000)
    };
  }

  return { allowed: true, waitMs: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of clients.entries()) {
    if (now > record.blockedUntil && (!record.timestamps.length || now - record.timestamps[record.timestamps.length - 1] > WINDOW_MS * 2)) {
      clients.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS);

module.exports = {
  getClientIp,
  checkRateLimit
};
