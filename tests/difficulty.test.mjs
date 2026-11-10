import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETARGET_INTERVAL,
  GENESIS_BITS,
  periodStart,
  headersNeeded,
  nextBits,
  difficultyChange,
  checkDifficulty
} from '../difficulty.js';

import { bitsFromTarget, targetFromBits } from '../spv.js';

// ---------------------------------------------------------------
// Retarget arithmetic: Bitcoin Core src/test/pow_tests.cpp vectors
// ---------------------------------------------------------------

test('first real difficulty increase (block 32256)', () => {
  // Block #30240 time 1261130161, block #32255 time 1262152739.
  assert.equal(nextBits(0x1d00ffff, 1261130161, 1262152739).bits, 0x1d00d86a);
});

test('result is capped at the network limit', () => {
  // Blocks #0..#2015 took longer than two weeks; stays at difficulty 1.
  assert.equal(nextBits(0x1d00ffff, 1231006505, 1233061996).bits, 0x1d00ffff);
});

test('lower clamp on actual timespan (difficulty x4 at most)', () => {
  const r = nextBits(0x1c05a3f4, 1279008237, 1279297671);
  assert.equal(r.bits, 0x1c0168fd);
  assert.equal(r.clamped, true);
});

test('upper clamp on actual timespan (difficulty /4 at most)', () => {
  const r = nextBits(0x1c387f6f, 1263163443, 1269211443);
  assert.equal(r.bits, 0x1d00e1fd);
  assert.equal(r.clamped, true);
});

// ---------------------------------------------------------------
// Compact encoding
// ---------------------------------------------------------------

test('bitsFromTarget round-trips real bits values', () => {
  for (const bits of [0x1d00ffff, 0x1b04864c, 0x1d00d86a, 0x1c0168fd, 0x17034219, 0x03123456]) {
    assert.equal(bitsFromTarget(targetFromBits(bits)), bits, bits.toString(16));
  }
});

test('bitsFromTarget normalises the sign bit like GetCompact', () => {
  assert.equal(bitsFromTarget(0x80n), 0x02008000);
  assert.equal(bitsFromTarget(0x12345600n), 0x04123456);
  assert.equal(bitsFromTarget(0n), 0);
});

// ---------------------------------------------------------------
// Which headers, and the full check
// ---------------------------------------------------------------

test('periodStart and headersNeeded', () => {
  assert.equal(periodStart(100000), 98784);
  assert.equal(periodStart(32256), 32256);
  assert.deepEqual(headersNeeded(5), []);
  assert.deepEqual(headersNeeded(100000), [98784, 98783, 96768]);
  assert.deepEqual(headersNeeded(32256), [32255, 30240]);
});

test('difficultyChange', () => {
  assert.equal(difficultyChange(0x1d00ffff, 0x1d00ffff), 0);
  // 0x1d00ffff -> 0x1d00d86a was the first increase: difficulty 1 -> 1.18 (+18.3 %).
  assert.equal(Math.round(difficultyChange(0x1d00ffff, 0x1d00d86a) * 1000) / 10, 18.3);
});

const H = (hash, bits, timestamp, previousBlockHash = 'x', powOk = true) =>
  ({ hash, bits, timestamp, previousBlockHash, powOk });

// Period 16 (#32256..#34271), built from Core's 32256 vector.
const headers32256 = {
  32255: H('h32255', 0x1d00ffff, 1262152739),
  30240: H('h30240', 0x1d00ffff, 1261130161)
};

test('block at a retarget boundary passes with the right bits', () => {
  const block = { height: 32256, hash: 'h32256', bits: 0x1d00d86a, previousBlockHash: 'h32255' };
  const r = checkDifficulty(block, headers32256);
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.checks.length, 3);
  assert.ok(r.facts.some(f => f.value.includes('+18.29 %')));
});

test('block inside a period must match the period start', () => {
  const headers = { ...headers32256, 32256: H('h32256', 0x1d00d86a, 1262153464, 'h32255') };
  const ok = checkDifficulty({ height: 33000, bits: 0x1d00d86a }, headers);
  assert.equal(ok.ok, true);
  assert.equal(ok.checks.length, 4);

  // An easier difficulty than the period's is rejected...
  const easy = checkDifficulty({ height: 33000, bits: 0x1d00ffff }, headers);
  assert.equal(easy.ok, false);
  assert.equal(easy.checks[0].ok, false);
});

test('a period start with the wrong retarget fails', () => {
  // ...and so is a whole period claiming the old, easier difficulty.
  const headers = { ...headers32256, 32256: H('h32256', 0x1d00ffff, 1262153464, 'h32255') };
  const r = checkDifficulty({ height: 33000, bits: 0x1d00ffff }, headers);
  assert.equal(r.ok, false);
  assert.equal(r.checks[0].ok, true);  // consistent with its period start...
  assert.equal(r.checks[1].ok, false); // ...but the period start is wrong
});

test('broken linkage or invalid work fails', () => {
  const block = { height: 32256, hash: 'h32256', bits: 0x1d00d86a, previousBlockHash: 'elsewhere' };
  assert.equal(checkDifficulty(block, headers32256).ok, false);

  const bad = { ...headers32256, 30240: H('h30240', 0x1d00ffff, 1261130161, 'x', false) };
  const block2 = { ...block, previousBlockHash: 'h32255' };
  const r = checkDifficulty(block2, bad);
  assert.equal(r.ok, false);
  // No figures derived from headers without valid work.
  assert.deepEqual(r.facts.map(f => f.label), ['Period']);
});

test('first period must use the genesis difficulty', () => {
  assert.equal(checkDifficulty({ height: 0, bits: GENESIS_BITS }).ok, true);
  assert.equal(checkDifficulty({ height: 2015, bits: GENESIS_BITS }).ok, true);
  assert.equal(checkDifficulty({ height: 100, bits: 0x1c00ffff }).ok, false);
  assert.equal(RETARGET_INTERVAL, 2016);
});

test('missing headers throw instead of passing', () => {
  assert.throws(() => checkDifficulty({ height: 100000, bits: 0x1b04864c }, {}), /Missing header/);
});

// ---------------------------------------------------------------
// checkHeaderChain: a run of consecutive headers (confirmations)
// ---------------------------------------------------------------

import { checkHeaderChain } from '../difficulty.js';

// Synthetic headers 100..105: each points to the one before.
const run = (from, to, bits = 0x1b04864c, extra = {}) => {
  const out = {};
  for (let h = from; h <= to; h++) {
    out[h] = { hash: 'h' + h, previousBlockHash: 'h' + (h - 1), bits, timestamp: 1000 + h, powOk: true, ...extra[h] };
  }
  return out;
};

test('checkHeaderChain: linked headers with the same difficulty pass', () => {
  assert.deepEqual(checkHeaderChain(run(100, 105), 100, 105),
    { linked: true, powOk: true, difficultyOk: true, ok: true });
});

test('checkHeaderChain: a single header is a chain of one', () => {
  assert.equal(checkHeaderChain(run(100, 100), 100, 100).ok, true);
});

test('checkHeaderChain: a header that points elsewhere breaks the link', () => {
  const r = checkHeaderChain(run(100, 105, 0x1b04864c, { 103: { previousBlockHash: 'other' } }), 100, 105);
  assert.equal(r.linked, false);
  assert.equal(r.ok, false);
});

test('checkHeaderChain: a cheaper block inside a period fails the difficulty', () => {
  const r = checkHeaderChain(run(100, 105, 0x1b04864c, { 104: { bits: 0x1d00ffff } }), 100, 105);
  assert.equal(r.linked, true);
  assert.equal(r.difficultyOk, false);
});

test('checkHeaderChain: a header without valid work fails', () => {
  assert.equal(checkHeaderChain(run(100, 105, 0x1b04864c, { 102: { powOk: false } }), 100, 105).powOk, false);
});

test('checkHeaderChain: across a retarget, the new period must carry it', () => {
  // Bitcoin Core's vector: 0x1d00ffff, period from 1261130161 to
  // 1262152739, gives 0x1d00d86a at block 32,256.
  const headers = run(32254, 32257, 0x1d00ffff, {
    32255: { timestamp: 1262152739 },
    32256: { bits: 0x1d00d86a, timestamp: 1262153464 },
    32257: { bits: 0x1d00d86a }
  });
  const first = { 30240: { timestamp: 1261130161, powOk: true } };
  assert.equal(checkHeaderChain(headers, 32254, 32257, first).ok, true);

  const kept = { ...headers, 32256: { ...headers[32256], bits: 0x1d00ffff }, 32257: { ...headers[32257], bits: 0x1d00ffff } };
  assert.equal(checkHeaderChain(kept, 32254, 32257, first).difficultyOk, false);

  // Without the previous period's first header the retarget can't pass.
  assert.equal(checkHeaderChain(headers, 32254, 32257).difficultyOk, false);
});

test('checkHeaderChain: a missing header throws', () => {
  const h = run(100, 105);
  delete h[103];
  assert.throws(() => checkHeaderChain(h, 100, 105), /Missing header at height 103/);
});
