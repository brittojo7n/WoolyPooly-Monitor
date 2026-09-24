const http = require('http');
const os = require('os');
const config = require('./server/utils/config');
const router = require('./server/http/router');

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function getWanIp() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    http.get('http://api.ipify.org?format=json', (res) => {
      clearTimeout(timeout);
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ip || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    router.handleRequest(req, res);
  });

  server.listen(config.PORT, async () => {
    const lanIp = getLanIp();
    const wanIp = await getWanIp();
    console.log(`Server running at http://localhost:${config.PORT}`);

    if (lanIp) {
      console.log(`LAN: http://${lanIp}:${config.PORT}`);
    } else {
      console.log(`LAN: Not Connected`);
    }

    if (wanIp) {
      console.log(`WAN: http://${wanIp}:${config.PORT}`);
    } else {
      console.log(`WAN: Not Connected`);
    }
  });
}

startServer();
