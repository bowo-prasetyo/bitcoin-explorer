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

// Tips as checkTipHeaders() leaves them: with their header's fields.
const BITS = 0x1b04864c;
const H = (name, height, hash, extra = {}) =>
  ({ name, ok: true, height, hash, bits: BITS, timestamp: 1000 + height, previousBlockHash: 'prev-of-' + hash, ...extra });

test('a provider one block behind on the same chain', () => {
  const lead = H('A', 100, 'aa', { previousBlockHash: '99' });
  const lag = H('B', 99, '99');
  const r = compareTips([lead, lag]);
  assert.equal(r.state, 'behind');
  assert.deepEqual(r.lagging, [{ name: 'B', by: 1 }]);
  assert.equal(r.hash, 'aa');
});

test("one block behind: the leader's own header decides, not its word", () => {
  // The leader says its block 99 is B's, but its tip doesn't build on it.
  const lead = H('A', 100, 'aa', { previousBlockHash: 'elsewhere' });
  const r = compareTips([lead, H('B', 99, '99')], { 99: '99' });
  assert.equal(r.state, 'conflict');
  assert.deepEqual(r.conflicts, ['B']);
});

test('several blocks behind on the same chain, same period', () => {
  const r = compareTips([H('A', 100, 'aa'), H('B', 97, '97')], { 97: '97' });
  assert.equal(r.state, 'behind');
  assert.deepEqual(r.lagging, [{ name: 'B', by: 3 }]);
});

test('a lagging provider on a different chain is a conflict', () => {
  const lag = { name: 'B', ok: true, height: 99, hash: 'xx' };
  assert.equal(compareTips([A, lag], { 99: '99' }).state, 'conflict');
});

test("lagging without ancestry info is unconfirmed, never a pass", () => {
  const lag = H('B', 98, 'yy');
  const r = compareTips([lag, H('A', 100, 'aa')]);
  assert.equal(r.state, 'unconfirmed');
  assert.deepEqual(r.unconfirmed, [{ name: 'B', by: 2 }]);
});

test('tips without header fields are unconfirmed, never a pass', () => {
  const lag = { name: 'B', ok: true, height: 99, hash: '99' };
  assert.equal(compareTips([A, lag], { 99: '99' }).state, 'unconfirmed');
});

// ---------------------------------------------------------------
// A leader at a made-up difficulty (audit finding: a difficulty-1
// header costs ~2^32 hashes, so "valid proof of work" alone is cheap)
// ---------------------------------------------------------------

const HONEST_BITS = 0x17034219;

test('a cheap tip on top of the honest tip is invalid, not "catching up"', () => {
  const honest = H('Honest', 900000, 'hh', { bits: HONEST_BITS });
  const evil = H('Evil', 900001, 'ee', { bits: 0x1d00ffff, previousBlockHash: 'hh' });
  const r = compareTips([honest, evil], { 900000: 'hh' });
  assert.equal(r.state, 'invalid');
  assert.deepEqual(r.invalid, ['Evil']);
  assert.match(r.results.find(x => x.name === 'Evil').error, /difficulty doesn't follow from block 900,000/);
  // The honest tip is the chain tip again.
  assert.equal(r.height, 900000);
  assert.equal(r.hash, 'hh');
  assert.equal(r.chainState, 'single');
});

test('a cheap tip several blocks ahead, same period: invalid', () => {
  const honest = H('Honest', 900000, 'hh', { bits: HONEST_BITS });
  const evil = H('Evil', 900005, 'ee', { bits: 0x1d00ffff });
  assert.equal(compareTips([honest, evil], { 900000: 'hh' }).state, 'invalid');
});

test('more than one block ahead across a period boundary: unconfirmed', () => {
  // 901,152 starts a period; the lagging provider is two blocks before it.
  const r = compareTips([H('A', 901152, 'aa'), H('B', 901150, 'bb')], { 901150: 'bb' });
  assert.equal(r.state, 'unconfirmed');
});

test('a tip starting a new period must carry the retarget', () => {
  // Bitcoin Core's mainnet vector (pow_tests.cpp, get_next_work):
  // last block 0x1d00ffff at 1262152739, period began 1261130161 -> 0x1d00d86a.
  const lag = H('B', 32255, 'bb', { bits: 0x1d00ffff, timestamp: 1262152739 });
  const first = { 30240: { timestamp: 1261130161 } };
  const good = H('A', 32256, 'aa', { bits: 0x1d00d86a, previousBlockHash: 'bb' });
  const bad = { ...good, bits: 0x1d00ffff };

  assert.equal(compareTips([good, lag], {}, first).state, 'behind');
  const r = compareTips([bad, lag], {}, first);
  assert.equal(r.state, 'invalid');
  assert.deepEqual(r.invalid, ['A']);
  // Without the period's first header there is nothing to check against.
  assert.equal(compareTips([good, lag]).state, 'unconfirmed');
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

// Real block 1 (builds on genesis), for checks across real headers.
const BLOCK1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048';
const BLOCK1_HEADER =
  '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d61900' +
  '00000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e8' +
  '57233e0e61bc6649ffff001d01e36299';

test('real headers: block 1 is one ahead of genesis on the same chain', async () => {
  const tips = await checkTipHeaders([
    { name: 'A', base: 'a', ok: true, height: 1, hash: BLOCK1_HASH, header: BLOCK1_HEADER },
    { name: 'B', base: 'b', ok: true, height: 0, hash: GENESIS_HASH, header: GENESIS_HEADER }
  ]);
  assert.equal(tips[0].previousBlockHash, GENESIS_HASH);
  assert.equal(tips[0].bits, 0x1d00ffff);
  const r = compareTips(tips);
  assert.equal(r.state, 'behind');
  assert.equal(r.hash, BLOCK1_HASH);
});

test('real headers: a valid header claimed one above a tip it does not build on', async () => {
  // The genesis header passes proof of work, but claimed as block 2 it
  // doesn't build on block 1: a different chain, not "catching up".
  const tips = await checkTipHeaders([
    { name: 'Evil', base: 'e', ok: true, height: 2, hash: GENESIS_HASH, header: GENESIS_HEADER },
    { name: 'Honest', base: 'h', ok: true, height: 1, hash: BLOCK1_HASH, header: BLOCK1_HEADER }
  ]);
  assert.equal(compareTips(tips, { 1: BLOCK1_HASH }).state, 'conflict');
});

test('checkTipHeaders: a header with a zero target is invalid, not a crash', async () => {
  const zero = GENESIS_HEADER.slice(0, 144) + '0000001d' + '00000000';
  const [r] = await checkTipHeaders([tip(zero, await blockHashFromHeader(zero))]);
  assert.equal(r.invalid, true);
  assert.match(r.error, /doesn't meet its own difficulty target/);
});

test('checkTipHeaders: a malformed header', async () => {
  const [r] = await checkTipHeaders([tip('<html>', GENESIS_HASH)]);
  assert.equal(r.invalid, true);
  assert.match(r.error, /malformed/);
});
