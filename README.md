# bitcoin-explorer

A Bitcoin explorer that runs entirely in your browser, built toward
**verifying** blockchain data rather than trusting it.

It is a static site (Vue, Vue Router, Chart.js, IndexedDB) that reads from
public Esplora APIs. There is no backend; it can be hosted on GitHub Pages
or any static host.

**[Live demo](https://bowo-prasetyo.github.io/bitcoin-explorer/)** ·
**[Vision and roadmap](VISION.md)**

> **Status:** today the explorer displays what its providers return. The
> in-browser verification described in [VISION.md](VISION.md) is the next
> major milestone; the Merkle-root code it builds on is in `spv.js` and
> tested, but not yet shown in the UI.

---

## What it does today

### Explorer

- **Home:** chain tip, recent blocks, mempool size and fees, fee estimates
  by confirmation target, fee histogram.
- **Block:** height, time, transaction count, confirmations, transaction
  list (first 25 transactions).
- **Transaction:** fee, weight, confirmation status, input and output
  addresses (OP_RETURN and non-standard outputs are labelled).
- **Address:** confirmed and pending funded/spent totals and transaction
  counts.
- **Charts:** mempool transaction count over time, sampled by your browser
  while the page is open.
- **Search:** block hash, txid or address.

### Data providers and failover

Requests go to two Esplora-compatible providers with known operators:

- [Blockstream](https://blockstream.info/)
- [mempool.space](https://mempool.space/)

If one fails or times out (8 s), the next is tried. Providers are ranked by
a simple health score, and the last working provider is preferred on the
next visit. A "not found" answer is treated as an answer, not as a
provider failure. Providers are re-checked every 5 minutes while the tab
is visible.

### Caching and refresh

- Every view shows its last cached data from IndexedDB immediately,
  labelled with its age, then refreshes it.
- While cached data is younger than its time-to-live (10 s to 30 s for live
  data, 1 h for confirmed transactions), no network request is made.
- If the providers can't be reached, cached data stays on screen with a
  warning instead of a blank page.
- Polling is every 10 s while you're active and 30 s when idle. It pauses
  in background tabs and refreshes as soon as you return. It stops once
  there's nothing left to watch (e.g. a transaction confirms).

### Privacy note

Your lookups (addresses, transactions) are sent to the providers above,
and to the second one if the first fails. Running entirely in the browser
means there's no server of ours, not that the providers can't see your
queries. Bringing your own endpoint is on the [roadmap](VISION.md).

---

## Running locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Dependencies load from CDNs at pinned versions with Subresource Integrity
(see `index.html`).

## Tests

```bash
node --test tests/*.test.mjs
```

Requires Node 20 or newer. CI runs the same command on every push and pull
request.

## Project layout

| File | Purpose |
|---|---|
| `index.html`, `app.js`, `router.js` | Entry point, app shell, routes |
| `api.js` | Provider list, failover and health scoring |
| `refresh.js` | Cache-first refresh with freshness status |
| `db.js` | IndexedDB wrapper |
| `spv.js` | Verification primitives (Merkle root); not yet used by the UI |
| `components/` | Views and the shared `DataStatus` indicator |
| `tests/` | Unit tests |

## License

MIT, see [LICENSE](LICENSE).

## Assisted by

[ChatGPT](https://chatgpt.com/) and [Claude Code](https://claude.com/claude-code).
