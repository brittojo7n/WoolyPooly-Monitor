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
   node index.js
   ```

   Opens `http://localhost:<SERVER_PORT>/` — live updates via Server-Sent Events. Falls back to `STALE` badge if pool API is unreachable.

## How It Works

- `bootstrap.js` — fetches, hard-resets to `origin/<branch>`, cleans untracked files, then launches `index.js`. **All local changes are discarded on every run.**
- `index.js` — HTTP server + SSE stream, aggregates pool + CoinGecko data
- `lib/` — API client, metrics computation, routing, HTML rendering
- `public/` — static assets (HTML, CSS, client JS)

### Hourly graph and earnings estimates

WoolyPooly may omit hourly profit entries when there are no credits (including while your workers are offline). The graph shows **24 completed UTC hour slots plus the current, provisional hour**; it labels times in your browser's local time zone. A dashed interval means **no bucket was reported**, not a measured zero. A bucket received later is placed at its actual hour, rather than being joined directly to an older point across the idle gap. The current bucket is excluded from completed-hour totals, but when workers are online it enters the estimate as soon as the API reports it. WoolyPooly can revise that same bucket's cumulative amount during the hour; each fresh snapshot replaces the prior value and recalculates the estimate. At rollover, that bucket becomes the completed period and the next period is tracked separately.

The estimate is recalculated entirely from each fresh `minerProfitGraph` snapshot. **No income-history file, database, browser storage, or cross-snapshot cumulative total is used.** The existing in-memory feed cache is only for serving API/SSE snapshots, not recording hourly income.

- Use the newest uninterrupted run of reported buckets, capped at 24 hourly periods inside the displayed graph window. A missing bucket separates a restarted run from older income. Old runs never seed its average.
- Start with the first usable bucket, including a growing current-hour bucket: no three-hour warm-up. Divide the run's income by its completed hours plus the current bucket's actual elapsed fraction. For example, `0.01` earned over 20 minutes gives `0.03/h`. At the exact hour boundary with zero elapsed time, show zero until time has elapsed rather than divide by zero.
- Each snapshot replaces the previous amounts; never add a bucket again merely because another poll returned it. Project the resulting hourly rate over 12h, 24h, 7d and 30d.
- Allow the next hour to begin, plus a 30-minute reporting grace period. If the latest reported bucket starts at **19:30**, and no newer bucket is present, reset all forward estimates to **0.0000 at 21:00** (the first successful refresh at or after that time). If a new bucket appears at **21:30** or later, calculate immediately from that new run. With hourly bucket timestamps alone, freshness is inferred from bucket presence; the API graph does not tell us the exact last-change time of an amount.
- Zero online workers pauses projections and displays zero. An empty valid graph also displays zero while waiting for credits; unknown worker data remains unavailable. A reported zero-valued bucket is valid API data, not a missing bucket.

`estimated.observed24h` remains the historical sum of the last 24 completed hours, excluding the provisional hour. It can remain positive while the forward estimate is zero. Payout ETA is unavailable when the forward rate is zero. Projections assume the rate continues; missing credits are not proof that the mining hardware is offline. If the API fails, show `STALE`/unavailable rather than mistake an API outage for stopped mining.

Verification uses temporary local harnesses only; no test files or income-history files are included in the repository.

> **Development:** run `node index.js` directly. This bypasses bootstrap so your uncommitted changes are preserved.

## License

MIT License — see [LICENSE](LICENSE) for details.
