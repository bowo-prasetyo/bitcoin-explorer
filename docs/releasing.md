# Releasing Assay

The site deploys from `main` to GitHub Pages on every merge. A **release**
is a tagged version that has also passed the checks below, including one
against the live data providers, which automated tests can't reach.

## 1. Automated checks

- CI is green on the `main` commit you're releasing: the **unit** and
  **browser** jobs in `.github/workflows/test.yml`.
- The Pages deployment of that commit finished
  (**Actions → Deploy site**, `.github/workflows/pages.yml`).

## 2. Live check (about 10 minutes)

Open <https://bowo-prasetyo.github.io/bitcoin-explorer/> in a normal
browser window, and reload once so the new version is running.

1. **Home:** the header shows **● Live** within a few seconds. The
   chain-tip badge says the providers agree.
2. **A recent block** (click one under Recent blocks): the summary says
   all checks passed, with proof of work, difficulty and transaction list
   all ✓.
3. **A recent confirmed transaction** (click one on that block):
   contents, input amounts and fee, and inclusion are all ✓. Every input
   amount has a green ✓.
4. **Home → Add up the total work:** the total work and the difficulty
   history both finish ✓. If you run a node, compare the chainwork value
   with `bitcoin-cli getblockchaininfo` for the same block.
5. **Charts:** the difficulty, block time and hashrate charts draw from
   the same headers.
6. **Search:** a block height, a txid, an address and an invalid string
   each behave as expected.
7. **Offline:** install the app (or keep the tab), go offline, and reopen
   it. It loads and shows earlier pages marked as saved.
8. **Providers:** both providers are healthy, and the live-updates panel
   shows the WebSocket endpoint and a low requests-per-minute figure.

Any grey or red badge on real data is a release blocker. Note what it
says under **What was checked**, and fix it first.

## 3. Release

1. In `CHANGELOG.md`, change the version heading from *unreleased* to
   today's date (`## [1.2.0] — 2026-11-12`), and start a new
   *unreleased* section above it for the next changes.
2. Only if the offline cache's contents changed in an incompatible way,
   bump `VERSION` in `sw.js`. Otherwise leave it: changing it discards
   everyone's saved copy.
3. Merge that to `main`. Once CI is green, tag the merge commit `vX.Y.Z`
   and create a GitHub release from the tag, with that version's changelog
   section as its notes.

## Versioning

[Semantic Versioning](https://semver.org/), read for a web app:

- **Major:** a change in what a badge means, or in what the app sends to
  providers (privacy).
- **Minor:** new features or new checks.
- **Patch:** fixes and wording.
