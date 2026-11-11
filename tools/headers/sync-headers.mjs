#!/usr/bin/env node
// tools/headers/sync-headers.mjs
// Adds finished difficulty periods to a directory of header files (the
// `headers` branch). See sync.mjs for what is checked, and README.md.
//
//   node tools/headers/sync-headers.mjs --dir <path> [--max-minutes 20]
//        [--max-periods N] [--delay-ms 1000] [--provider URL ...]
//
// Exit codes: 0 up to date (or providers unavailable: a warning, try
// again later), 3 stopped at a limit with more to add, 1 a check failed.

import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { syncPeriods, makeClient, PROVIDERS } from './sync.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    'max-minutes': { type: 'string', default: '20' },
    'max-periods': { type: 'string' },
    'delay-ms': { type: 'string', default: '1000' },
    provider: { type: 'string', multiple: true }
  }
});

if (!values.dir) {
  console.error('Usage: sync-headers.mjs --dir <path> [--max-minutes 20] [--max-periods N] [--delay-ms 1000] [--provider URL ...]');
  process.exit(2);
}

const dir = values.dir;

const store = {
  async read(path) {
    try {
      return new Uint8Array(await readFile(join(dir, path)));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  // Write to a temporary file, then rename: never a half-written file.
  async write(path, bytes) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full + '.tmp', bytes);
    await rename(full + '.tmp', full);
  }
};

const log = msg => console.log(msg);
const client = makeClient({ delayMs: Number(values['delay-ms']), log });

try {
  const r = await syncPeriods({
    store,
    client,
    providers: values.provider ?? PROVIDERS,
    maxPeriods: values['max-periods'] ? Number(values['max-periods']) : Infinity,
    deadline: Date.now() + Number(values['max-minutes']) * 60_000,
    log
  });

  console.log(`${r.status}: ${r.periods} periods stored, ${r.added} added, ${client.requests} requests` +
    (r.tipHeight ? `, providers' tip ${r.tipHeight}` : '') + (r.note ? ` (${r.note})` : ''));

  if (r.status === 'unavailable' || r.status === 'unconfirmed') {
    console.log(`::warning::Header files not updated: ${r.note}. The next run will try again.`);
  }

  process.exit(r.status === 'more' ? 3 : 0);
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
