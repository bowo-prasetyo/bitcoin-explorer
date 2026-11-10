# Vision

**Assay: a Bitcoin explorer where your browser checks the data instead of trusting it.**

Every explorer today asks you to trust its server. This one runs entirely in
your browser and is working toward verifying what public APIs tell it:
proof-of-work on block headers, Merkle inclusion proofs for transactions,
agreement across independent providers, and the option to point it at your
own node.

The goal is that every number on screen can say *how* it is known, and
whom it was asked.

## Who it's for

People who want to look something up on Bitcoin without taking a single
company's word for it: node runners, developers, and anyone who cares about
"don't trust, verify" but doesn't want to run a full node just to check a
transaction.

## Principles

1. **Verify, then display.** When the browser can check something, it does,
   and the UI says so. When it can't, the UI says that too.
2. **Honest about freshness and failure.** Show how old data is, say when a
   provider couldn't be reached, and never leave a blank page.
3. **Know whom you're asking.** Only providers with a known operator. Make
   provider health visible. Let users bring their own endpoint.
4. **Static and serverless.** It runs from any static host; there is no
   backend of ours to trust.
5. **Claims match code.** The README and the user docs in `docs/` describe
   what exists today; ideas live in the roadmap below.

## Roadmap

### Phase 1 — Honesty and hygiene ✅

- Show cached data immediately, with its age, even when offline.
- Skip the network while cached data is still fresh.
- Loading, error, not-found and empty states on every view.
- "Not found" is treated as an answer, not a provider failure.
- Remove duplicate and unverified providers; pause background
  benchmarking in hidden tabs.
- Pin CDN dependencies with Subresource Integrity.
- Fix the Merkle-root implementation (byte order) and cover it with tests.
- README rewritten to match reality.

### Phase 2 — A usable explorer ✅

- Search: Enter to submit, block-height search, input validation with
  explanations (wrong length, testnet address, mixed-case bech32).
- Clickable recent blocks; previous/next block navigation.
- Transaction amounts, fee rate, size, time and block link; input links to
  the transaction that created each spent output.
- Address balance, pending change and paginated history with the net
  effect of each transaction.
- Block transactions paginated 25 at a time.
- IndexedDB cache pruned by age (7 days) and size (500 entries); the
  write-only `blocks`/`txs` stores are gone.
- Readable on phones.

### Phase 3 — Make verification visible ✅

- Header proof-of-work check on every block: the header hashes to the
  block id, meets its own difficulty target, that target is within mainnet
  limits, and the details shown match the header.
- Full transaction list of a block rebuilds the header's merkle root.
- Transaction contents: raw bytes hash to the txid and contain the outputs
  shown.
- Merkle inclusion proof on every confirmed transaction, against a
  proof-of-work-checked header.
- Cross-provider agreement on the chain tip, telling "one block behind"
  from "a different chain".
- Provider health panel.
- Bring-your-own Esplora endpoint, optionally exclusive.

Since phase 3, work ships as individual features:

### Difficulty check ✅

- Every block page checks that its difficulty is the one the retarget
  rules require at its height: equal to its period's first block, which
  in turn is the retarget computed from the previous period's headers.
  The arithmetic is tested against Bitcoin Core's own test vectors.

### Input amounts check ✅

- Every transaction page checks each input's amount and address against
  the raw transaction it spends from (which must hash to its txid), and
  recomputes the fee from verified inputs and outputs. Large
  transactions ask before downloading more than 25 spent transactions.

### Total work behind the tip ✅

- The home page can add up the chain's total proof of work ("chainwork")
  exactly, from one proof-of-work-checked header per difficulty period,
  and show it in the same form as Bitcoin Core so it can be compared
  with your own node. Opt-in the first time; cached afterwards.

### Difficulty history ✅

- The difficulty of any block can be traced back to the genesis block:
  every retarget on the way is recomputed from proof-of-work-checked
  headers (each period's first and last block). It runs automatically on
  block pages once the headers are cached, and alongside the total-work
  check on the home page.

### Live updates ✅

- New blocks are announced over one shared WebSocket, used only as a hint
  to fetch and verify through the normal path. It replaces fast polling of
  the tip and of pending transactions, is opened only while needed, backs
  off politely, and falls back to polling.

### Everyday convenience ✅

- Search from every page, including `bitcoin:` payment links.
- Confirmations on transaction pages; copy buttons for hashes, txids and
  addresses; a "Page not found" view instead of a blank page.
- One summary line per page for all its verification badges, which is
  also what screen readers announce.
- Jargon explained in place, from an in-app glossary kept identical to
  `docs/glossary.md`.
- Polish: visible keyboard focus, 44 px touch targets, phone-friendly
  tables, readable charts with a table view, a title per tab, local time
  next to UTC, and a two-column home page.

### Historical charts ✅

- Difficulty, average block time and estimated hashrate since 2009, one
  point per difficulty period, drawn only from the headers the
  difficulty-history check has just verified (no chart from a failed
  check). No extra download for anyone who has run the total-work check.
- Deliberately not included: past mempool sizes and fees. Assay can't
  check them, and they aren't part of the Esplora API, so they wouldn't
  work with your own node.

### Installable, offline app ✅

- A web app manifest and icons make Assay installable from Chrome, Edge
  and Safari. A service worker saves the app's own files and pinned
  libraries, so after one visit it opens with no connection and shows
  the pages viewed before, marked as saved, with their age.
- The service worker never stores Bitcoin data or lookups, and the
  app's files are network-first, so online visits always run the
  deployed version without a build step to version them.

### Next ideas

- Link every header inside each period. That needs all ~925,000 headers
  (~74 MB), so it's likely only worthwhile with a bulk-header source or a
  user's own node.

### Out of scope for now

Wallet integration, transaction broadcasting, WebRTC peers and Lightning
monitoring. They would spread a young product too thin.
