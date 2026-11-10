# Changelog

Notable changes to Assay. Versions follow [Semantic Versioning](https://semver.org/).
The site deploys from `main` continuously; a release marks a version that
has passed the [release checklist](docs/releasing.md), including a check
against the live data providers.

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-11-10

The first release. It turns the original client-side Bitcoin explorer
into **Assay**: an explorer whose browser checks blockchain data instead
of trusting it, and says exactly what it could and couldn't prove.

### What your browser verifies

Each check downloads raw data (block headers, raw transactions, Merkle
proofs) and recomputes the facts on screen. A green ✓ means verified, a
red ✗ means the data doesn't add up, and grey means it couldn't be checked
(never counted as a pass). A summary line sits above the badges, and
**What was checked** lists every check.

- **Block proof of work:** the header hashes to the block id and meets its
  difficulty target, that target is within mainnet limits, and the details
  shown match the header.
- **Block difficulty:** the difficulty is the one Bitcoin's rules require
  at that height. The arithmetic is tested against Bitcoin Core's own test
  vectors.
- **Difficulty history:** every retarget from the genesis block to the
  block's period, from proof-of-work-checked headers. It runs automatically
  once the headers are saved.
- **Block transactions:** the full txid list rebuilds the header's Merkle
  root, so transactions can't be hidden or reordered.
- **Transaction contents:** the raw transaction hashes to its txid and
  contains the outputs shown.
- **Input amounts and fee:** each input's amount and address match the
  transaction it spends, and the fee is recomputed from verified numbers.
- **Transaction inclusion:** a Merkle proof ties the transaction to a
  block header that passes the proof-of-work checks.
- **Chain tip agreement:** every provider is asked separately, and their
  tips are checked and compared. A provider that sends an invalid tip is
  reported as a failure and left out of lookups until it recovers.
- **Total work behind the tip:** the chain's total proof of work, exact and
  in the same form as Bitcoin Core's `chainwork`, so it can be compared
  with your own node.

What isn't verified is marked **Not verified** in the app: address
balances, the mempool, fee estimates and the recent-blocks list. See
[What gets verified](docs/verification.md).

### Explorer

- Search from every page by block height, block hash, txid, address or
  `bitcoin:` payment link, with a clear reason when input can't be valid.
- Blocks: time, confirmations, size, weight, neighbouring blocks, and every
  transaction, 25 per page.
- Transactions: status, confirmations, fee and fee rate, size, every input
  and output with amounts. Inputs link to the transaction they spend.
- Addresses: balance, pending change, totals, and paged history showing
  each transaction's effect on the balance.
- Home: chain tip, recent blocks, mempool, fee estimates and a fee
  histogram.
- Charts: difficulty, average block time and estimated hashrate since 2009,
  drawn only from verified headers, with a table and CSV download.
- Copy buttons, an in-app glossary, local time next to UTC, tab titles,
  visible keyboard focus, 44 px touch targets and phone-friendly tables.

### Reliable, offline and live

- Cached data shows instantly with its age, including when providers
  can't be reached. Errors and "not found" are explained, never a blank
  page.
- Installable from Chrome, Edge and Safari. After one visit it opens with
  no connection and shows the pages viewed before, marked as saved.
- Live updates: one WebSocket announces new blocks, so the page stops
  polling for them. A notice is only a hint: the block is still fetched
  and verified the usual way. In tests this cut requests on an idle home
  page by about 40 %.

### Providers and privacy

- Two providers with known operators (Blockstream and mempool.space), with
  failover and a health panel.
- **Use your own node:** point Assay at your own Esplora endpoint, tested
  before saving, and optionally use it exclusively so no lookup leaves your
  own infrastructure.
- The app has no server and no analytics. What each provider can see is
  explained in the [user guide](docs/user-guide.md#7-privacy-who-sees-your-lookups).
- Libraries are pinned with Subresource Integrity.

### Documentation

- [User guide](docs/user-guide.md), [What gets verified](docs/verification.md),
  [Glossary](docs/glossary.md), and [Vision and roadmap](VISION.md).

### For developers

- No build step: a static site that runs from any static host.
- 130 unit tests (verification maths, parsing, formatting) and 133
  browser checks of the real app against mocked providers serving real
  mainnet data. CI runs both on every push and pull request.

### Known limits

- Blocks inside a difficulty period aren't linked header by header. That
  would take all ~925,000 headers.
- A ✓ proves the data is internally consistent and backed by proof of
  work. It doesn't prove the block is on the chain with the most work, or
  that spent outputs were unspent; only a full node can.
- Bitcoin mainnet only.

[Unreleased]: https://github.com/bowo-prasetyo/bitcoin-explorer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bowo-prasetyo/bitcoin-explorer/releases/tag/v1.0.0
