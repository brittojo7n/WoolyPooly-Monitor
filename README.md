# WoolyPooly Monitor

A lightweight, real-time web dashboard for monitoring your WoolyPooly mining statistics — hashrate, earnings, balances, and worker telemetry — served locally over SSE.

## Requirements

- **Node.js 18+**

## Installation & Usage

1. **Clone the repository**
2. **Configure environment**

   ```sh
   cp example.env .env   # edit with your wallet address and port
   ```

3. **Run**

   ```sh
   node bootstrap.js
   ```

   Opens `http://localhost:<SERVER_PORT>/` — live updates via Server-Sent Events. Falls back to `STALE` badge if pool API is unreachable.

## How It Works

- `bootstrap.js` — fetches, hard-resets to `origin/<branch>`, cleans untracked files, then launches `index.js`. **All local changes are discarded on every run.**
- `index.js` — HTTP server + SSE stream, aggregates pool + CoinGecko data
- `lib/` — API client, metrics computation, routing, HTML rendering
- `public/` — static assets (HTML, CSS, client JS)

> **Development:** run `node index.js` directly. This bypasses bootstrap so your uncommitted changes are preserved.

## License

MIT License — see [LICENSE](LICENSE) for details.
