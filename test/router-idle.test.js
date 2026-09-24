const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('a fresh but unchanged pool response advances the timeline at the next UTC hour', () => {
  const script = `
    const http = require('node:http');
    const api = require('./lib/woolypooly');
    let now = Date.parse('2026-09-24T07:59:00Z');
    Date.now = () => now;
    let requests = 0;
    const account = {
      mode_stats: {}, workers: [], workersOnline: 0, workersTotal: 0,
      stats: { balance: 4.13, income: { income_Day: 0.4 },
        minerProfitGraph: [
          { created: '2026-09-23T07:00:00Z', amount: 0.1 },
          { created: '2026-09-24T04:00:00Z', amount: 0.4 }
        ] }
    };
    api.getCoinUsdPrice = async () => 0.04;
    api.fetchPoolStats = async () => ({ minPay: 1, modes: [] });
    api.fetchAccountStats = async () => { requests++; return account; };
    const router = require('./lib/router');
    const server = http.createServer(router.handleRequest);
    (async () => {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port + '/api/stats?coin=vtc';
      const first = await (await fetch(url)).json();
      now = Date.parse('2026-09-24T08:01:00Z');
      const second = await (await fetch(url)).json();
      api.fetchAccountStats = async () => { throw new Error('test outage'); };
      now = Date.parse('2026-09-24T09:01:00Z');
      const stale = await (await fetch(url)).json();
      process.stdout.write(JSON.stringify({
        requests, first: first.hourlyGraph[24], second: second.hourlyGraph[24],
        before: first.estimated.observed24h, after: second.estimated.observed24h,
        status: second.estimated.status, eta: second.payout.ratePerHour,
        stale: second.stale, frozenHour: stale.hourlyGraph[24].created,
        staleAfterOutage: stale.stale
      }));
      server.close(() => process.exit(0));
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SERVER_PORT: '4072', WALLET: 'sample-vtc-wallet', PAYOUT_THRESHOLD: '5' }
  });
  assert.equal(child.status, 0, child.stderr);
  const data = JSON.parse(child.stdout);
  assert.equal(data.requests, 2);
  assert.equal(data.first.created, '2026-09-24T07:00:00.000Z');
  assert.equal(data.second.created, '2026-09-24T08:00:00.000Z');
  assert.equal(data.first.status, 'pending');
  assert.equal(data.second.status, 'pending');
  assert.ok(Math.abs(data.before - 0.5) < 1e-12);
  assert.ok(Math.abs(data.after - 0.4) < 1e-12);
  assert.equal(data.status, 'paused');
  assert.equal(data.eta, null);
  assert.equal(data.stale, false);
  assert.equal(data.staleAfterOutage, true);
  assert.equal(data.frozenHour, data.second.created);
});

test('fresh pool snapshots recalculate the estimate when the current graph bucket grows', () => {
  const script = `
    const http = require('node:http');
    const api = require('./lib/woolypooly');
    let now = Date.parse('2026-09-24T14:45:00Z');
    let currentAmount = 0.008;
    Date.now = () => now;
    let requests = 0;
    api.getCoinUsdPrice = async () => 0.04;
    api.fetchPoolStats = async () => ({ minPay: 1, modes: [] });
    api.fetchAccountStats = async () => {
      requests++;
      return { workers: [{ offline: false }], workersOnline: 1, workersTotal: 1,
        mode_stats: {}, stats: { balance: 4, immature_balance: 0,
          income: { income_Hour: 0.036877746231 },
          minerProfitGraph: [
            { created: '2026-09-24T04:00:00Z', amount: 0.4 },
            { created: '2026-09-24T13:00:00Z', amount: 0.036877746231 },
            { created: '2026-09-24T14:00:00Z', amount: currentAmount }
          ] }
      };
    };
    const router = require('./lib/router');
    const server = http.createServer(router.handleRequest);
    (async () => {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port + '/api/stats?coin=vtc';
      const first = await (await fetch(url)).json();
      currentAmount = 0.0192;
      now += 21000;
      const second = await (await fetch(url)).json();
      process.stdout.write(JSON.stringify({ requests,
        first: { available: first.estimated.available, status: first.estimated.status,
          perHour: first.estimated.perHour, sampleHours: first.estimated.sampleHours,
          current: first.hourlyGraph[24] },
        second: { available: second.estimated.available, status: second.estimated.status,
          perHour: second.estimated.perHour, sampleHours: second.estimated.sampleHours,
          current: second.hourlyGraph[24] },
        apiHour: second.api.account.income.hour
      }));
      server.close(() => process.exit(0));
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SERVER_PORT: '4074', WALLET: 'sample-vtc-wallet' }
  });
  assert.equal(child.status, 0, child.stderr);
  const data = JSON.parse(child.stdout);
  assert.equal(data.requests, 2);
  assert.equal(data.first.available, true);
  assert.equal(data.first.status, 'running');
  assert.equal(data.first.sampleHours, 2);
  assert.ok(Math.abs(data.first.perHour - (0.036877746231 + 0.008) / 2) < 1e-12);
  assert.equal(data.first.current.amount, 0.008);
  assert.equal(data.second.available, true);
  assert.equal(data.second.status, 'running');
  assert.equal(data.second.sampleHours, 2);
  assert.ok(Math.abs(data.second.perHour - (0.036877746231 + 0.0192) / 2) < 1e-12);
  assert.ok(data.second.perHour > data.first.perHour);
  assert.equal(data.second.current.created, '2026-09-24T14:00:00.000Z');
  assert.equal(data.second.current.amount, 0.0192);
  assert.equal(data.apiHour, 0.036877746231);
});

test('an open SSE stream updates the estimate as the current API bucket grows', () => {
  const script = `
    const http = require('node:http');
    const api = require('./lib/woolypooly');
    let now = Date.parse('2026-09-24T14:45:00Z');
    let currentAmount = 0.008;
    Date.now = () => now;
    const intervals = [];
    const originalInterval = global.setInterval;
    global.setInterval = (fn, ms) => { intervals.push(fn); return intervals.length; };
    const router = require('./lib/router');
    global.setInterval = originalInterval;
    let requests = 0;
    api.detectPoolForWallet = async () => 'vtc-1';
    api.getCoinUsdPrice = async () => 0.04;
    api.fetchPoolStats = async () => ({ modes: [] });
    api.fetchAccountStats = async () => {
      requests++;
      return { workers: [{ offline: false }], workersOnline: 1, workersTotal: 1,
        mode_stats: {}, stats: { balance: 4,
          income: { income_Hour: 0.036877746231 },
          minerProfitGraph: [
            { created: '2026-09-24T04:00:00Z', amount: 0.4 },
            { created: '2026-09-24T13:00:00Z', amount: 0.036877746231 },
            { created: '2026-09-24T14:00:00Z', amount: currentAmount }
          ] }
      };
    };
    const server = http.createServer(router.handleRequest);
    server.listen(0, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port + '/api/stream?coin=vtc';
      http.get(url, res => {
        let buffer = '', events = [];
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          while (buffer.includes('\\n\\n')) {
            const end = buffer.indexOf('\\n\\n');
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!packet.startsWith('data: ')) continue;
            const event = JSON.parse(packet.slice(6));
            events.push({ available: event.estimated.available,
              status: event.estimated.status, perHour: event.estimated.perHour,
              current: event.hourlyGraph[24] });
            if (events.length === 1) {
              currentAmount = 0.0192;
              now += 21000;
              intervals[0]();
            } else {
              process.stdout.write(JSON.stringify({ requests, events,
                apiHour: event.api.account.income.hour }));
              res.destroy();
              server.close(() => process.exit(0));
            }
          }
        });
      }).on('error', error => { console.error(error); process.exit(1); });
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SERVER_PORT: '4075', WALLET: 'sample-vtc-wallet' }
  });
  assert.equal(child.status, 0, child.stderr);
  const data = JSON.parse(child.stdout);
  assert.equal(data.requests, 2);
  assert.equal(data.events.length, 2);
  assert.equal(data.events[0].available, true);
  assert.equal(data.events[0].status, 'running');
  assert.ok(Math.abs(data.events[0].perHour - (0.036877746231 + 0.008) / 2) < 1e-12);
  assert.equal(data.events[0].current.amount, 0.008);
  assert.equal(data.events[1].available, true);
  assert.equal(data.events[1].status, 'running');
  assert.ok(Math.abs(data.events[1].perHour - (0.036877746231 + 0.0192) / 2) < 1e-12);
  assert.ok(data.events[1].perHour > data.events[0].perHour);
  assert.equal(data.events[1].current.created, '2026-09-24T14:00:00.000Z');
  assert.equal(data.events[1].current.amount, 0.0192);
  assert.equal(data.apiHour, 0.036877746231);
});

test('an open SSE dashboard receives the new idle hour without a page reload', () => {
  const script = `
    const http = require('node:http');
    const api = require('./lib/woolypooly');
    let now = Date.parse('2026-09-24T07:59:00Z');
    Date.now = () => now;
    const intervals = [];
    const originalInterval = global.setInterval;
    global.setInterval = (fn, ms) => { intervals.push(fn); return intervals.length; };
    const router = require('./lib/router');
    global.setInterval = originalInterval;
    let requests = 0;
    api.detectPoolForWallet = async () => 'vtc-1';
    api.getCoinUsdPrice = async () => 0.04;
    api.fetchPoolStats = async () => ({ modes: [] });
    api.fetchAccountStats = async () => {
      requests++;
      return { workers: [], workersOnline: 0, mode_stats: {},
        stats: { balance: 4, minerProfitGraph: [
          { created: '2026-09-24T04:00:00Z', amount: 0.4 }
        ] } };
    };
    const server = http.createServer(router.handleRequest);
    server.listen(0, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port + '/api/stream?coin=vtc';
      http.get(url, res => {
        let buffer = '', events = [];
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          while (buffer.includes('\\n\\n')) {
            const end = buffer.indexOf('\\n\\n');
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!packet.startsWith('data: ')) continue;
            events.push(JSON.parse(packet.slice(6)));
            if (events.length === 1) {
              now = Date.parse('2026-09-24T08:01:00Z');
              intervals[0]();
            } else {
              process.stdout.write(JSON.stringify({ requests,
                hours: events.map(event => event.hourlyGraph[24].created),
                statuses: events.map(event => event.estimated.status)
              }));
              res.destroy();
              server.close(() => process.exit(0));
            }
          }
        });
      }).on('error', error => { console.error(error); process.exit(1); });
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SERVER_PORT: '4073', WALLET: 'sample-vtc-wallet' }
  });
  assert.equal(child.status, 0, child.stderr);
  const data = JSON.parse(child.stdout);
  assert.equal(data.requests, 2);
  assert.deepEqual(data.hours, [
    '2026-09-24T07:00:00.000Z', '2026-09-24T08:00:00.000Z'
  ]);
  assert.deepEqual(data.statuses, ['paused', 'paused']);
});
