const http = require('http');
const config = require('./lib/config');
const router = require('./lib/router');

function startServer() {
  const server = http.createServer((req, res) => {
    router.handleRequest(req, res);
  });

  server.listen(config.PORT, () => {
    console.log(`WoolyPooly Monitor running at http://localhost:${config.PORT}/`);
  });
}

startServer();
