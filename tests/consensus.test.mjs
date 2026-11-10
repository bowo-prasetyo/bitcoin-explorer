import test from 'node:test';
import assert from 'node:assert/strict';

import { compareTips, checkTipHeaders } from '../consensus.js';
import { blockHashFromHeader, targetFromBits } from '../spv.js';

const A = { name: 'A', ok: true, height: 100, hash: 'aa' };
const B = { name: 'B', ok: true, height: 100, hash: 'aa' };
const down = { name: 'C', ok: false, error: 'timeout' };
const fake = { name: 'F', ok: false, invalid: true, error: "its header doesn't hash to the tip it named" };

test('all agree', () => {
  const r = compareTips([A, B]);
  assert.equal(r.state, 'agree');
  assert.equal(r.responded, 2);
  assert.equal(r.height, 100);
});

test('unreachable providers are counted but not compared', () => {
  const r = compareTips([A, B, down]);
  assert.equal(r.state, 'agree');
  assert.equal(r.responded, 2);
  assert.equal(r.total, 3);
});

test('same height, different hash is a conflict', () => {
  const r = compareTips([A, { ...B, hash: 'bb' }]);
  assert.equal(r.state, 'conflict');
  assert.deepEqual(r.conflicts, ['B']);
});

test('a provider one block behind on the same chain', () => {
  const lag = { name: 'B', ok: true, height: 99, hash: '99' };
  const r = compareTips([A, lag], { 99: '99' });
  assert.equal(r.state, 'behind');
  assert.deepEqual(r.lagging, [{ name: 'B', by: 1 }]);
  assert.equal(r.hash, 'aa');
});

test('a lagging provider on a different chain is a conflict', () => {
  const lag = { name: 'B', ok: true, height: 99, hash: 'xx' };
  assert.equal(compareTips([A, lag], { 99: '99' }).state, 'conflict');
});

test('lagging without ancestry info is reported as behind', () => {
  const lag = { name: 'B', ok: true, height: 98, hash: 'yy' };
  assert.equal(compareTips([lag, A]).state, 'behind');
});

test('single and unavailable', () => {
  assert.equal(compareTips([A, down]).state, 'single');
  assert.equal(compareTips([A]).state, 'single');
  const none = compareTips([down]);
  assert.equal(none.state, 'unavailable');
  assert.equal(none.height, null);
});

// ---------------------------------------------------------------
// A provider that answers with an invalid tip
// ---------------------------------------------------------------

test('an invalid tip is a failure, even when the others agree', () => {
  const r = compareTips([A, B, fake]);
  assert.equal(r.state, 'invalid');
  assert.deepEqual(r.invalid, ['F']);
  assert.equal(r.chainState, 'agree');
  assert.equal(r.responded, 2);
});

test('an invalid tip is not mistaken for an unreachable provider', () => {
  // Before: one fake + one honest read "only one answered", and two
  // fakes read "couldn't reach any provider", both grey.
  const one = compareTips([A, fake]);
  assert.equal(one.state, 'invalid');
  assert.equal(one.chainState, 'single');

  const all = compareTips([fake, { ...fake, name: 'G' }]);
  assert.equal(all.state, 'invalid');
  assert.deepEqual(all.invalid, ['F', 'G']);
  assert.equal(all.chainState, 'unavailable');
});

test('invalid wins over a conflict between the others', () => {
  const r = compareTips([A, { ...B, hash: 'bb' }, fake]);
  assert.equal(r.state, 'invalid');
  assert.equal(r.chainState, 'conflict');
  assert.deepEqual(r.conflicts, ['B']);
});

test('no invalid providers: invalid is empty and states are unchanged', () => {
  const r = compareTips([A, B, down]);
  assert.equal(r.state, 'agree');
  assert.deepEqual(r.invalid, []);
  assert.equal(r.chainState, undefined);
});

const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const GENESIS_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
  '4b1e5e4a29ab5f49ffff001d1dac2b7c';

const tip = (header, hash, name = 'P') => ({ name, base: 'x', ok: true, height: 0, hash, header });

const withNonce = (header, n) =>
  header.slice(0, 152) + n.toString(16).padStart(8, '0');

test('checkTipHeaders keeps genuine tips and unreachable providers as they are', async () => {
  const [good, gone] = await checkTipHeaders([tip(GENESIS_HEADER, GENESIS_HASH), down]);
  assert.equal(good.ok, true);
  assert.equal(good.invalid, undefined);
  assert.deepEqual(gone, down);
});

test('checkTipHeaders: a header that is not the block named', async () => {
  const [r] = await checkTipHeaders([tip(withNonce(GENESIS_HEADER, 0), GENESIS_HASH)]);
  assert.equal(r.ok, false);
  assert.equal(r.invalid, true);
  assert.match(r.error, /doesn't hash to the tip it named/);
});

test('checkTipHeaders: a header without the work its target demands', async () => {
  // Name the tampered header's real hash, so only the work is missing.
  const header = withNonce(GENESIS_HEADER, 0);
  const [r] = await checkTipHeaders([tip(header, await blockHashFromHeader(header))]);
  assert.equal(r.invalid, true);
  assert.match(r.error, /doesn't meet its own difficulty target/);
});

test('checkTipHeaders: a header with an easier target than mainnet allows', async () => {
  // Regtest-style bits 0x207fffff: about every second nonce "meets" it.
  const easy = GENESIS_HEADER.slice(0, 144) + 'ffff7f20' + '00000000';
  const target = targetFromBits(0x207fffff);
  let header, hash;
  for (let n = 0; ; n++) {
    header = withNonce(easy, n);
    hash = await blockHashFromHeader(header);
    if (BigInt('0x' + hash) <= target) break;
  }
  const [r] = await checkTipHeaders([tip(header, hash)]);
  assert.equal(r.invalid, true);
  assert.match(r.error, /easier difficulty than mainnet allows/);
});

test('checkTipHeaders: a malformed header', async () => {
  const [r] = await checkTipHeaders([tip('<html>', GENESIS_HASH)]);
  assert.equal(r.invalid, true);
  assert.match(r.error, /malformed/);
});
