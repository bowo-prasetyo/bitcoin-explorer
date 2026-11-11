import test from 'node:test';
import assert from 'node:assert/strict';

import {
  syncPeriods,
  verifyStored,
  makeClient,
  fetchPeriod,
  periodFile,
  decodeState,
  PERIOD_BYTES,
  MANIFEST
} from '../tools/headers/sync.mjs';
import { checkHeaders } from '../headerchain.js';
import { parseHeaderBytes } from '../spv.js';
import { RETARGET_INTERVAL } from '../difficulty.js';
import { mineChain, hashAt, paramsFor } from './mined-chain.mjs';

// ---------------------------------------------------------------
// A test chain: mined at regtest's easy limit, retargets included
// ---------------------------------------------------------------

const LENGTH = 3 * RETARGET_INTERVAL + 300; // three full periods and a bit

const CHAIN = mineChain(LENGTH);
const HASHES = Array.from({ length: LENGTH }, (_, h) => hashAt(CHAIN, h));
const PARAMS = paramsFor(CHAIN);

// Esplora's block JSON, as /blocks/:height returns it.
function blockJson(h) {
  const f = parseHeaderBytes(CHAIN, h * 80);
  return {
    id: HASHES[h],
    height: h,
    version: f.version,
    timestamp: f.timestamp,
    bits: f.bits,
    nonce: f.nonce,
    merkle_root: f.merkleRoot,
    previousblockhash: h === 0 ? null : f.previousBlockHash
  };
}

const A = 'https://a.example/api';
const B = 'https://b.example/api';

// Mock providers serving the chain up to `tip`. `tamper(base, block)` can
// change a block's JSON; `down` lists providers that refuse everything;
// `hashAtHeight(base, h)` can override /block-height answers.
function providers({ tip = LENGTH - 1, tips = {}, tamper = (base, b) => b, down = [], hashAtHeight = null } = {}) {
  const calls = [];
  const fetch = async url => {
    const base = [A, B].find(b => url.startsWith(b));
    const path = url.slice(base.length);
    calls.push({ base, path });
    if (down.includes(base)) return new Response('unavailable', { status: 503 });

    const top = tips[base] ?? tip;
    let m;
    if (path === '/blocks/tip/height') return new Response(String(top));
    if ((m = path.match(/^\/blocks\/(\d+)$/))) {
      const from = Math.min(Number(m[1]), top);
      const out = [];
      for (let h = from; h > from - 10 && h >= 0; h--) out.push(tamper(base, blockJson(h)));
      return Response.json(out);
    }
    if ((m = path.match(/^\/block-height\/(\d+)$/))) {
      const h = Number(m[1]);
      if (h > top) return new Response('Block not found', { status: 404 });
      return new Response(hashAtHeight?.(base, h) ?? HASHES[h]);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

function memoryStore() {
  const files = new Map();
  return {
    files,
    async read(path) { return files.get(path) ?? null; },
    async write(path, bytes) { files.set(path, new Uint8Array(bytes)); }
  };
}

const quickClient = fetch => makeClient({ fetch, delayMs: 0, retries: 1, sleep: async () => {} });

const sync = (store, mock, opts = {}) => syncPeriods({
  store,
  client: quickClient(mock.fetch),
  providers: [A, B],
  params: PARAMS,
  network: 'test',
  ...opts
});

// ---------------------------------------------------------------

test('test chain is valid by the header rules', () => {
  assert.equal(checkHeaders(CHAIN, null, PARAMS).ok, true);
});

test('from nothing: adds every finished period, splits requests across providers', async () => {
  const store = memoryStore();
  const mock = providers(); // tip 6,347: periods end 2,015, 4,031, 6,047 (all ≥ 100 deep)
  const r = await sync(store, mock);

  assert.equal(r.status, 'up-to-date');
  assert.equal(r.periods, 3);
  assert.equal(r.added, 3);

  for (let i = 0; i < 3; i++) {
    const want = CHAIN.subarray(i * PERIOD_BYTES, (i + 1) * PERIOD_BYTES);
    assert.deepEqual(store.files.get(periodFile(i)), want, `period ${i}`);
  }

  const manifest = JSON.parse(new TextDecoder().decode(store.files.get(MANIFEST)));
  assert.equal(manifest.periods, 3);
  assert.equal(manifest.network, 'test');
  assert.equal(manifest.tip.height, 3 * RETARGET_INTERVAL - 1);
  assert.equal(manifest.tip.hash, HASHES[3 * RETARGET_INTERVAL - 1]);
  assert.equal(decodeState(manifest.tip).work, checkHeaders(CHAIN.subarray(0, 3 * PERIOD_BYTES), null, PARAMS).state.work);

  // 202 page requests per period, about half to each provider.
  const pages = mock.calls.filter(c => c.path.startsWith('/blocks/') && c.path !== '/blocks/tip/height');
  assert.equal(pages.length, 3 * 202);
  const fromA = pages.filter(c => c.base === A).length;
  assert.ok(Math.abs(fromA - pages.length / 2) <= 3, `A served ${fromA} of ${pages.length}`);
});

test('a period is only added once its last block is 100 blocks below every tip', async () => {
  const store = memoryStore();
  // B lags: its tip 4,130 puts block 4,031 99 blocks deep, so only period 0.
  const r = await sync(store, providers({ tips: { [B]: 4130 } }));
  assert.equal(r.status, 'up-to-date');
  assert.equal(r.periods, 1);
  assert.equal(r.tipHeight, 4130);
});

test('resumes where it stopped, re-checking what is stored', async () => {
  const store = memoryStore();
  const first = await sync(store, providers(), { maxPeriods: 1 });
  assert.equal(first.status, 'more');
  assert.equal(first.periods, 1);

  const mock = providers();
  const second = await sync(store, mock);
  assert.equal(second.status, 'up-to-date');
  assert.equal(second.periods, 3);
  assert.equal(second.added, 2);
  // No request for period 0 again.
  assert.ok(!mock.calls.some(c => c.path === `/blocks/${RETARGET_INTERVAL - 1}`));
});

test('stops at the deadline with more to do', async () => {
  const store = memoryStore();
  let t = 0;
  const r = await sync(store, providers(), { now: () => t++ , deadline: 1 });
  assert.equal(r.status, 'more');
  assert.equal(r.added, 1);
});

test('up to date: nothing fetched but the tips', async () => {
  const store = memoryStore();
  await sync(store, providers());
  const mock = providers();
  const r = await sync(store, mock);
  assert.equal(r.status, 'up-to-date');
  assert.equal(r.added, 0);
  assert.deepEqual(mock.calls.map(c => c.path), ['/blocks/tip/height', '/blocks/tip/height']);
});

test('one provider sending a bad block: the copy from the other is used', async () => {
  const store = memoryStore();
  const logs = [];
  const mock = providers({
    tamper: (base, b) => (base === A && b.height >= 1000 && b.height < 1100 ? { ...b, nonce: b.nonce + 1 } : b)
  });
  const r = await sync(store, mock, { log: m => logs.push(m) });
  assert.equal(r.periods, 3);
  assert.deepEqual(store.files.get(periodFile(0)), CHAIN.subarray(0, PERIOD_BYTES));
  // A alone fails where its altered block 1,000 no longer matches what
  // block 1,001 points to; B's copy is the one stored.
  assert.ok(logs.some(l => l === `  ${A}: block 1,001 doesn't build on block 1,000`), logs.join('\n'));
  assert.ok(logs.some(l => /used the copy that passed/.test(l)));
});

test('every provider sending a bad block: fails, and nothing is written for that period', async () => {
  const store = memoryStore();
  const mock = providers({ tamper: (base, b) => (b.height === 3000 ? { ...b, bits: 0x207ffffe } : b) });
  await assert.rejects(sync(store, mock), /Period 1 \(blocks 2,016–4,031\) fails from every provider: block 3,000 difficulty differs/);
  assert.ok(store.files.has(periodFile(0)));
  assert.ok(!store.files.has(periodFile(1)));
  const manifest = JSON.parse(new TextDecoder().decode(store.files.get(MANIFEST)));
  assert.equal(manifest.periods, 1);
});

test("a provider with a different block at a period's end: fails", async () => {
  const store = memoryStore();
  const mock = providers({ hashAtHeight: (base, h) => (base === B && h === RETARGET_INTERVAL - 1 ? 'ff'.repeat(32) : null) });
  await assert.rejects(sync(store, mock), new RegExp(`${B} has a different block at height 2,015`));
  assert.equal(store.files.size, 0);
});

test('one provider down: nothing is added (two must agree)', async () => {
  const store = memoryStore();
  const r = await sync(store, providers({ down: [B] }));
  assert.equal(r.status, 'unavailable');
  assert.equal(store.files.size, 0);
});

test('with a single configured provider, its answer is enough', async () => {
  const store = memoryStore();
  const mock = providers();
  const r = await syncPeriods({ store, client: quickClient(mock.fetch), providers: [A], params: PARAMS });
  assert.equal(r.periods, 3);
});

test('damaged stored data is caught before anything is added', async () => {
  const store = memoryStore();
  await sync(store, providers());

  const bad = new Uint8Array(store.files.get(periodFile(1)));
  bad[500] ^= 1;
  store.files.set(periodFile(1), bad);
  await assert.rejects(verifyStored(store, PARAMS), /Stored periods\/00001\.bin fails/);

  store.files.set(periodFile(1), CHAIN.slice(PERIOD_BYTES, 2 * PERIOD_BYTES - 80));
  await assert.rejects(verifyStored(store, PARAMS), /not 161,280 bytes/);

  store.files.set(periodFile(1), CHAIN.slice(PERIOD_BYTES, 2 * PERIOD_BYTES));
  const m = JSON.parse(new TextDecoder().decode(store.files.get(MANIFEST)));
  store.files.set(MANIFEST, new TextEncoder().encode(JSON.stringify({ ...m, periods: 2 })));
  await assert.rejects(verifyStored(store, PARAMS), /doesn't match the stored periods/);
});

test('fetchPeriod: pages of 10, newest first, and a gap is an error', async () => {
  const mock = providers();
  const client = quickClient(mock.fetch);
  const bytes = await fetchPeriod(client, RETARGET_INTERVAL, [A]);
  assert.deepEqual(bytes, CHAIN.subarray(PERIOD_BYTES, 2 * PERIOD_BYTES));
  assert.equal(mock.calls[0].path, `/blocks/${2 * RETARGET_INTERVAL - 1}`);

  const gap = providers({ tamper: (base, b) => (b.height === 2010 ? { ...b, height: 'x' } : b) });
  await assert.rejects(fetchPeriod(quickClient(gap.fetch), 0, [A]), /No provider returned block 2,010/);
});

test('client: retries network errors and 5xx after 1, 2, 4, 8 s; not 404', async () => {
  let n = 0;
  const waits = [];
  const fetch = async () => (++n < 3 ? new Response('busy', { status: 503 }) : new Response(' 42 '));
  const client = makeClient({ fetch, delayMs: 0, sleep: async ms => waits.push(ms) });
  assert.equal(await client.text(A, '/x'), '42');
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(client.requests, 3);

  const down = makeClient({ fetch: async () => new Response('x', { status: 500 }), delayMs: 0, sleep: async () => {} });
  await assert.rejects(down.text(A, '/x'), /HTTP 500/);
  assert.equal(down.requests, 5); // 1 + 4 retries

  const missing = makeClient({ fetch: async () => new Response('no', { status: 404 }), delayMs: 0, sleep: async () => {} });
  await assert.rejects(missing.text(A, '/x'), /HTTP 404/);
  assert.equal(missing.requests, 1);
});

// A clock that only moves when the client sleeps.
function fakeTime() {
  let t = 0;
  const waits = [];
  return { now: () => t, sleep: async ms => { waits.push(ms); t += ms; }, waits };
}

test('client: one request per second per provider by default', async () => {
  const time = fakeTime();
  const client = makeClient({ fetch: async () => new Response('1'), ...time });
  await client.text(A, '/a');
  await client.text(A, '/b');
  await client.text(B, '/c'); // another provider: no wait
  await client.text(A, '/d');
  assert.deepEqual(time.waits, [1000, 1000]);
});

test('client: a rate limit slows that provider down, waits, and eases back', async () => {
  const time = fakeTime();
  const logs = [];
  let n = 0;
  const fetch = async () => (++n <= 2 ? new Response('slow down', { status: 429 }) : new Response('ok'));
  const client = makeClient({ fetch, ...time, log: m => logs.push(m) });

  assert.equal(await client.text(A, '/x'), 'ok');
  // Back-off 5 s, then 10 s; spacing doubled twice (1 -> 2 -> 4 s), then
  // eased 5 % by the success.
  assert.ok(time.waits.includes(5000) && time.waits.includes(10000), time.waits.join(','));
  assert.equal(client.spacing(A), 3800);
  assert.equal(client.spacing(B), 1000);
  assert.match(logs[0], /^rate limited by https:\/\/a\.example\/api: waiting 5 s, then one request every 2\.0 s$/);

  // Successes bring it back towards one a second, never below.
  for (let i = 0; i < 100; i++) await client.text(A, '/y');
  assert.equal(client.spacing(A), 1000);
});

test('client: Retry-After is honoured', async () => {
  const time = fakeTime();
  let n = 0;
  const fetch = async () => (++n === 1
    ? new Response('later', { status: 429, headers: { 'retry-after': '42' } })
    : new Response('ok'));
  const client = makeClient({ fetch, ...time });
  await client.text(A, '/x');
  assert.ok(time.waits.includes(42000), time.waits.join(','));
});

test('client: gives up after 8 rate limits in a row', async () => {
  const time = fakeTime();
  const client = makeClient({ fetch: async () => new Response('no', { status: 429 }), ...time });
  await assert.rejects(client.text(A, '/x'), /HTTP 429 \(rate limited 8 times in a row\)/);
  assert.equal(client.requests, 9);
  // 5, 10, 20, 40, 80, 120, 120, 120 s of back-off: minutes, not seconds.
  const backoff = time.waits.filter(w => w >= 5000 && w % 5000 === 0);
  assert.ok(backoff.reduce((a, b) => a + b, 0) >= 500_000, backoff.join(','));
  assert.equal(client.spacing(A), 30000);
});
