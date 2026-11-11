import test from 'node:test';
import assert from 'node:assert/strict';

import { checkHeaders, MAINNET, HEADER_SIZE } from '../headerchain.js';
import { doubleSha256 } from '../sha256.js';
import { parseHeader, parseHeaderBytes, targetFromBits } from '../spv.js';
import { nextBits, RETARGET_INTERVAL, TARGET_TIMESPAN } from '../difficulty.js';
import { workForBits } from '../chainwork.js';

const fromHex = h => new Uint8Array(Buffer.from(h, 'hex'));
const toHex = b => Buffer.from(b).toString('hex');
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---------------------------------------------------------------
// Real mainnet headers
// ---------------------------------------------------------------

const GENESIS_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
  '4b1e5e4a29ab5f49ffff001d1dac2b7c';
const B1_HEADER =
  '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d61900' +
  '00000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e8' +
  '57233e0e61bc6649ffff001d01e36299';
const B1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048';
const BLOCK_100000_HEADER =
  '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200' +
  '000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac' +
  '4247e9f337221b4d4c86041b0f2b5710';

test('parseHeaderBytes reads the same fields as parseHeader', () => {
  for (const h of [GENESIS_HEADER, B1_HEADER, BLOCK_100000_HEADER]) {
    assert.deepEqual(parseHeaderBytes(fromHex(h)), parseHeader(h));
  }
  // At an offset inside a longer buffer.
  const two = fromHex(GENESIS_HEADER + B1_HEADER);
  assert.deepEqual(parseHeaderBytes(two, 80), parseHeader(B1_HEADER));
  assert.throws(() => parseHeaderBytes(two, 81), /80 bytes/);
});

test('mainnet genesis and block 1 pass, with chainwork equal to Core’s', () => {
  const r = checkHeaders(fromHex(GENESIS_HEADER + B1_HEADER));
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
  assert.equal(r.state.height, 1);
  assert.equal(r.state.hash, B1_HASH);
  // bitcoin-cli getblockheader <block 1>: chainwork 0x200020002
  assert.equal(r.state.work, 0x200020002n);
});

test('resuming from a saved state gives the same result as one run', () => {
  const g = checkHeaders(fromHex(GENESIS_HEADER));
  assert.equal(g.ok, true);
  const r = checkHeaders(fromHex(B1_HEADER), g.state);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, checkHeaders(fromHex(GENESIS_HEADER + B1_HEADER)).state);
});

test('a chain must start at the genesis block', () => {
  const r = checkHeaders(fromHex(B1_HEADER));
  assert.equal(r.ok, false);
  assert.deepEqual(r.failure, { height: 0, problem: 'is not the genesis block' });
  assert.equal(r.checked, 0);
  assert.equal(r.state, null);
});

test('a header that does not follow the one before fails, keeping the valid prefix', () => {
  // Block 100,000 is a real header with valid work, but not block 1.
  const r = checkHeaders(fromHex(GENESIS_HEADER + BLOCK_100000_HEADER));
  assert.equal(r.ok, false);
  assert.equal(r.checked, 1);
  assert.equal(r.failure.height, 1);
  assert.match(r.failure.problem, /doesn't build on block 0/);
  assert.equal(r.state.height, 0);
});

test('input must be whole 80-byte headers', () => {
  assert.throws(() => checkHeaders(new Uint8Array(81)), /80-byte/);
  assert.throws(() => checkHeaders('00'.repeat(80)), /80-byte/);
  assert.equal(checkHeaders(new Uint8Array(0)).ok, true);
});

// ---------------------------------------------------------------
// Mined test chains (regtest's easy proof-of-work limit)
// ---------------------------------------------------------------

const EASY_BITS = 0x207fffff; // regtest: about every other hash qualifies
const REGTEST = {
  powLimit: targetFromBits(EASY_BITS),
  genesisHash: null, // set below
  minVersions: [[5, 2]]
};

function le32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

// A header with valid work (or, with `invalidWork`, without).
function mine({ version = 2, prev, time, bits, invalidWork = false }) {
  const target = targetFromBits(bits);
  const merkle = new Uint8Array(32).fill(0xab);
  for (let nonce = 0; ; nonce++) {
    const header = concat(le32(version), prev, merkle, le32(time), le32(bits), le32(nonce));
    const hash = doubleSha256(header);
    const value = BigInt('0x' + toHex(hash.slice().reverse()));
    if ((value <= target) !== invalidWork) return { header, hash };
  }
}

// `n` linked headers after (prevHash, time), each `spacing` s apart.
function extend(prevHash, time, n, { bits = EASY_BITS, spacing = 600, version = 2 } = {}) {
  const out = [];
  let prev = prevHash;
  for (let i = 0; i < n; i++) {
    time += spacing;
    const { header, hash } = mine({ version, prev, time, bits });
    out.push(header);
    prev = hash;
  }
  return { bytes: concat(...out), lastHash: prev, lastTime: time };
}

const T0 = 1_700_000_000;
const genesis = mine({ version: 1, prev: new Uint8Array(32), time: T0, bits: EASY_BITS });
REGTEST.genesisHash = toHex(genesis.hash.slice().reverse());

test('a mined test chain from its genesis block passes', () => {
  const rest = extend(genesis.hash, T0, 30);
  const r = checkHeaders(concat(genesis.header, rest.bytes), null, REGTEST);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 31);
  assert.equal(r.state.height, 30);
  assert.equal(r.state.work, 31n * workForBits(EASY_BITS));
  assert.equal(r.state.recentTimestamps.length, 11);
});

test('a header without valid proof of work fails', () => {
  const ok = extend(genesis.hash, T0, 3);
  const bad = mine({ prev: ok.lastHash, time: ok.lastTime + 600, bits: EASY_BITS, invalidWork: true });
  const r = checkHeaders(concat(genesis.header, ok.bytes, bad.header), null, REGTEST);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failure, { height: 4, problem: "hash doesn't meet its difficulty target (invalid proof of work)" });
  assert.equal(r.checked, 4);
});

test('the difficulty may not change inside a period', () => {
  const ok = extend(genesis.hash, T0, 3);
  const harder = extend(ok.lastHash, ok.lastTime, 1, { bits: 0x1f7fffff });
  const r = checkHeaders(concat(genesis.header, ok.bytes, harder.bytes), null, REGTEST);
  assert.equal(r.ok, false);
  assert.equal(r.failure.height, 4);
  assert.match(r.failure.problem, /differs from block 3 inside a period/);
});

test('a target easier than the network allows fails', () => {
  const params = { ...REGTEST, powLimit: targetFromBits(0x1f7fffff) };
  const r = checkHeaders(genesis.header, null, params);
  assert.equal(r.ok, false);
  assert.match(r.failure.problem, /outside the network's limits/);
});

test("a timestamp must be later than the median of the previous 11 blocks'", () => {
  const ok = extend(genesis.hash, T0, 12);
  // Median of the last 11 (T0+600*2 .. T0+600*12) is T0+600*7.
  const median = T0 + 600 * 7;
  const atMedian = mine({ prev: ok.lastHash, time: median, bits: EASY_BITS });
  const r = checkHeaders(concat(genesis.header, ok.bytes, atMedian.header), null, REGTEST);
  assert.equal(r.ok, false);
  assert.equal(r.failure.height, 13);
  assert.match(r.failure.problem, /isn't later than the median/);

  // One second later is allowed, even though it is before the last block.
  const after = mine({ prev: ok.lastHash, time: median + 1, bits: EASY_BITS });
  assert.equal(checkHeaders(concat(genesis.header, ok.bytes, after.header), null, REGTEST).ok, true);
});

test('versions below the minimum after an activation height fail', () => {
  const early = extend(genesis.hash, T0, 4, { version: 1 }); // heights 1..4: allowed
  const late = extend(early.lastHash, early.lastTime, 1, { version: 1 }); // height 5
  const r = checkHeaders(concat(genesis.header, early.bytes, late.bytes), null, REGTEST);
  assert.equal(r.ok, false);
  assert.equal(r.checked, 5);
  assert.match(r.failure.problem, /version 1 is below 2, required from block 5/);
});

// A retarget: a state at height 2,015 (the last block of a period), then
// headers from 2,016 on.
function periodEndState(periodSeconds) {
  const lastTime = T0 + periodSeconds;
  const lastHash = mine({ prev: new Uint8Array(32), time: lastTime, bits: EASY_BITS }).hash;
  return {
    state: {
      height: RETARGET_INTERVAL - 1,
      hash: toHex(lastHash.slice().reverse()),
      bits: EASY_BITS,
      timestamp: lastTime,
      periodStartTimestamp: T0,
      recentTimestamps: Array.from({ length: 11 }, (_, i) => lastTime - 600 * (10 - i)),
      work: BigInt(RETARGET_INTERVAL) * workForBits(EASY_BITS)
    },
    lastHash,
    lastTime
  };
}

test('at a period start the difficulty must be the retarget', () => {
  // A period mined 4× too fast: difficulty must rise 4× (the limit).
  const { state, lastHash, lastTime } = periodEndState(TARGET_TIMESPAN / 4);
  const required = nextBits(EASY_BITS, T0, lastTime, REGTEST.powLimit).bits;
  assert.notEqual(required, EASY_BITS);

  const good = extend(lastHash, lastTime, 3, { bits: required });
  const r = checkHeaders(good.bytes, state, REGTEST);
  assert.equal(r.ok, true);
  assert.equal(r.state.height, RETARGET_INTERVAL + 2);
  assert.equal(r.state.periodStartTimestamp, lastTime + 600);
  assert.equal(r.state.work, state.work + 3n * workForBits(required));

  // Keeping the old, easier difficulty is not allowed.
  const stale = extend(lastHash, lastTime, 1, { bits: EASY_BITS });
  const s = checkHeaders(stale.bytes, state, REGTEST);
  assert.equal(s.ok, false);
  assert.equal(s.failure.height, RETARGET_INTERVAL);
  assert.match(s.failure.problem, /isn't the retarget from the previous period/);
  assert.deepEqual(s.state, state);
});

test('a slow period cannot make the difficulty easier than the network limit', () => {
  const { state, lastHash, lastTime } = periodEndState(TARGET_TIMESPAN * 10);
  // Already at the limit: the retarget is capped there, so bits stay.
  assert.equal(nextBits(EASY_BITS, T0, lastTime, REGTEST.powLimit).bits, EASY_BITS);
  const next = extend(lastHash, lastTime, 1);
  assert.equal(checkHeaders(next.bytes, state, REGTEST).ok, true);
});

test('mainnet parameters are Bitcoin Core’s', () => {
  assert.equal(MAINNET.genesisHash, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
  assert.equal(MAINNET.powLimit, (1n << 224n) - 1n);
  assert.deepEqual(MAINNET.minVersions, [[227931, 2], [363725, 3], [388381, 4]]);
  assert.equal(HEADER_SIZE, 80);
});
