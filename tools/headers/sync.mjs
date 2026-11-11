// tools/headers/sync.mjs
// Builds the static header files: one file per finished difficulty
// period, 2,016 raw 80-byte headers each, plus manifest.json. CI runs it
// (see sync-headers.mjs and .github/workflows/headers.yml); the site
// doesn't load this module.
//
// The files are transport only. Browsers will check every byte from the
// genesis block themselves, so nothing here needs to be trusted; the
// checks below keep a bad provider answer from ever being published.
//
// Each run:
//   1. re-checks every stored period from the genesis block, so a damaged
//      branch is caught before anything is added to it;
//   2. asks every provider for its tip and only adds periods whose last
//      block is at least `finality` blocks below the lowest tip;
//   3. fetches a period 10 blocks per request (Esplora /blocks/:height),
//      taking turns between providers so each carries part of the load,
//      at most one request a second each, slower when rate limited;
//   4. checks it with headerchain.js from where the stored chain ends; if
//      it fails, fetches it again from each provider alone, so one bad
//      provider can't block the run, and names the one that failed;
//   5. requires every provider that answers to have the period's last
//      block at that height, and at least one to answer (a provider that
//      is rate limited is not waited for: it just doesn't answer);
//   6. writes the period file and the manifest before starting the next,
//      so progress survives an interrupted run.

import { checkHeaders, HEADER_SIZE, MAINNET } from '../../headerchain.js';
import { headerFromBlockJson } from '../../spv.js';
import { RETARGET_INTERVAL } from '../../difficulty.js';

export const PERIOD_BYTES = RETARGET_INTERVAL * HEADER_SIZE;

// Blocks a period's last block must be below every provider's tip before
// it is published: deep enough that a reorganisation won't replace it.
export const FINALITY = 100;

export const PROVIDERS = ['https://blockstream.info/api', 'https://mempool.space/api'];

export const MANIFEST = 'manifest.json';
export const FORMAT = 1;

// periods/00000.bin holds blocks 0..2015, periods/00001.bin 2016..4031, ...
export function periodFile(index) {
  return `periods/${String(index).padStart(5, '0')}.bin`;
}

// headerchain.js state <-> JSON (work is a BigInt).
export function encodeState(s) {
  return { ...s, work: '0x' + s.work.toString(16) };
}

export function decodeState(j) {
  return { ...j, work: BigInt(j.work) };
}

const fmt = n => n.toLocaleString('en-US');

// =====================================================
// STORED PERIODS
// =====================================================

// store: { read(path) -> Promise<Uint8Array | null>, write(path, bytes) }
// Re-checks every stored period from the genesis block and that the
// manifest describes them. Returns { periods, state } (state null when
// nothing is stored). Throws when anything is wrong.
export async function verifyStored(store, params = MAINNET) {
  const raw = await store.read(MANIFEST);

  if (!raw) {
    return { periods: 0, state: null };
  }

  const manifest = JSON.parse(new TextDecoder().decode(raw));

  if (manifest.format !== FORMAT || manifest.headerSize !== HEADER_SIZE ||
      manifest.periodLength !== RETARGET_INTERVAL) {
    throw new Error(`${MANIFEST} has an unknown format`);
  }

  let state = null;

  for (let i = 0; i < manifest.periods; i++) {
    const bytes = await store.read(periodFile(i));

    if (!bytes || bytes.length !== PERIOD_BYTES) {
      throw new Error(`${periodFile(i)} is missing or not ${fmt(PERIOD_BYTES)} bytes`);
    }

    const r = checkHeaders(bytes, state, params);

    if (!r.ok) {
      throw new Error(`Stored ${periodFile(i)} fails: block ${fmt(r.failure.height)} ${r.failure.problem}`);
    }

    state = r.state;
  }

  const tip = manifest.tip ? decodeState(manifest.tip) : null;

  if (state === null ? tip !== null
    : !tip || tip.height !== state.height || tip.hash !== state.hash || tip.work !== state.work) {
    throw new Error(`${MANIFEST} doesn't match the stored periods`);
  }

  return { periods: manifest.periods, state };
}

function manifestBytes(periods, state, network, now) {
  const manifest = {
    format: FORMAT,
    network,
    headerSize: HEADER_SIZE,
    periodLength: RETARGET_INTERVAL,
    periods,
    files: 'periods/NNNNN.bin, NNNNN = period index, 5 digits',
    tip: encodeState(state),
    updated: new Date(now()).toISOString()
  };
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
}

// =====================================================
// PROVIDERS
// =====================================================

// A polite HTTP client for Esplora providers: one request at a time per
// provider, at least `delayMs` apart, a timeout, and retries.
//
// Rate limits (HTTP 429) slow that provider down: its spacing doubles (up
// to 30 s) and eases back by 5 % per successful request. Some providers
// limit requests per window rather than per second (Blockstream refused
// for 18+ minutes after ~720 requests, however slowly they came), so a
// 429 also parks the provider for a cool-down: 5 minutes, doubling up to
// an hour. Then, by request:
//   patient (default): wait as long as Retry-After asks (up to 5 min), or
//     5, 10, 20 ... 120 s, and give up after `rateLimitRetries` of them;
//   { patient: false }: throw a RateLimited error at once, so the caller
//     can ask another provider; `limited(base)` says whether a provider is
//     parked.
// Network errors and 5xx are retried `retries` times, after 1, 2, 4, 8 s.
// `fetch`, `sleep` and `now` can be replaced in tests.
export function makeClient({
  fetch = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = Date.now,
  delayMs = 1000,
  timeoutMs = 20000,
  retries = 4,
  rateLimitRetries = 8,
  log = () => {}
} = {}) {
  const MAX_SPACING = 30_000;
  const nextAt = new Map();
  const spacing = new Map();
  const parkedUntil = new Map();
  const parkedTimes = new Map();
  let requests = 0;

  // Parks `base` after a rate limit: 5 min, 10, 20, 40, then 60.
  function park(base) {
    const n = parkedTimes.get(base) ?? 0;
    parkedTimes.set(base, n + 1);
    const cooldown = Math.min(3_600_000, 300_000 * 2 ** n);
    parkedUntil.set(base, now() + cooldown);
    return cooldown;
  }

  const spacingOf = base => spacing.get(base) ?? delayMs;

  function retryAfterMs(res) {
    const v = res.headers?.get?.('retry-after');
    if (!v) return null;
    const seconds = Number(v);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(v) - now();
    return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 300_000) : null;
  }

  async function get(base, path, { patient = true } = {}) {
    let failures = 0;
    let limited = 0;

    for (;;) {
      const wait = (nextAt.get(base) ?? 0) - now();
      if (wait > 0) await sleep(wait);
      nextAt.set(base, now() + spacingOf(base));
      requests++;

      let res = null;
      let error = null;

      try {
        res = await fetch(base + path, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'user-agent': 'assay-header-files' }
        });
      } catch (err) {
        error = err;
      }

      if (res?.ok) {
        spacing.set(base, Math.max(delayMs, Math.round(spacingOf(base) * 0.95)));
        parkedUntil.delete(base);
        parkedTimes.delete(base);
        return res;
      }

      if (res?.status === 429 && !patient) {
        spacing.set(base, Math.min(MAX_SPACING, spacingOf(base) * 2));
        const cooldown = park(base);
        log(`rate limited by ${base}: asking other providers for ${Math.round(cooldown / 60000)} min`);
        const err = new Error(`${base}${path}: HTTP 429`);
        err.rateLimited = true;
        throw err;
      }

      if (res?.status === 429) {
        if (++limited > rateLimitRetries) {
          park(base);
          throw new Error(`${base}${path}: HTTP 429 (rate limited ${limited - 1} times in a row)`);
        }
        const slower = Math.min(MAX_SPACING, spacingOf(base) * 2);
        spacing.set(base, slower);
        const backoff = retryAfterMs(res) ?? Math.min(120_000, 5000 * 2 ** (limited - 1));
        log(`rate limited by ${base}: waiting ${Math.round(backoff / 1000)} s, then one request every ${(slower / 1000).toFixed(1)} s`);
        await sleep(backoff);
        continue;
      }

      const retryable = error || res.status >= 500;

      if (!retryable || failures >= retries) {
        throw new Error(`${base}${path}: ${error ? error.message : `HTTP ${res.status}`}`);
      }

      const backoff = 1000 * 2 ** failures++;
      log(`retrying ${base}${path} in ${backoff / 1000} s (${error ? error.message : `HTTP ${res.status}`})`);
      await sleep(backoff);
    }
  }

  return {
    async text(base, path, opts) {
      return (await (await get(base, path, opts)).text()).trim();
    },
    async json(base, path, opts) {
      return (await get(base, path, opts)).json();
    },
    get requests() {
      return requests;
    },
    // Is this provider parked after a rate limit?
    limited: base => (parkedUntil.get(base) ?? 0) > now(),
    // When the earliest parked provider among `bases` may be asked again.
    parkedUntil: base => parkedUntil.get(base) ?? 0,
    // Current spacing per provider (ms), for logs and tests.
    spacing: base => spacingOf(base)
  };
}

// The period starting at `start`, as raw bytes, from `providers` in turn
// (newest blocks first, as /blocks/:height returns them). A provider that
// fails a request is skipped for the rest of the period; one that is rate
// limited is skipped while it is parked, and waited for only when every
// provider is.
export async function fetchPeriod(client, start, providers) {
  const bytes = new Uint8Array(PERIOD_BYTES);
  const have = new Uint8Array(RETARGET_INTERVAL);
  const live = [...providers];
  let turn = 0;
  let next = start + RETARGET_INTERVAL - 1;

  while (next >= start) {
    let blocks = null;
    let lastError = null;

    while (blocks === null && live.length) {
      const free = live.filter(p => !client.limited?.(p));
      // All parked: wait for the one free soonest, patiently.
      const base = free.length
        ? free[turn++ % free.length]
        : live.reduce((a, b) => (client.parkedUntil(b) < client.parkedUntil(a) ? b : a));
      try {
        blocks = await client.json(base, `/blocks/${next}`, { patient: !free.length });
      } catch (err) {
        lastError = err;
        if (!err.rateLimited) live.splice(live.indexOf(base), 1);
      }
    }

    if (blocks === null) {
      throw lastError ?? new Error('No providers');
    }

    let lowest = Infinity;

    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (!Number.isInteger(b?.height) || b.height < start || b.height > next) continue;
      const i = b.height - start;
      bytes.set(Buffer.from(headerFromBlockJson(b), 'hex'), i * HEADER_SIZE);
      have[i] = 1;
      lowest = Math.min(lowest, b.height);
    }

    if (!have[next - start]) {
      throw new Error(`No provider returned block ${fmt(next)}`);
    }

    next = lowest - 1;
  }

  const missing = have.indexOf(0);
  if (missing !== -1) {
    throw new Error(`No provider returned block ${fmt(start + missing)}`);
  }

  return bytes;
}

// =====================================================
// SYNC
// =====================================================

// Adds finished periods to `store` until up to date, `maxPeriods` added,
// or `deadline` (ms since epoch) passed. Returns
//   { status: 'up-to-date' | 'more' | 'unavailable' | 'unconfirmed',
//     periods, added, tipHeight?, note? }
// and throws when stored data or a period fails its checks.
export async function syncPeriods({
  store,
  client,
  providers = PROVIDERS,
  params = MAINNET,
  network = 'mainnet',
  finality = FINALITY,
  maxPeriods = Infinity,
  deadline = Infinity,
  now = Date.now,
  log = () => {}
}) {
  let { periods, state } = await verifyStored(store, params);
  log(`stored: ${fmt(periods)} periods${state ? `, up to block ${fmt(state.height)}` : ''}, all checked from the genesis block`);

  // Provider answers are asked without waiting out rate limits: a parked
  // provider simply doesn't answer this time.
  const ask = async (p, path) => {
    if (client.limited?.(p)) return null;
    try {
      return await client.text(p, path, { patient: false });
    } catch {
      return null;
    }
  };

  const tips = await Promise.all(providers.map(async p => {
    try {
      const h = Number(await ask(p, '/blocks/tip/height') ?? NaN);
      return Number.isInteger(h) ? h : null;
    } catch {
      return null;
    }
  }));

  const answered = tips.filter(h => h !== null);

  if (!answered.length) {
    return { status: 'unavailable', periods, added: 0, note: 'no provider answered' };
  }

  const tipHeight = Math.min(...answered);
  const safe = tipHeight - finality;
  let added = 0;

  while (added < maxPeriods) {
    const start = periods * RETARGET_INTERVAL;
    const end = start + RETARGET_INTERVAL - 1;

    if (end > safe) {
      return { status: 'up-to-date', periods, added, tipHeight };
    }

    if (now() >= deadline) {
      return { status: 'more', periods, added, tipHeight };
    }

    let bytes = await fetchPeriod(client, start, providers);
    let r = checkHeaders(bytes, state, params);

    // Find out whether one provider alone sends a period that checks out.
    if (!r.ok) {
      const first = r.failure;
      log(`period ${periods} failed (block ${fmt(first.height)} ${first.problem}); fetching it from each provider alone`);

      for (const p of providers) {
        try {
          const alone = await fetchPeriod(client, start, [p]);
          const ra = checkHeaders(alone, state, params);
          if (ra.ok) {
            bytes = alone;
            r = ra;
            break;
          }
          log(`  ${p}: block ${fmt(ra.failure.height)} ${ra.failure.problem}`);
        } catch (err) {
          log(`  ${p}: ${err.message}`);
        }
      }

      if (!r.ok) {
        throw new Error(`Period ${periods} (blocks ${fmt(start)}–${fmt(end)}) fails from every provider: ` +
          `block ${fmt(first.height)} ${first.problem}`);
      }

      log(`  used the copy that passed; the others sent data that fails Bitcoin's rules`);
    }

    // Every provider that answers must have this period's last block, and
    // at least one must answer. Each header is already checked against
    // Bitcoin's rules; this catches a provider on another chain.
    const hashes = await Promise.all(providers.map(async p => (await ask(p, `/block-height/${end}`))?.toLowerCase() ?? null));

    const differing = providers.filter((p, i) => hashes[i] !== null && hashes[i] !== r.state.hash);

    if (differing.length) {
      throw new Error(`${differing.join(', ')} ${differing.length === 1 ? 'has' : 'have'} a different block at height ${fmt(end)} ` +
        `than the checked period (${r.state.hash})`);
    }

    if (!hashes.some(Boolean)) {
      return { status: 'unconfirmed', periods, added, tipHeight, note: `no provider could confirm block ${fmt(end)}` };
    }

    await store.write(periodFile(periods), bytes);
    periods++;
    state = r.state;
    await store.write(MANIFEST, manifestBytes(periods, state, network, now));
    added++;
    log(`added period ${periods - 1} (blocks ${fmt(start)}–${fmt(end)})`);
  }

  const done = (periods + 1) * RETARGET_INTERVAL - 1 > safe;
  return { status: done ? 'up-to-date' : 'more', periods, added, tipHeight };
}
