import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTRUST_TTL,
  parseDistrust,
  isDistrusted,
  lookupNodes,
  applyTipCheck
} from '../distrust.js';

const NOW = 1_800_000_000_000;
const BS = { name: 'Blockstream', base: 'https://blockstream.info/api' };
const MS = { name: 'mempool.space', base: 'https://mempool.space/api' };

const fakeTip = (p, error = "its header doesn't hash to the tip it named") =>
  ({ ...p, ok: false, invalid: true, error, height: 1, hash: 'aa' });
const goodTip = p => ({ ...p, ok: true, height: 1, hash: 'aa' });
const downTip = p => ({ ...p, ok: false, error: 'timed out' });

test('an invalid tip distrusts its provider, with the reason and time', () => {
  const d = applyTipCheck({}, [goodTip(BS), fakeTip(MS)], NOW);
  assert.deepEqual(d, {
    [MS.base]: { name: 'mempool.space', reason: "its header doesn't hash to the tip it named", since: NOW }
  });
});

test('a distrusted provider is left out of lookups, in order otherwise', () => {
  const d = applyTipCheck({}, [fakeTip(BS)], NOW);
  assert.deepEqual(lookupNodes([BS, MS], d, NOW), [MS]);
  assert.deepEqual(lookupNodes([MS, BS], {}, NOW), [MS, BS]);
});

test('every provider distrusted leaves nothing to ask', () => {
  const d = applyTipCheck({}, [fakeTip(BS), fakeTip(MS)], NOW);
  assert.deepEqual(lookupNodes([BS, MS], d, NOW), []);
});

test('a valid tip later clears it', () => {
  const d = applyTipCheck({}, [fakeTip(MS)], NOW);
  const after = applyTipCheck(d, [goodTip(MS), goodTip(BS)], NOW + 60_000);
  assert.deepEqual(after, {});
  assert.deepEqual(lookupNodes([BS, MS], after, NOW), [BS, MS]);
});

test('being unreachable neither distrusts nor clears', () => {
  assert.deepEqual(applyTipCheck({}, [downTip(MS)], NOW), {});
  const d = applyTipCheck({}, [fakeTip(MS)], NOW);
  assert.equal(applyTipCheck(d, [downTip(MS)], NOW + 1), d);
});

test('repeat offences keep the original time, so the expiry is not extended', () => {
  const d = applyTipCheck({}, [fakeTip(MS)], NOW);
  assert.equal(applyTipCheck(d, [fakeTip(MS, 'later reason')], NOW + 1000), d);
});

test('no change returns the same object, so callers can skip saving', () => {
  const d = {};
  assert.equal(applyTipCheck(d, [goodTip(BS), goodTip(MS)], NOW), d);
});

test('distrust expires after the TTL', () => {
  const d = applyTipCheck({}, [fakeTip(MS)], NOW);
  assert.equal(isDistrusted(d, MS.base, NOW + DISTRUST_TTL - 1), true);
  assert.equal(isDistrusted(d, MS.base, NOW + DISTRUST_TTL), false);
  assert.deepEqual(lookupNodes([MS], d, NOW + DISTRUST_TTL), [MS]);
});

test('parseDistrust round-trips and drops expired, future, malformed entries', () => {
  const d = applyTipCheck({}, [fakeTip(MS)], NOW);
  assert.deepEqual(parseDistrust(JSON.stringify(d), NOW + 1), d);

  const stored = JSON.stringify({
    ...d,
    old: { name: 'x', reason: 'r', since: NOW - DISTRUST_TTL },
    future: { name: 'x', reason: 'r', since: NOW + 1000 },
    bad: { reason: 'no time' },
    worse: null
  });
  assert.deepEqual(Object.keys(parseDistrust(stored, NOW)), [MS.base]);

  for (const junk of [null, '', 'not json', '[]', '42', 'null']) {
    assert.deepEqual(parseDistrust(junk, NOW), {}, String(junk));
  }
});
