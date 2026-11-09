import test from 'node:test';
import assert from 'node:assert/strict';

import { compareTips } from '../consensus.js';

const A = { name: 'A', ok: true, height: 100, hash: 'aa' };
const B = { name: 'B', ok: true, height: 100, hash: 'aa' };
const down = { name: 'C', ok: false, error: 'timeout' };

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
