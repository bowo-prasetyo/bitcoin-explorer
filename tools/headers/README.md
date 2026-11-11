# Header files

Static files holding every block header of each **finished difficulty
period**, so that a browser can download the whole header chain without
~97,000 requests to public providers. Part of the full-header-chain work
in [VISION.md](../../VISION.md); no page uses them yet.

The files are **transport only**. A browser checks every byte from the
genesis block itself (`headerchain.js`), so it never has to trust where
they came from.

## Where they live

On the `headers` branch, kept apart from `main` so that `main` stays
small:

| Path | Contents |
|---|---|
| `periods/00000.bin`, `periods/00001.bin`, … | Period *n*: the 2,016 raw 80-byte headers of blocks 2,016·*n* to 2,016·*n* + 2,015, in order (161,280 bytes) |
| `manifest.json` | Number of periods, and the chain state after the last one (height, hash, chainwork and what checking the next period needs) |

The [Deploy site workflow](../../.github/workflows/pages.yml) publishes
them with the site under `headers/`, for example
`https://bowo-prasetyo.github.io/bitcoin-explorer/headers/manifest.json`.
It runs after every Header files run as well as on every push to
`main`. The service worker leaves these requests alone: they are Bitcoin
data, not part of the app.

Only periods whose last block is at least 100 blocks below every
provider's tip are published. The newest, unfinished period is never in
a file.

## How they are made

The [Header files workflow](../../.github/workflows/headers.yml) runs
daily, and can be started by hand from the Actions tab. It runs
`sync-headers.mjs`, which:

1. re-checks every stored period from the genesis block;
2. fetches each new finished period 10 blocks per request from
   Blockstream and mempool.space in turn, one request at a time per
   provider and at least 250 ms apart, with back-off on errors;
3. checks it against Bitcoin's header rules from where the stored chain
   ends. If it fails, it fetches the period from each provider alone and
   keeps a copy that passes; if none does, the run fails and nothing is
   added;
4. requires both providers to have the period's last block at that
   height;
5. writes the file and the manifest, and the workflow commits every 20
   minutes.

The first fill takes more than one run (Actions jobs stop at 6 hours);
each run continues from the last commit. After that, a run adds about
one period every two weeks.

## Run it yourself

```bash
node tools/headers/sync-headers.mjs --dir ../header-files --max-minutes 5
```

Options: `--max-periods N`, `--delay-ms 250`, and `--provider URL`
(repeatable; any Esplora API base, such as your own node's). Exit code 0
means up to date (or providers unavailable, with a warning), 3 that it
stopped at a limit with more to add, and 1 that a check failed.

The logic is in `sync.mjs` and is covered by
`tests/headersync.test.mjs`, which runs it against mock providers
serving a mined test chain.
