# WoolyPooly Monitor

A lightweight, real-time web dashboard for monitoring your WoolyPooly mining statistics — hashrate, earnings, balances, and worker telemetry — served locally over SSE.

## Requirements

- **Node.js 18+**

## Installation & Usage

1. **Clone the repository**
2. **Configure environment**

   ```sh
   cp .env.example .env   # edit with your wallet address and port
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

### Hourly graph and earnings estimates

WoolyPooly may omit hourly profit entries when there are no credits (including while your workers are offline). The graph shows **24 completed UTC hour slots plus the current, provisional hour**; it labels times in your browser's local time zone. A dashed interval means **no bucket was reported**, not a measured zero. A bucket received later is placed at its actual hour, rather than being joined directly to an older point across the idle gap. The current bucket is excluded from completed-hour totals, but when workers are online it enters the estimate as soon as the API reports it. WoolyPooly can revise that same bucket's cumulative amount during the hour; each fresh snapshot replaces the prior value and recalculates the estimate. At rollover, that bucket becomes the completed period and the next period is tracked separately.

`estimated.observed24h` sums credited buckets from the last 24 completed hours, including any hours without a reported bucket in the time window. It is historical and can remain positive while mining is stopped. **Forward projections** (`estimated.perHour`, `perDay`, etc.) and payout ETA pause when the pool reports zero workers online. The rate is the average of reported hourly buckets in the newest post-gap run, capped at 24 periods; a single missing period between reports counts in the elapsed-span denominator. A current provisional bucket bypasses the three-completed-hour warm-up and is included as one period, so the estimate updates as its cumulative graph value grows. Without a current bucket, three recently completed reports are still needed to start a new estimate. Projections assume the new rate continues and are not guaranteed payouts. If the pool API fails, the last good snapshot stays visible as `STALE` rather than inventing new idle hours.

Run `node --test` for the hourly estimator, live-stream rollover, and mobile tooltip regression tests.

> **Development:** run `node index.js` directly. This bypasses bootstrap so your uncommitted changes are preserved.

## License

MIT License — see [LICENSE](LICENSE) for details.
