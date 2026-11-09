import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENESIS_BITS,
  GENESIS_HASH,
  checkDifficultyHistory
} from '../difficulty.js';

const DAY = 86400;
const H = (hash, bits, timestamp, previousBlockHash, powOk = true) =>
  ({ hash, bits, timestamp, previousBlockHash, powOk });
const hashAt = h => (h === 0 ? GENESIS_HASH : `h${h}`);

// Genesis .. block 32256. Periods 0-14 took longer than two weeks, so
// difficulty stayed at 1 (capped at the limit), as on mainnet. Period 15
// uses the real timestamps of blocks 30240 and 32255 (Bitcoin Core's
// pow_tests), giving the real first increase at 32256: 0x1d00d86a.
function realisticHistory() {
  const starts = {};
  const ends = {};
  const t0 = 1231006505;

  for (let k = 0; k <= 14; k++) {
    const p = k * 2016;
    const start = t0 + k * 20 * DAY;
    starts[p] = H(hashAt(p), GENESIS_BITS, start, k === 0 ? '0'.repeat(64) : hashAt(p - 1));
    ends[p + 2015] = H(hashAt(p + 2015), GENESIS_BITS, start + 15 * DAY, 'x');
  }

  starts[30240] = H(hashAt(30240), GENESIS_BITS, 1261130161, hashAt(30239));
  ends[32255] = H(hashAt(32255), GENESIS_BITS, 1262152739, 'x');
  starts[32256] = H(hashAt(32256), 0x1d00d86a, 1262153464, hashAt(32255));

  return { starts, ends };
}

test('a consistent history from genesis to block 32256 passes', () => {
  const { starts, ends } = realisticHistory();
  const r = checkDifficultyHistory(starts, ends, 32256);
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.retargets, 16);
  // Slow early periods were *capped* at the network limit; the 1/4..4x
  // timespan *clamp* never applied.
  assert.equal(r.stats.clamped, 0);
  assert.equal(r.stats.maxUp.height, 32256);
  assert.equal(Math.round(r.stats.maxUp.change * 1000) / 10, 18.3);
});

test('only genesis: nothing to trace, but genesis is anchored', () => {
  const r = checkDifficultyHistory({ 0: H(GENESIS_HASH, GENESIS_BITS, 1231006505, '0') }, {}, 0);
  assert.equal(r.ok, true);
  assert.equal(r.retargets, 0);

  const bad = checkDifficultyHistory({ 0: H('other', GENESIS_BITS, 1, '0') }, {}, 0);
  assert.deepEqual(bad.failures, [{ height: 0, problem: 'not the genesis block' }]);
});

test('an easier difficulty than the rules allow is caught where it happens', () => {
  const { starts, ends } = realisticHistory();
  starts[32256] = { ...starts[32256], bits: GENESIS_BITS }; // pretend no increase
  const r = checkDifficultyHistory(starts, ends, 32256);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, [{ height: 32256, problem: "difficulty isn't the retarget from the previous period" }]);
});

test('a lowered difficulty early in history taints it at that step', () => {
  const { starts, ends } = realisticHistory();
  starts[4032] = { ...starts[4032], bits: 0x1d01ffff };
  const r = checkDifficultyHistory(starts, ends, 32256);
  assert.ok(r.failures.some(f => f.height === 4032));
});

test('timestamps drive the retarget: faster period, different required bits', () => {
  const { starts, ends } = realisticHistory();
  // Claim period 15 took 3.5 days: the rule would require 4x difficulty.
  ends[32255] = { ...ends[32255], timestamp: 1261130161 + 3.5 * DAY };
  const r = checkDifficultyHistory(starts, ends, 32256);
  assert.ok(r.failures.some(f => f.height === 32256));
});

test('broken links, mismatched period ends and invalid work are reported', () => {
  const { starts, ends } = realisticHistory();
  starts[2016] = { ...starts[2016], previousBlockHash: 'elsewhere' };
  ends[6047] = { ...ends[6047], bits: 0x1c00ffff };
  ends[10079] = { ...ends[10079], powOk: false };
  const r = checkDifficultyHistory(starts, ends, 32256);
  const problems = Object.fromEntries(r.failures.map(f => [f.height, f.problem]));
  assert.equal(problems[2016], "doesn't build on block 2,015");
  assert.equal(problems[6047], "difficulty differs from its period's first block");
  assert.equal(problems[10079], 'invalid proof of work');
});

test('missing headers throw instead of passing', () => {
  const { starts, ends } = realisticHistory();
  delete ends[20159];
  assert.throws(() => checkDifficultyHistory(starts, ends, 32256), /Missing header near height 20160/);
  assert.throws(() => checkDifficultyHistory({}, {}, 0), /Missing genesis/);
});
