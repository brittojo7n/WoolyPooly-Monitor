# WoolyPooly Monitor

A lightweight, real-time web dashboard for monitoring your WoolyPooly mining statistics — hashrate, earnings, balances, and worker telemetry — served locally over SSE. No framework, no database: a single Node process with a fast static frontend.

The dashboard makes a **strict separation** between two kinds of numbers (never mixed):

| Kind | Source | Meaning |
| --- | --- | --- |
| **WoolyPooly API** | raw API response, passed through unchanged | "What does the pool currently say?" e.g. `income_Hour / HalfDay / Day / Week / Month`, balances, hashrates, effort |
| **Estimated** | productive-session engine over archived hourly buckets | mean of the latest 24 productive buckets of the active session (`minerProfitGraph`, archived in `data/buckets.json`); 12h/24h/7d/30d are the hourly rate × time. One zero hour does not reset; two in a row ends the session. |

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

   Opens `http://localhost:<SERVER_PORT>/` — live updates via Server-Sent Events. On API failure the dashboard retains the last-known-good values and shows a `STALE` badge plus "Last update: <time>" — it never overwrites real data with zeros.

## How It Works

- `bootstrap.js` — fetches, hard-resets to `origin/<branch>`, cleans untracked files, then launches `index.js`. **All local changes are discarded on every run.**
- `index.js` — HTTP server + SSE stream, aggregates pool + CoinGecko data
- `lib/config.js` — env loading, coin/pool IDs, wallet detection, `isValidCoin`, fallback `PAYOUT_THRESHOLD`
- `lib/woolypooly.js` — WoolyPooly & CoinGecko API client (fetch helpers + price cache)
- `lib/metrics.js` — data model: API / Estimated separation
- `lib/estimator.js` — productive-session engine: break detection (two consecutive zero buckets), rolling 24-productive-bucket mean, derived periods
- `lib/history.js` — local stores: telemetry snapshots (`data/telemetry.json`, 15-min, 31-day retention) + archived hourly buckets (`data/buckets.json`, permanent)
- `lib/router.js` — routing, feed cache, SSE broadcast, debug endpoints
- `lib/ui.js` — HTML page rendering
- `public/` — static assets (HTML, CSS, client JS)

> **Development:** run `node index.js` directly. This bypasses bootstrap so your uncommitted changes are preserved.

## API endpoints

- `GET /api/stats` — full rendered snapshot (JSON). Optional `?coin=` (pool id like `vtc-1`); unsupported coins are rejected with HTTP 400.
- `GET /api/stream` — Server-Sent Events stream of the same snapshot.
- `GET /api/health` — liveness probe.
- `GET /api/debug/woolypooly` — raw upstream account payload (wallet redacted) + pool/price status, for inspecting whether WoolyPooly changed its schema.
- `GET /api/debug/history` — local telemetry summary (history age, observed windows), wallet redacted.

## Estimated earnings engine

Completed hourly buckets from `minerProfitGraph` are archived per coin+wallet in `data/buckets.json` (gitignored), keyed by `created` timestamp so re-polling never double-counts. Missing/malformed data is a gap, never a zero; the in-progress current-hour bucket is excluded until it completes.

Session rule: a single zero bucket does not reset; **two consecutive valid zero buckets** end the session (rate → 0). The first positive bucket afterwards starts a new session. The live rate is the mean of the latest 24 productive buckets of the active session (fewer during warm-up; zeros excluded from the denominator):

```
estimatedPerHour  = rollingIncomeSum / rollingProductiveHours
estimatedPer12h   = estimatedPerHour × 12
estimatedPerDay   = estimatedPerHour × 24
estimatedPerWeek  = estimatedPerHour × 168
estimatedPerMonth = estimatedPerHour × 720
```

With no productive buckets the dashboard shows **"N/A — insuff. data"** / **"Insufficient data"** and never extrapolates. On API failure the last estimator is retained and the `STALE` badge shows.

## Payout ETA

The payout ETA in the Balance card uses the **Estimated hourly rate** from the productive-session engine. The payout threshold is the greater of the pool's minimum payout (`minPay` from the pool stats endpoint) and the `PAYOUT_THRESHOLD` env var (your configured payout threshold on the pool); when the endpoint is unreachable, `PAYOUT_THRESHOLD` is used alone. The UI displays the effective threshold.

## Mining context

Default target for this deployment (Vertcoin, WoolyPooly PPLNS): a GTX 1660 Ti laptop GPU at roughly 472 kH/s live / 444 kH/s 24h average. Wallet configured via `DEFAULT_WALLET`.

## License

MIT License — see [LICENSE](LICENSE) for details.
