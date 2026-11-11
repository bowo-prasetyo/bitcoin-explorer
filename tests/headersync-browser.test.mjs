import test from 'node:test';
import assert from 'node:assert/strict';

import {
  syncHeaderFiles,
  headerChainResult,
  storedSummary,
  expectedPeriods,
  encodeState,
  decodeState,
  periodFile,
  PERIOD_BYTES
} from '../headersync.js';
import { checkHeaders } from '../headerchain.js';
import { RETARGET_INTERVAL } from '../difficulty.js';
import { mineChain, hashAt, paramsFor } from './mined-chain.mjs';

const PERIODS = 3;
const CHAIN = mineChain(PERIODS * RETARGET_INTERVAL);
const PARAMS = paramsFor(CHAIN);
const BASE = 'https://site.example/bitcoin-explorer/headers/';
const period = i => CHAIN.slice(i * PERIOD_BYTES, (i + 1) * PERIOD_BYTES);
const stateAfter = n => checkHeaders(CHAIN.subarray(0, n * PERIOD_BYTES), null, PARAMS).state;

const MANIFEST = { format: 1, network: 'test', headerSize: 80, periodLength: 2016, periods: PERIODS };

// The site, serving the manifest and period files; `files` can override.
function site({ manifest = MANIFEST, files = {}, manifestStatus = 200, failAt = null } = {}) {
  const requests = [];
  const fetch = async (url, opts = {}) => {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const path = url.slice(BASE.length);
    requests.push(path);
    if (path === 'manifest.json') {
      return manifestStatus === 200 ? Response.json(manifest) : new Response('no', { status: manifestStatus });
    }
    const m = path.match(/^periods\/(\d{5})\.bin$/);
    if (!m) return new Response('no', { status: 404 });
    const i = Number(m[1]);
    if (i === failAt) throw new TypeError('network down');
    if (i in files) return new Response(files[i]);
    if (i >= PERIODS) return new Response('no', { status: 404 });
    return new Response(period(i));
  };
  return { fetch, requests };
}

function memoryStore(initial = []) {
  const recs = new Map(initial.map(r => [r.index, r]));
  return {
    recs,
    async count() { return recs.size; },
    async get(i) { return recs.get(i) ?? null; },
    async put(rec) { recs.set(rec.index, { ...rec, bytes: rec.bytes.slice(0) }); },
    async deleteFrom(i) { for (const k of [...recs.keys()]) if (k >= i) recs.delete(k); }
  };
}

const storedUpTo = n => Array.from({ length: n }, (_, i) => ({
  index: i, bytes: period(i).buffer, tip: encodeState(stateAfter(i + 1))
}));

const sync = (s, store, extra = {}) => syncHeaderFiles({ base: BASE, fetch: s.fetch, store, params: PARAMS, ...extra });

// ---------------------------------------------------------------

test('first sync: downloads every published period, checks and stores it', async () => {
  const s = site();
  const store = memoryStore();
  const progress = [];
  const r = await sync(s, store, { onProgress: p => progress.push(p) });

  assert.equal(r.status, 'ok');
  assert.equal(r.periods, PERIODS);
  assert.equal(r.added, PERIODS);
  assert.equal(r.published, PERIODS);
  assert.deepEqual(decodeState(r.tip), stateAfter(PERIODS));
  assert.equal(r.tip.hash, hashAt(CHAIN, PERIODS * RETARGET_INTERVAL - 1));

  for (let i = 0; i < PERIODS; i++) {
    assert.deepEqual(new Uint8Array(store.recs.get(i).bytes), period(i));
    assert.deepEqual(decodeState(store.recs.get(i).tip), stateAfter(i + 1));
  }
  assert.deepEqual(s.requests, ['manifest.json', periodFile(0), periodFile(1), periodFile(2)]);
  assert.deepEqual(progress.map(p => `${p.phase} ${p.done}/${p.total}`),
    ['downloading 1/3', 'downloading 2/3', 'downloading 3/3']);
});

test('resume: re-checks what is stored, downloads only the rest', async () => {
  const s = site();
  const store = memoryStore(storedUpTo(1));
  const progress = [];
  const r = await sync(s, store, { onProgress: p => progress.push(p) });

  assert.equal(r.status, 'ok');
  assert.equal(r.added, 2);
  assert.deepEqual(s.requests, ['manifest.json', periodFile(1), periodFile(2)]);
  assert.equal(progress[0].phase, 'checking');
});

test('up to date: only the manifest is fetched', async () => {
  const s = site();
  const r = await sync(s, memoryStore(storedUpTo(3)));
  assert.equal(r.status, 'ok');
  assert.equal(r.added, 0);
  assert.deepEqual(s.requests, ['manifest.json']);
});

test('a damaged stored period is dropped with everything after it, then downloaded again', async () => {
  const recs = storedUpTo(3);
  const bad = new Uint8Array(recs[1].bytes.slice(0));
  bad[1000] ^= 1;
  recs[1] = { ...recs[1], bytes: bad.buffer };

  const s = site();
  const store = memoryStore(recs);
  const r = await sync(s, store);
  assert.equal(r.status, 'ok');
  assert.equal(r.discarded, 2);
  assert.equal(r.added, 2);
  assert.deepEqual(new Uint8Array(store.recs.get(1).bytes), period(1));
});

test('a published period that breaks the chain is not stored, nor anything after', async () => {
  const tampered = period(1);
  tampered[80 * 500 + 76] ^= 0xff; // a nonce: that header's work no longer checks out
  const s = site({ files: { 1: tampered } });
  const store = memoryStore();
  const r = await sync(s, store);

  assert.equal(r.status, 'fail');
  assert.equal(r.periods, 1);
  assert.ok(r.failure.height === 2016 + 500 || r.failure.height === 2016 + 501, JSON.stringify(r.failure));
  assert.deepEqual([...store.recs.keys()], [0]);

  const shown = headerChainResult(r);
  assert.equal(shown.state, 'fail');
  assert.match(shown.title, /^Header files FAILED the check at block 2,51[67]$/);
  assert.ok(shown.checks.some(c => !c.ok));
});

test('a file of the wrong size fails', async () => {
  const s = site({ files: { 0: period(0).slice(0, PERIOD_BYTES - 80) } });
  const r = await sync(s, memoryStore());
  assert.equal(r.status, 'fail');
  assert.equal(r.failure.height, 0);
  assert.match(r.failure.problem, /is 161,200 bytes, not 161,280/);
});

test('the manifest is not trusted beyond the number of files', async () => {
  // Fewer than stored: what is stored stays.
  const fewer = await sync(site({ manifest: { ...MANIFEST, periods: 1 } }), memoryStore(storedUpTo(2)));
  assert.equal(fewer.status, 'ok');
  assert.equal(fewer.periods, 2);

  // An absurd count, an unknown format, mainnet expected but not offered.
  for (const manifest of [{ ...MANIFEST, periods: 1e9 }, { ...MANIFEST, format: 2 }, { ...MANIFEST, periods: -1 }]) {
    const r = await sync(site({ manifest }), memoryStore());
    assert.equal(r.status, 'unavailable', JSON.stringify(manifest));
  }
  const mainnet = await syncHeaderFiles({ base: BASE, fetch: site().fetch, store: memoryStore() });
  assert.equal(mainnet.status, 'unavailable');
});

test('no header files on the site: unavailable, and the stored chain still counts', async () => {
  const r = await sync(site({ manifestStatus: 404 }), memoryStore(storedUpTo(2)));
  assert.equal(r.status, 'unavailable');
  assert.equal(r.periods, 2);
  assert.match(r.message, /HTTP 404/);

  const shown = headerChainResult(r);
  assert.equal(shown.state, 'ok');
  assert.ok(shown.facts.some(f => f.label === 'Update' && /HTTP 404/.test(f.value)));

  const none = headerChainResult(await sync(site({ manifestStatus: 404 }), memoryStore()));
  assert.equal(none.state, 'error');
  assert.equal(none.title, "Couldn't download the header files");
});

test('a download that fails midway keeps what was added', async () => {
  const store = memoryStore();
  const r = await sync(site({ failAt: 2 }), store);
  assert.equal(r.status, 'error');
  assert.equal(r.periods, 2);
  assert.match(r.message, /network down/);
  assert.equal(store.recs.size, 2);
});

test('stopping keeps what was added; the next sync resumes', async () => {
  const controller = new AbortController();
  const store = memoryStore();
  const r = await sync(site(), store, {
    signal: controller.signal,
    onProgress: p => { if (p.done === 1) controller.abort(); }
  });
  assert.equal(r.status, 'stopped');
  assert.equal(store.recs.size, 1);

  const s = site();
  const again = await sync(s, store);
  assert.equal(again.status, 'ok');
  assert.deepEqual(s.requests, ['manifest.json', periodFile(1), periodFile(2)]);
});

test('storedSummary reads the last record', async () => {
  assert.equal(await storedSummary(memoryStore()), null);
  const sum = await storedSummary(memoryStore(storedUpTo(2)));
  assert.equal(sum.periods, 2);
  assert.deepEqual(sum.tip, stateAfter(2));
});

test('result: providers agreeing, or one with a different block', async () => {
  const r = await sync(site(), memoryStore());
  const h = r.tip.height;
  const tipHash = r.tip.hash;

  const ok = headerChainResult(r, [
    { name: 'Blockstream', ok: true, hash: tipHash },
    { name: 'mempool.space', ok: true, hash: tipHash }
  ]);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.title, `Header chain checked from the genesis block to block ${h.toLocaleString('en-US')}`);
  assert.deepEqual(ok.checks.map(c => c.ok), [true, true, true]);
  assert.match(ok.checks[0].label, /^6,048 headers link one to the next, from the genesis block to block 6,047$/);
  assert.match(ok.checks[2].label, /^2 of 2 providers have block 6,047 at that height$/);
  assert.ok(ok.facts.some(f => f.label === 'chainwork' && /^[0-9a-f]{64}$/.test(f.value)));

  const bad = headerChainResult(r, [
    { name: 'Blockstream', ok: true, hash: tipHash },
    { name: 'mempool.space', ok: true, hash: 'ff'.repeat(32) }
  ]);
  assert.equal(bad.state, 'fail');
  assert.equal(bad.title, 'Header chain check FAILED');
  assert.ok(bad.checks.some(c => !c.ok && c.label === 'mempool.space has a different block at height 6,047'));

  // No provider answered: no provider check, still ok.
  const quiet = headerChainResult(r, [{ name: 'Blockstream', ok: false, error: 'x' }]);
  assert.equal(quiet.state, 'ok');
  assert.equal(quiet.checks.length, 2);
});

test('result: other states', () => {
  assert.equal(headerChainResult({ status: 'busy' }).title, 'Another Assay tab is updating the header chain');
  assert.equal(headerChainResult({ status: 'stopped', periods: 0, tip: null }).state, 'na');
});

test('expected periods for a tip: those 100+ blocks deep', () => {
  assert.equal(expectedPeriods(2014), 0);
  assert.equal(expectedPeriods(2115), 1);   // block 2,015 is exactly 100 deep
  assert.equal(expectedPeriods(2114), 0);
  assert.equal(expectedPeriods(975000), 483);
});

test('fetchNew false: re-checks what is stored, no network', async () => {
  const s = site();
  const r = await sync(s, memoryStore(storedUpTo(2)), { fetchNew: false });
  assert.equal(r.status, 'ok');
  assert.equal(r.periods, 2);
  assert.equal(r.published, null);
  assert.deepEqual(s.requests, []);
  assert.equal(headerChainResult(r).state, 'ok');
});

test('a stored chain that fails the re-check from its first period: deleted and reported', async () => {
  const junk = new Uint8Array(PERIOD_BYTES).fill(7);
  const store = memoryStore([{ index: 0, bytes: junk.buffer, tip: encodeState(stateAfter(1)) }, ...storedUpTo(2).slice(1)]);
  const r = await sync(site(), store, { fetchNew: false });
  assert.equal(r.periods, 0);
  assert.equal(r.discarded, 2);
  assert.equal(store.recs.size, 0);
  const shown = headerChainResult(r);
  assert.equal(shown.state, 'fail');
  assert.equal(shown.title, 'Stored header chain FAILED the re-check and was deleted');
});
