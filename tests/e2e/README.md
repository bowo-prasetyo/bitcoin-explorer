# Browser tests

These drive the real app in headless Chromium with every data provider
**mocked**, so they run offline and never touch the Bitcoin network. Where
cryptography matters, the mocks serve **real mainnet data** (the genesis
block, block 100,000 and its transactions, the raw genesis coinbase), then
tamper with it to check that every badge turns red for the right reason.

```bash
npm ci                      # dev tooling only; the site needs no install
npm run test:e2e            # all suites
npm run test:e2e -- 03 08   # suites whose file names contain 03 or 08
E2E_SCREENSHOTS=shots npm run test:e2e   # also save screenshots
```

CI runs them on every push and pull request (`.github/workflows/test.yml`).
If CI fails, its screenshots are attached to the run.

## How it works

- `run.cjs` serves the repository root on a random local port, runs each
  suite and exits non-zero if any check fails.
- `lib.cjs` makes every browser context start isolated: any request that
  isn't to the local server or explicitly mocked by the suite is blocked,
  and WebSockets are refused unless the suite mocks them.
- The pinned libraries (Vue, Vue Router, Chart.js) come from
  `node_modules`, at the exact versions `index.html` loads, so the page's
  Subresource Integrity hashes are checked too.
- Suites that need time to pass (polling, back-off, live updates) use
  Playwright's fake clock rather than waiting.

## Suites

| File | Covers |
|---|---|
| `01-honesty` | Freshness labels, cache-first loading, offline with stale cache, outages, "not found" asking one provider only |
| `02-explorer` | Search and its validation, navigation, block pages and paging, transaction and address details, cache pruning, no sideways scrolling on phones |
| `03-verification` | Proof of work, transaction list, transaction contents and inclusion, provider agreement on the tip, your own endpoint (including exclusive mode) |
| `04-difficulty` | Difficulty is correct for the height |
| `05-inputs` | Input amounts and fee, large transactions asking first |
| `06-chainwork` | Total work behind the tip, matching Bitcoin Core's value for the genesis block |
| `07-difficulty-history` | Difficulty traced back to the genesis block, and the block page's trace button |
| `08-live-updates` | Live updates: blocks-only subscription, less polling, reconnect back-off, hidden tabs, exclusive endpoint |

## What they can't cover

The checks that need many real consecutive headers, such as a passing
difficulty history across periods, can't be built from the little real
data the suites carry. Their logic is covered by the unit tests
(`tests/*.test.mjs`). Behaviour against the live providers is covered by
the release checklist in `docs/releasing.md`.
