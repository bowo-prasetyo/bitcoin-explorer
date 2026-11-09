import test from 'node:test';
import assert from 'node:assert/strict';

import {
  workForBits,
  periodStarts,
  chainWork,
  chainWorkHex,
  log2,
  yearsToRedo,
  formatRedoTime
} from '../chainwork.js';

const DIFF1 = 0x1d00ffff;
const WORK1 = 0x100010001n; // Bitcoin Core: work of a difficulty-1 block

test('work of a difficulty-1 block matches Bitcoin Core', () => {
  assert.equal(workForBits(DIFF1), WORK1);
});

test("genesis chainwork equals Core's (0x100010001)", () => {
  const w = chainWork({ 0: DIFF1 }, 0);
  assert.equal(chainWorkHex(w), '0000000000000000000000000000000000000000000000000000000100010001');
});

test('difficulty was 1 until block 32255, so chainwork is 32,256 x work(1)', () => {
  const bits = Object.fromEntries(periodStarts(32255).map(h => [h, DIFF1]));
  assert.equal(chainWork(bits, 32255), 32256n * WORK1);
});

test('a period after a retarget uses its own bits, including a partial period', () => {
  const bits = Object.fromEntries(periodStarts(32255).map(h => [h, DIFF1]));
  bits[32256] = 0x1d00d86a; // the first increase
  const w = chainWork(bits, 32256 + 9);
  assert.equal(w, 32256n * WORK1 + 10n * workForBits(0x1d00d86a));
  assert.ok(workForBits(0x1d00d86a) > WORK1);
});

test('periodStarts', () => {
  assert.deepEqual(periodStarts(0), [0]);
  assert.deepEqual(periodStarts(2015), [0]);
  assert.deepEqual(periodStarts(2016), [0, 2016]);
  assert.equal(periodStarts(925000).length, 459);
});

test('a missing period throws instead of under-counting', () => {
  assert.throws(() => chainWork({ 0: DIFF1 }, 2016), /Missing period starting at 2016/);
});

test('log2 and years to redo', () => {
  assert.equal(log2(1n << 96n), 96);
  assert.equal(Math.round(log2(WORK1) * 100) / 100, 32);
  // 52,596 difficulty-1 blocks at 10 minutes is one Julian year.
  assert.equal(Math.round(yearsToRedo(52596n * WORK1, DIFF1) * 1000) / 1000, 1);
});

test('formatRedoTime picks readable units', () => {
  const minute = 1 / (365.25 * 24 * 60);
  assert.equal(formatRedoTime(10 * minute), '~10 minutes');
  assert.equal(formatRedoTime(0), '~1 minute');
  assert.equal(formatRedoTime(300 * minute), '~5 hours');
  assert.equal(formatRedoTime(30 / 365.25), '~30 days');
  assert.equal(formatRedoTime(14.4), '~14 years');
  // The genesis block alone: one block, ten minutes.
  assert.equal(formatRedoTime(yearsToRedo(WORK1, DIFF1)), '~10 minutes');
});
