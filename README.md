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
| **Block difficulty** | The difficulty is the one Bitcoin's rules require at that height. Inside a 2,016-block period it equals the period's first block. At the period start it is the retarget computed from the previous period's first and last headers (two-week target, 4× clamp, network limit), matching Bitcoin Core's arithmetic. All headers used pass the proof-of-work checks, and the period's first block builds on the previous period's last. | One retarget step only. The previous period's difficulty is taken from its headers, not re-derived back to the genesis block, and blocks between the period start and this block aren't linked header by header. |
| **Block transactions** | The full txid list rebuilds the header's Merkle root. The count matches. The transactions on the page are in that list, in order. | (A block's transactions can't be hidden or reordered without failing this.) |
| **Transaction contents** | The raw transaction hashes to its txid. Output amounts and scripts match what's shown. Spent outputs match the inputs shown. | (Input amounts are covered by the next row.) |
| **Input amounts and fee** | Each spent transaction is downloaded raw and hashes to its txid. The output each input spends holds the amount and address shown, marked ✓/✗ per input. Fee = inputs − verified outputs, and it matches the fee shown. Runs automatically for up to 25 spent transactions; above that, a button starts it. | That the spent outputs were still unspent. That needs the full set of unspent outputs, which only full nodes keep. |
| **Transaction inclusion** | A Merkle proof leads from the txid to a block header that passes the proof-of-work checks above. | Same limits as the block check. |
| **Chain tip** (home page, Providers page) | Every provider is asked independently. Each tip header's proof of work is checked. The tips are compared, telling "one block behind on the same chain" from "a different chain". | With a single provider, there is nothing to compare. |
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

### Privacy note

Your lookups (addresses, transactions) are sent to the providers above,
and to the next one if the first fails. The chain-tip check asks every
provider, but only for the tip. Running entirely in the browser means
there's no server of ours, not that the providers can't see your queries.
To keep lookups private, use your own endpoint exclusively.

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
| `consensus.js` | Compares chain tips across providers |
| `inputs.js` | Checks inputs against the raw transactions they spend |
| `difficulty.js` | Bitcoin's difficulty retarget rules, checked per block |
| `components/` | Views, plus the shared `DataStatus` and `VerifyBadge` |
| `tests/` | Unit tests |

## License

MIT, see [LICENSE](LICENSE).

## Assisted by

[ChatGPT](https://chatgpt.com/) and [Claude Code](https://claude.com/claude-code).
