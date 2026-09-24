# WoolyPooly Monitor

A lightweight, real-time web dashboard for monitoring your WoolyPooly mining statistics — hashrate, earnings, balances, and worker telemetry — served locally in your browser.

## Prerequisites

- Node.js 18+

## Setup

1. **Clone the repository**
2. **Configure your environment**

   ```bat
   copy .env.example .env
   ```

   Open `.env` in a text editor and fill in your values:

   | Variable           | Description                                    |
   | ------------------ | ---------------------------------------------- |
   | `SERVER_PORT`      | Port to serve the dashboard on (default `4070`)|
   | `WALLET`           | Your WoolyPooly wallet address                 |
   | `PAYOUT_THRESHOLD` | Minimum payout threshold for progress tracking |

3. **Sync and start**

   ```bat
   node bootstrap.js
   ```

   `bootstrap.js` syncs with the upstream `main` branch (discarding any local changes) and starts the server.

   > For development without auto-sync, run `node main.js` directly.

## Start

Open `http://localhost:4070/` in your browser (or `http://localhost:<your-port>/` if you changed `SERVER_PORT`). The dashboard updates live and shows a `STALE` badge if the pool API is unreachable.

## Project structure

```plain
main.js                   server entry point (HTTP server startup)
bootstrap.js              syncs with upstream main, then launches main.js
server/                   Node.js application runtime
  utils/                  config (env loading + validation), constants
  api/                    pool clients, CoinGecko, estimator, metrics processing
  http/                   HTTP routing, rate limiting, SSE, static serving, HTML rendering
web/                      browser-facing application
  index.html              page template
  css/styles.css          stylesheet
  assets/logo.svg         favicon
  js/
    app.js                entry point (ES module)
    lib/                  shared utilities (state, dom, format, clipboard)
    components/           UI components (chart, pagination, workers, payments)
    services/             infrastructure (connection, ui, info-tip)
```

## License

MIT License — see [LICENSE](LICENSE) for details.
