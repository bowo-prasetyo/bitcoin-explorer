# bitcoin-explorer

A Bitcoin explorer that runs entirely in your browser, built toward
**verifying** blockchain data rather than trusting it.

It is a static site (Vue, Vue Router, Chart.js, IndexedDB) that reads from
public Esplora APIs. There is no backend; it can be hosted on GitHub Pages
or any static host.

**[Live demo](https://bowo-prasetyo.github.io/bitcoin-explorer/)** ·
**[Vision and roadmap](VISION.md)**

Blocks and transactions carry **verification badges**: your browser
fetches the raw data (block headers, raw transactions, Merkle proofs) and
checks the cryptography itself, then says exactly what it checked and what
it can't.

---

## What your browser verifies, and what it doesn't

| Where | Checked locally | Not proven |
|---|---|---|
| **Block** | The 80-byte header hashes to the block id. The hash meets the difficulty target in the header. That target is within mainnet limits. Time, Merkle root and previous block match what's shown. | That the block is on the chain with the most work. |
| **Block difficulty** | The difficulty is the one Bitcoin's rules require at that height. Inside a 2,016-block period it equals the period's first block. At the period start it is the retarget computed from the previous period's first and last headers (two-week target, 4× clamp, network limit), matching Bitcoin Core's arithmetic. All headers used pass the proof-of-work checks, and the period's first block builds on the previous period's last. | One retarget step here; the next row traces the rest. Blocks between the period start and this block aren't linked header by header. |
| **Difficulty history** (block pages, and the home page's opt-in card) | Every retarget from the genesis block, with its known hash and fixed difficulty, up to the block's period. Each period's last block has its period's difficulty. Each period builds on the previous period's last block. Each new difficulty is the retarget computed from that period's timestamps. All headers (about two per period) pass proof-of-work checks. Block pages run it automatically once the headers are cached, and otherwise offer it with its cost. | Blocks inside a period aren't linked one by one. That would take every header, about 925,000. |
| **Block transactions** | The full txid list rebuilds the header's Merkle root. The count matches. The transactions on the page are in that list, in order. | (A block's transactions can't be hidden or reordered without failing this.) |
| **Transaction contents** | The raw transaction hashes to its txid. Output amounts and scripts match what's shown. Spent outputs match the inputs shown. | (Input amounts are covered by the next row.) |
| **Input amounts and fee** | Each spent transaction is downloaded raw and hashes to its txid. The output each input spends holds the amount and address shown, marked ✓/✗ per input. Fee = inputs − verified outputs, and it matches the fee shown. Runs automatically for up to 25 spent transactions; above that, a button starts it. | That the spent outputs were still unspent. That needs the full set of unspent outputs, which only full nodes keep. |
| **Transaction inclusion** | A Merkle proof leads from the txid to a block header that passes the proof-of-work checks above. | Same limits as the block check. |
| **Chain tip** (home page, Providers page) | Every provider is asked independently. Each tip header's proof of work is checked. The tips are compared, telling "one block behind on the same chain" from "a different chain". | With a single provider, there is nothing to compare. |
| **Total work behind the tip** (home page, opt-in) | Adds up the chain's total proof of work exactly, from one proof-of-work-checked header per 2,016-block difficulty period. Together with the difficulty history it needs about 920 headers, roughly 72 KB, the first time; they're cached after. The tip's difficulty must match its period's first block. The result is shown in the same hex as Bitcoin Core's `chainwork`, so you can compare it with your own node. | It assumes every block in a period has its first header's difficulty, as mainnet's rules require; it doesn't link every header to the next. |
| **Address** | Nothing yet. | Balances and history need the full UTXO set; they come from the provider. |

A failing check is shown in red with the specific check that failed. A
check that couldn't run, for example because a provider was unreachable,
is shown in grey and never as a pass.

## What it does today

### Explorer

- **Search:** block height, block hash, transaction id or mainnet address.
  Press Enter to search. Input is checked before anything is sent, with an
  explanation when it can't be valid.
- **Home:** chain tip, recent blocks (linked, with age), mempool size and
  fees, fee estimates by confirmation target, fee histogram.
- **Block:** time, confirmations, size, weight, previous/next block links,
  and all transactions, 25 per page, with output totals and fee rates.
- **Transaction:** status and block, time, output total, fee and fee rate,
  size, and every input and output with its amount. Inputs link to the
  transaction that created the coins; OP_RETURN and non-standard outputs
  are labelled.
- **Address:** balance, pending change, totals received and sent, and the
  transaction history with each transaction's net effect on the address
  ("Load older transactions" pages back through history).
- **Charts:** mempool transaction count over time, sampled by your browser
  while the page is open.
- **Providers:** live health of each provider, whether they agree on the
  chain tip, and a form to use your own endpoint.

### Data providers and failover

By default, requests go to two Esplora-compatible providers with known
operators:

- [Blockstream](https://blockstream.info/)
- [mempool.space](https://mempool.space/)

On the **Providers** page you can add **your own Esplora endpoint**, such
as a self-hosted [electrs](https://github.com/Blockstream/electrs) or
mempool backend, or one reached over Tor. It is tried first, with the
public providers as fallback, or used **exclusively** so no lookup leaves
your infrastructure. The endpoint must send CORS headers. From the https
site it must be https, unless it's on localhost or a `.onion` address in
Tor Browser. The connection is tested before it can be saved.

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
- The cache is pruned at startup: entries older than 7 days go first, and
  it is capped at 500 entries.
- Polling is every 10 s while you're active and 30 s when idle. It pauses
  in background tabs and refreshes as soon as you return. It stops once
  there's nothing left to watch (e.g. a transaction confirms).

### Live updates

New blocks are announced over a WebSocket instead of being polled for:
- **One connection:** a single shared connection to mempool.space's
  WebSocket API, or to your own endpoint if it runs a mempool backend.
- **Blocks only:** it subscribes to new blocks and nothing else.
- **A hint, not data:** a message only prompts the page to fetch and
  verify the new block through the normal requests.
- **Less polling:** while connected, the tip, recent blocks and pending
  transactions are polled only every 5 minutes as a safety net, instead of
  every 10–30 seconds. The mempool and fee estimates keep their usual
  polling and also refresh when a block arrives.
- **Polite connection:**
  - It opens only while a visible page needs it, and closes 30 seconds
    after the tab goes to the background.
  - It pings every 30 seconds to detect dead connections.
  - It reconnects with exponential back-off and jitter.
  - It falls back to polling whenever it's unavailable. That includes
    Blockstream and electrs endpoints, which have no WebSocket.

The header shows **● Live** or **Polling**. The **Providers** page has an
on/off switch and counts provider requests and WebSocket traffic for the
session, so the savings can be measured. With your own endpoint set to
exclusive, the WebSocket goes only to your endpoint.

### Privacy note

Your lookups (addresses, transactions) are sent to the providers above,
and to the next one if the first fails. The chain-tip check asks every
provider, but only for the tip. Running entirely in the browser means
there's no server of ours, not that the providers can't see your queries.
Live updates keep a connection open to mempool.space (or your endpoint)
that carries only "new block" notices, never your lookups. To keep
lookups private, use your own endpoint exclusively.

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
| `api.js` | Providers (incl. your own endpoint), failover, health scoring |
| `refresh.js` | Cache-first refresh with freshness status |
| `db.js` | IndexedDB wrapper and cache pruning |
| `search.js` | Classifies search input (height, hash, address, invalid) |
| `format.js` | BTC amounts, fee rates, times |
| `spv.js` | Verification primitives: header proof of work, Merkle roots and proofs, txids from raw transactions |
| `verify.js` | Runs the checks behind each badge |
| `live.js` | Live "new block" notifications over WebSocket |
| `consensus.js` | Compares chain tips across providers |
| `chainwork.js` | Total work behind a tip, from one header per difficulty period |
| `inputs.js` | Checks inputs against the raw transactions they spend |
| `difficulty.js` | Bitcoin's difficulty retarget rules, checked per block |
| `components/` | Views, plus the shared `DataStatus` and `VerifyBadge` |
| `tests/` | Unit tests |

## License

MIT, see [LICENSE](LICENSE).

## Assisted by

[ChatGPT](https://chatgpt.com/) and [Claude Code](https://claude.com/claude-code).
