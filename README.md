# WoolyPooly Monitor

A lightweight, real-time web dashboard for monitoring your WoolyPooly mining statistics — hashrate, earnings, balances, and worker telemetry — served locally over SSE. No framework, no database: a single Node process with a fast static frontend.

The dashboard makes a **strict separation** between three kinds of numbers (never mixed):

| Kind | Source | Meaning |
| --- | --- | --- |
| **WoolyPooly API** | raw API response, passed through unchanged | "What does the pool currently say?" e.g. `income_Hour / HalfDay / Day / Week / Month`, balances, hashrates, effort |
| **Observed** | account-derived accounting | built from the pool's per-hour credited buckets (`minerProfitGraph`) for 1h–24h, and from local telemetry history (`E(t) = paid + balance + immature`) for 7d/30d. Payout-resistant. |
| **Projected** | WoolyPooly API 24h income × time | clearly labelled "Projected", never shown as Actual/Observed |

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
- `lib/metrics.js` — data model: API / Observed / Projected separation
- `lib/history.js` — local telemetry store (`data/telemetry.json`, 15-min snapshots, 31-day retention)
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

## History & observed earnings

For 7d/30d "Observed" values the app keeps snapshots of `paid`, `balance` and `immature_balance` in `data/telemetry.json` (gitignored), persisted across restarts. Observed earnings over a window are:

```
E(t)      = paid(t) + balance(t) + immature_balance(t)
Observed  = E(now) − E(now − period)
```

A window is only shown once a snapshot at or before `now − period` exists; until then the dashboard shows **"N/A — insufficient history"** and never extrapolates.

## Payout ETA

The "Next Payout" estimate uses the **WoolyPooly API 24h income rate** (API 24h ÷ 24). The payout threshold is the greater of the pool's minimum payout (`minPay` from the pool stats endpoint) and the `PAYOUT_THRESHOLD` env var (your configured payout threshold on the pool); when the endpoint is unreachable, `PAYOUT_THRESHOLD` is used alone. The UI displays the effective threshold.

## Mining context

Default target for this deployment (Vertcoin, WoolyPooly PPLNS): a GTX 1660 Ti laptop GPU at roughly 472 kH/s live / 444 kH/s 24h average. Wallet configured via `DEFAULT_WALLET`.

## License

MIT License — see [LICENSE](LICENSE) for details.
