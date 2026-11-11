// headersync.js
// Keeps the full header chain in the browser: downloads the site's header
// files (one per finished difficulty period, see tools/headers), checks
// every header from the genesis block (headerchain.js), and stores each
// period in IndexedDB. Opt-in. Covered by tests/headersync-browser.test.mjs.
//
// Nothing downloaded is trusted. The files come from the site's own host,
// but each must continue the checked chain exactly; manifest.json is only
// used to learn how many files there are. What is stored is re-checked
// from the genesis block at the start of every sync.
//
// The engine (syncHeaderFiles) takes its fetch and storage as arguments,
// so it runs the same in a Worker (headerworker.js), on the main thread,
// and in Node tests.

import { checkHeaders, HEADER_SIZE, MAINNET } from './headerchain.js';
import { RETARGET_INTERVAL } from './difficulty.js';
import { get, put, count, deleteFrom } from './db.js';
import { log2, chainWorkHex } from './chainwork.js';

export const PERIOD_BYTES = RETARGET_INTERVAL * HEADER_SIZE;

// More periods than this would be ~38 years past today: a manifest that
// claims it is wrong, not ahead.
const MAX_PERIODS = 1500;

// Where the site serves the files (relative to the app's own URL).
export const HEADERS_PATH = 'headers/';

export function periodFile(index) {
  return `periods/${String(index).padStart(5, '0')}.bin`;
}

// headerchain.js state <-> what is stored (work as hex, not BigInt).
export function encodeState(s) {
  return { ...s, work: '0x' + s.work.toString(16) };
}

export function decodeState(j) {
  return { ...j, work: BigInt(j.work) };
}

const fmt = n => n.toLocaleString('en-US');

// =====================================================
// THE ENGINE
// =====================================================

// store: {
//   count() -> number of stored periods
//   get(index) -> { index, bytes: ArrayBuffer | Uint8Array, tip } | null
//   put({ index, bytes, tip })
//   deleteFrom(index)   removes that period and every later one
// }
// onProgress({ phase: 'checking' | 'downloading', done, total })
// fetchNew: false only re-checks what is stored (no network).
//
// Resolves to {
//   status: 'ok'          stored chain checked, everything published added
//           'stopped'     signal aborted; what was added is kept
//           'fail'        a downloaded period broke the chain (not stored)
//           'unavailable' no usable manifest (the stored chain still counts)
//           'error'       a download failed (network); try again later
//   periods,              periods stored and checked now
//   tip,                  their end state (encoded), or null
//   published,            periods the site offers (null if unknown)
//   added, discarded,     periods added, stored ones dropped as invalid
//   failure: { height, problem } | null, message
// }
export async function syncHeaderFiles({
  base,
  fetch = globalThis.fetch,
  store,
  params = MAINNET,
  signal = null,
  fetchNew = true,
  onProgress = () => {}
}) {
  const out = { periods: 0, tip: null, published: null, added: 0, discarded: 0, failure: null, message: null };
  const done = (status, extra = {}) => ({ status, ...out, ...extra });

  // 1. What is stored, checked again from the genesis block.
  const storedCount = await store.count();
  let state = null;

  for (let i = 0; i < storedCount; i++) {
    if (signal?.aborted) return done('stopped');

    const rec = await store.get(i);
    const bytes = rec ? new Uint8Array(rec.bytes) : null;
    const r = bytes && bytes.length === PERIOD_BYTES ? checkHeaders(bytes, state, params) : null;

    if (!r?.ok) {
      // Damaged or out of order: drop it and everything after it.
      await store.deleteFrom(i);
      out.discarded = storedCount - i;
      break;
    }

    state = r.state;
    out.periods = i + 1;
    out.tip = encodeState(state);
    onProgress({ phase: 'checking', done: i + 1, total: storedCount });
  }

  if (!fetchNew) return done('ok');

  // 2. How many files the site offers.
  let manifest;
  try {
    const res = await fetch(base + 'manifest.json', { cache: 'no-cache', signal });
    if (!res.ok) {
      return done('unavailable', { message: `the site has no header files (HTTP ${res.status})` });
    }
    manifest = await res.json();
  } catch (err) {
    if (signal?.aborted) return done('stopped');
    return done('unavailable', { message: `couldn't read the list of header files (${err.message})` });
  }

  const published = manifest?.periods;
  if (manifest?.format !== 1 || manifest.network !== 'mainnet' && params === MAINNET ||
      manifest.headerSize !== HEADER_SIZE || manifest.periodLength !== RETARGET_INTERVAL ||
      !Number.isInteger(published) || published < 0 || published > MAX_PERIODS) {
    return done('unavailable', { message: 'the list of header files is not in a format this version understands' });
  }

  out.published = published;

  // 3. Download, check and store each new period, the next one already
  //    on its way while the current one is checked.
  const download = i => fetch(base + periodFile(i), { signal })
    .then(async res => {
      if (!res.ok) throw new Error(`${periodFile(i)}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const first = out.periods;
  let pending = first < published ? download(first) : null;
  pending?.catch(() => {}); // handled when awaited

  for (let i = first; i < published; i++) {
    let bytes;
    try {
      bytes = await pending;
    } catch (err) {
      if (signal?.aborted) return done('stopped');
      return done('error', { message: `download stopped: ${err.message}` });
    }

    pending = i + 1 < published ? download(i + 1) : null;
    pending?.catch(() => {});

    const startHeight = i * RETARGET_INTERVAL;

    if (bytes.length !== PERIOD_BYTES) {
      return done('fail', {
        failure: { height: startHeight, problem: `file ${periodFile(i)} is ${fmt(bytes.length)} bytes, not ${fmt(PERIOD_BYTES)}` }
      });
    }

    const r = checkHeaders(bytes, state, params);

    if (!r.ok) {
      return done('fail', { failure: r.failure });
    }

    state = r.state;
    await store.put({ index: i, bytes: bytes.buffer, tip: encodeState(state) });
    out.periods = i + 1;
    out.tip = encodeState(state);
    out.added++;
    onProgress({ phase: 'downloading', done: i + 1 - first, total: published - first });

    if (signal?.aborted) return done('stopped');
  }

  return done('ok');
}

// =====================================================
// INDEXEDDB (db.js) AS THE STORE
// =====================================================

export const idbStore = {
  count: () => count('periods'),
  get: index => get('periods', index).then(r => r ?? null),
  put: rec => put('periods', rec),
  deleteFrom: index => deleteFrom('periods', index)
};

// What is stored, from the last record, without re-checking it (for
// display; every sync re-checks). { periods, tip (decoded) } or null.
export async function storedSummary(store = idbStore) {
  const n = await store.count();
  if (!n) return null;
  const last = await store.get(n - 1);
  return last ? { periods: n, tip: decodeState(last.tip) } : null;
}

// =====================================================
// RUNNING A SYNC
// =====================================================

// Runs `fn` while holding a lock no other tab holds (Web Locks), or
// resolves to { status: 'busy' } without running it. Runs it anyway where
// the browser has no Web Locks.
export function withSyncLock(fn) {
  const locks = globalThis.navigator?.locks;
  return locks
    ? locks.request('assay-header-sync', { ifAvailable: true }, lock => (lock ? fn() : { status: 'busy' }))
    : fn();
}

// Starts a sync of the site's header files into IndexedDB, in a Worker
// (headerworker.js) or, where module workers can't start, on this thread.
// Returns { promise (resolves to the result), stop() }.
export function startHeaderSync({ onProgress = () => {}, fetchNew = true } = {}) {
  const base = new URL(HEADERS_PATH, document.baseURI).href;
  let stop = () => {};

  const promise = new Promise(resolve => {
    const here = () => {
      const controller = new AbortController();
      stop = () => controller.abort();
      withSyncLock(() => syncHeaderFiles({ base, store: idbStore, signal: controller.signal, fetchNew, onProgress }))
        .then(resolve, err => resolve({ status: 'error', message: err?.message || String(err) }));
    };

    let worker = null;
    try {
      worker = new Worker(new URL('./headerworker.js', import.meta.url), { type: 'module' });
    } catch {
      here();
      return;
    }

    let heard = false;

    worker.onmessage = e => {
      heard = true;
      if (e.data.type === 'progress') {
        const { type, ...p } = e.data;
        onProgress(p);
      } else if (e.data.type === 'done') {
        worker.terminate();
        resolve(e.data.result);
      }
    };

    // The worker couldn't start (no module workers): run here instead.
    worker.onerror = e => {
      e.preventDefault?.();
      worker.terminate();
      if (heard) resolve({ status: 'error', message: e.message || 'the background check stopped' });
      else here();
    };

    stop = () => worker.postMessage({ type: 'stop' });
    worker.postMessage({ type: 'sync', base, fetchNew });
  });

  return { promise, stop: () => stop() };
}

// =====================================================
// THE RESULT, FOR <verify-badge>
// =====================================================

// sync:    a syncHeaderFiles result (or { status: 'busy' })
// answers: api.js getBlockHashFromEach(tip height), or null if not asked
// Returns a verify.js-style result: { state, title, checks, facts, note }.
export function headerChainResult(sync, answers = null) {
  const tip = sync.tip ? decodeState(sync.tip) : null;
  const periods = sync.periods ?? 0;
  const result = (state, title, checks = [], facts = [], note) => ({ state, title, checks, facts, note });

  if (sync.status === 'busy') {
    return result('error', 'Another Assay tab is updating the header chain', [], [], 'Check again once it has finished.');
  }

  const chainChecks = periods ? [
    {
      label: `${fmt(periods * RETARGET_INTERVAL)} headers link one to the next, from the genesis block to block ${fmt(tip.height)}`,
      ok: true
    },
    {
      label: "Each has valid proof of work, and the difficulty, timestamp and version Bitcoin's rules require",
      ok: true
    }
  ] : [];

  if (sync.status === 'fail') {
    const f = sync.failure;
    return result('fail', `Header files FAILED the check at block ${fmt(f.height)}`,
      [...chainChecks, { label: `Block ${fmt(f.height)} ${f.problem}`, ok: false }],
      [{ label: 'Kept', value: periods ? `blocks 0–${fmt(tip.height)}, checked` : 'nothing' }],
      'Nothing from the failing file onward was stored. The next check will try again.');
  }

  if (!periods) {
    if (sync.discarded) {
      return result('fail', 'Stored header chain FAILED the re-check and was deleted', [], [],
        'It is downloaded and checked again with the next check for new headers.');
    }
    if (sync.status === 'ok' && sync.published === 0) {
      return result('na', 'The site has no header files yet');
    }
    if (sync.status === 'stopped') {
      return result('na', 'Stopped before any headers were stored');
    }
    return result('error', "Couldn't download the header files", [], [], sync.message ? `Reason: ${sync.message}.` : undefined);
  }

  const checks = [...chainChecks];
  let state = 'ok';

  // Do the providers have the last stored block at that height?
  if (answers) {
    const h = fmt(tip.height);
    const differing = answers.filter(a => a.ok && a.hash !== tip.hash);
    const agreeing = answers.filter(a => a.ok && a.hash === tip.hash);

    if (differing.length) {
      checks.push({
        label: `${differing.map(a => a.name).join(', ')} ${differing.length === 1 ? 'has' : 'have'} a different block at height ${h}`,
        ok: false
      });
      state = 'fail';
    } else if (agreeing.length) {
      checks.push({ label: `${agreeing.length} of ${answers.length} providers have block ${h} at that height`, ok: true });
    }
  }

  const facts = [
    { label: 'Stored', value: `${fmt(periods)} difficulty periods, ${(periods * PERIOD_BYTES / 1e6).toFixed(1)} MB` },
    { label: 'Total work', value: `2^${log2(tip.work).toFixed(2)} hashes` },
    { label: 'chainwork', value: chainWorkHex(tip.work) }
  ];

  if (sync.published !== null && sync.published !== undefined && sync.published > periods) {
    facts.push({ label: 'Still to download', value: `${fmt(sync.published - periods)} periods` });
  }

  if (sync.discarded) {
    facts.push({ label: 'Repaired', value: `${fmt(sync.discarded)} stored periods failed the re-check and were dropped` });
  }

  if (sync.status === 'stopped') facts.push({ label: 'Update', value: 'stopped; resumes next time' });
  if (sync.status === 'error' || sync.status === 'unavailable') facts.push({ label: 'Update', value: sync.message });

  return result(state,
    state === 'ok'
      ? `Header chain checked from the genesis block to block ${fmt(tip.height)}`
      : 'Header chain check FAILED',
    checks, facts,
    "Covers finished difficulty periods only, so the newest blocks (up to about two weeks) aren't included. " +
    "Block and transaction pages don't use these headers for their checks yet.");
}

// =====================================================
// OPT-IN (per browser)
// =====================================================

const OPT_IN_KEY = 'assay_header_chain';
const LAST_SYNC_KEY = 'assay_header_chain_synced';

export function headerChainOptedIn() {
  try { return localStorage.getItem(OPT_IN_KEY) === '1'; } catch { return false; }
}

export function setHeaderChainOptIn(on) {
  try {
    if (on) localStorage.setItem(OPT_IN_KEY, '1');
    else { localStorage.removeItem(OPT_IN_KEY); localStorage.removeItem(LAST_SYNC_KEY); }
  } catch { /* private mode: works for this visit only */ }
}

// When a sync last finished checking everything published (ms), or 0.
export function lastFullSync() {
  try { return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch { return 0; }
}

export function markFullSync(at = Date.now()) {
  try { localStorage.setItem(LAST_SYNC_KEY, String(at)); } catch { /* ignore */ }
}

// Periods the site should offer for a chain tip at `tipHeight`: those
// ending at least 100 blocks below it (tools/headers). For the download
// size shown before opting in.
export function expectedPeriods(tipHeight) {
  return Math.max(0, Math.floor((tipHeight - 100 + 1) / RETARGET_INTERVAL));
}
