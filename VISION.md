# Vision

**A Bitcoin explorer where your browser checks the data instead of trusting it.**

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
5. **Claims match code.** The README describes what exists today; ideas
   live in the roadmap below.

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

### Difficulty check ✅

- Every block page checks that its difficulty is the one the retarget
  rules require at its height: equal to its period's first block, which
  in turn is the retarget computed from the previous period's headers.
  The arithmetic is tested against Bitcoin Core's own test vectors.

### Next ideas

- Extend the difficulty check further back (several retarget steps), or
  link every header between the period start and the block.
- Verify input amounts by checking the spent outputs' transactions.
- Show the cumulative work behind the tip.

### Later

- Live updates over WebSocket.
- Installable PWA with offline support.
- Historical charts.

### Out of scope for now

Wallet integration, transaction broadcasting, WebRTC peers and Lightning
monitoring. They would spread an unproven product too thin; revisit once
phase 3 has shipped.
