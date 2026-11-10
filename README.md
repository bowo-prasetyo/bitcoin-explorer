<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/assay-logo.svg">
    <img src="brand/assay-logo-on-light.svg" alt="Assay" height="48">
  </picture>
</h1>

A Bitcoin explorer that runs entirely in your browser and **checks**
blockchain data instead of trusting it.

To *assay* is to test a metal independently to find out whether it is
what it claims to be. Assay does the same for Bitcoin data: your browser
checks what public servers say before it shows it, and tells you exactly
what it could and couldn't prove.

**[Open Assay](https://bowo-prasetyo.github.io/bitcoin-explorer/)** ·
**[User guide](docs/user-guide.md)** ·
**[What gets verified](docs/verification.md)** ·
**[Glossary](docs/glossary.md)** ·
**[Vision and roadmap](VISION.md)**

## Quick start

1. Open the [live site](https://bowo-prasetyo.github.io/bitcoin-explorer/).
   Nothing to install, no account, no node needed. Bitcoin mainnet only.
2. Type a **block height, block hash, transaction id or address** (or
   paste a `bitcoin:` payment link) into the search box and press
   **Enter**.
3. Read the summary line at the top of block and transaction pages, then
   the badges under it:

   | Badge | Meaning |
   |---|---|
   | **✓** green | Verified by your browser |
   | **✗** red | Check failed: the data doesn't add up |
   | **!** grey | Couldn't check (never counted as a pass) |
   | **–** grey | Nothing to check here |
   | **…** grey | Checking |

   Click **What was checked** under any badge for the details. Panels
   your browser can't check, such as address balances, are marked
   **Not verified**.

The [user guide](docs/user-guide.md) walks through common tasks:
confirming a payment, checking a block, using your own node and more.

## What your browser checks

| On | Your browser proves | It can't prove |
|---|---|---|
| **Blocks** | The header has valid proof of work. The difficulty follows Bitcoin's rules, traced back to the genesis block. The transaction list matches the header. | That the block is on the chain with the most work. |
| **Transactions** | The contents match the txid. Each input's amount comes from the transaction it spends, so the fee is right. A Merkle proof shows that the transaction is in its block. | That the coins spent were still unspent. |
| **The chain** | Independent providers agree on the newest block. Optional: the chain's total work, matching Bitcoin Core's `chainwork`. | Anything, with only one provider. |
| **Addresses, mempool, fees** | Nothing. These are shown as reported and marked **Not verified**. | Balances need the full UTXO set, which only full nodes keep. |

Every check, with exactly what it proves and doesn't, is in
[What your browser verifies](docs/verification.md).

## Features

- **Search** from every page by height, hash, txid, address or
  `bitcoin:` payment link. Input is checked before anything is sent,
  with an explanation when it can't be valid.
- **Verification at a glance:** a summary line on block and transaction
  pages ("All 3 checks passed", "1 of 3 checks FAILED"), above the
  individual badges.
- **Plain words:** tap a dotted-underlined label for its definition, or
  open the in-app glossary.
- **Copy** buttons for hashes, txids and addresses.
- **Home:** chain tip, recent blocks, mempool, fee estimates and a fee
  histogram (with a table view), in two columns on wide screens.
- **Comfortable to use:** keyboard focus is always visible, controls are
  at least 44 px tall on touch screens, wide tables become cards on
  phones, each page has its own tab title, and times show your own time
  zone next to UTC.
- **Blocks:** time, confirmations, size, weight, links to neighbouring
  blocks, and all transactions, 25 per page.
- **Transactions:** status, confirmations, fee and fee rate, size, every
  input and output. Inputs link to the transaction that created the coins.
- **Addresses:** balance, pending change, totals, and history with each
  transaction's effect on the balance.
- **Charts:** pending-transaction count over time, recorded by your
  browser while the page is open.
- **Providers:** health of each data provider, whether they agree, live
  updates on/off, and a form to **use your own node**.
- **Works offline-first:** the last copy of each page shows instantly,
  with its age, even when providers can't be reached.
- **Live updates:** new blocks are announced over one WebSocket instead
  of constant polling.

## Privacy in one paragraph

Assay has no server of its own, but the data providers (Blockstream and
mempool.space by default) **can see what you look up**. To keep lookups
private, [use your own Esplora endpoint](docs/user-guide.md#5-use-your-own-node)
with **Use only my endpoint** ticked. The details are in the
[user guide](docs/user-guide.md#7-privacy-who-sees-your-lookups).

---

## For developers

Assay is a static site (Vue, Vue Router, Chart.js, IndexedDB) that reads
from public [Esplora](https://github.com/Blockstream/esplora/blob/master/API.md)
APIs. There is no backend, so it can be hosted on GitHub Pages or any
static host.

### Run locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Dependencies load from CDNs at pinned
versions with Subresource Integrity (see `index.html`).

### Tests

```bash
node --test tests/*.test.mjs
```

Requires Node 20 or newer. CI runs the same command, and a syntax check
of every browser module, on every push and pull request.

### Behaviour on the network

- **Providers and failover:** requests go to [Blockstream](https://blockstream.info/)
  and [mempool.space](https://mempool.space/), plus your own endpoint if
  you set one. If one fails or takes longer than 8 s, the next is tried.
  Providers are ranked by a health score, re-checked every 5 minutes
  while the tab is visible, and the last one that worked is preferred on
  the next visit. A "not found" answer counts as an answer, not as a
  provider failure. A provider caught sending an invalid chain tip is
  left out of lookups until its tip passes the check again (24 hours at
  most), so pages never fall back to a provider known to send fake blocks.
- **Your own endpoint** is tried first, or used exclusively. It must send
  CORS headers and, from the https site, use https, except for localhost
  and `.onion` addresses in Tor Browser. It is tested before it can be
  saved.
- **Cache:** every view shows its IndexedDB copy immediately, then
  refreshes. No request is made while the copy is younger than its
  lifetime:

  | Data | Lifetime |
  |---|---|
  | Mempool | 10 s |
  | Chain tip, recent blocks, pending transactions | 15 s |
  | Fee estimates, addresses, blocks with fewer than 6 confirmations | 30 s |
  | Blocks with 6+ confirmations | 10 min |
  | Confirmed transactions | 1 h |
  | A block's transaction list | 24 h |

  At startup, entries older than 7 days are pruned and the cache is
  capped at 500 entries. Block headers for the difficulty and total-work
  checks are kept separately and not pruned.
- **Polling:** every 10 s while you're active and 30 s when idle. It
  pauses in background tabs, and stops when there's nothing left to
  watch, for example once a transaction confirms. A transaction page
  keeps asking for the tip height only, to count confirmations.
- **Live updates:** one shared WebSocket to mempool.space (or to your
  endpoint, if it runs a mempool backend) that subscribes to new blocks
  only. A message is a hint to fetch and verify through the normal
  requests. While it's connected, the tip, recent blocks and pending
  transactions are polled every 5 minutes as a safety net. The socket
  closes 30 s after the tab goes to the background, pings every 30 s,
  reconnects with exponential back-off and jitter (2 s up to 5 min), and
  falls back to polling. Blockstream and electrs have no WebSocket.
  With your endpoint set to exclusive, the socket goes only to it.

### Project layout

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
| `summary.js` | Sums up a page's badges in one line |
| `titles.js` | Browser tab title for each page |
| `glossary.js` | The in-app glossary; must match `docs/glossary.md` (a test checks) |
| `live.js` | Live "new block" notifications over WebSocket |
| `consensus.js` | Compares chain tips across providers |
| `distrust.js` | Leaves providers that sent an invalid tip out of lookups, and when to let them back in |
| `chainwork.js` | Total work behind a tip, from one header per difficulty period |
| `inputs.js` | Checks inputs against the raw transactions they spend |
| `difficulty.js` | Bitcoin's difficulty retarget rules, checked per block |
| `components/` | Views, plus shared pieces: `DataStatus`, `VerifyBadge`, `VerifySummary`, `ProviderNote`, `SearchBox`, `CopyButton`, `GlossaryTerm` |
| `docs/` | User guide, verification reference, glossary |
| `tests/` | Unit tests |
| `brand/`, `favicon.*`, `apple-touch-icon.png` | Logo, favicons and brand guide ([brand/README.md](brand/README.md)) |

### Documentation

The README and `docs/` describe only what exists today. Plans live in
[VISION.md](VISION.md). When a change alters what users see, update the
[user guide](docs/user-guide.md), and when it changes a check, update
[verification.md](docs/verification.md).

## License

MIT, see [LICENSE](LICENSE).

## Assisted by

[ChatGPT](https://chatgpt.com/) and [Claude Code](https://claude.com/claude-code).
