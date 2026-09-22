# WoolyPooly Monitor

A small local web dashboard that watches your WoolyPooly mining stats. It polls the pool and CoinGecko APIs and shows hashrate, earnings, and balances for your wallet.

## Configuration

1. Duplicate `example.env` and rename the copy to `.env`
2. Open `.env` and fill in the values:

   | Key | Description |
   | --- | --- |
   | `SERVER_PORT` | Port the web UI runs on (e.g. `4070`) |
   | `DEFAULT_WALLET` | Your WoolyPooly wallet address |
   | `REFRESH_INTERVAL_SEC` | (Optional) Pool refresh cadence in seconds. Default `20`. One shared refresh serves all viewers. |

3. Run the app (`node index.js`) and open `http://localhost:<SERVER_PORT>/`

The dashboard auto-updates over a live stream. If the pool API is unreachable,
it keeps showing the last-known data with a `STALE` badge instead of zeros.
