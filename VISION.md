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

### Phase 2 — A usable explorer

- Search: Enter to submit, block-height search, input validation.
- Clickable recent blocks; previous/next block navigation.
- Transaction amounts, fee rate and time; address balance and history.
- Block transaction pagination.
- Cache eviction for IndexedDB.

### Phase 3 — Make verification visible

- Header proof-of-work check on every block (hash vs. target).
- Merkle inclusion proof on every confirmed transaction.
- Cross-provider agreement on the chain tip.
- Provider health panel.
- Bring-your-own Esplora endpoint (self-hosted node, Tor).

### Later

- Live updates over WebSocket.
- Installable PWA with offline support.
- Historical charts.

### Out of scope for now

Wallet integration, transaction broadcasting, WebRTC peers and Lightning
monitoring. They would spread an unproven product too thin; revisit once
phase 3 has shipped.
