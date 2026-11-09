import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMPOOL_WS,
  wsUrlFromBase,
  liveCandidates,
  parseMessage,
  backoffDelay,
  WANT_BLOCKS
} from '../live.js';

const ID = 'ab'.repeat(32);

test('subscribes to blocks only', () => {
  assert.deepEqual(JSON.parse(WANT_BLOCKS), { action: 'want', data: ['blocks'] });
});

test('WebSocket URL from an Esplora/mempool base', () => {
  assert.equal(wsUrlFromBase('https://mempool.space/api'), MEMPOOL_WS);
  assert.equal(wsUrlFromBase('http://localhost:8999/api/'), 'ws://localhost:8999/api/v1/ws');
  assert.equal(wsUrlFromBase('http://abc.onion/api'), 'ws://abc.onion/api/v1/ws');
});

test('candidates: mempool.space by default, yours first, exclusive means only yours', () => {
  assert.deepEqual(liveCandidates({ custom: null }), [MEMPOOL_WS]);
  assert.deepEqual(
    liveCandidates({ custom: { base: 'https://my.node/api', exclusive: false } }),
    ['wss://my.node/api/v1/ws', MEMPOOL_WS]
  );
  assert.deepEqual(
    liveCandidates({ custom: { base: 'https://my.node/api', exclusive: true } }),
    ['wss://my.node/api/v1/ws']
  );
  // Custom endpoint that *is* mempool.space: no duplicate.
  assert.deepEqual(liveCandidates({ custom: { base: 'https://mempool.space/api', exclusive: false } }), [MEMPOOL_WS]);
});

test('parses block notifications and snapshots', () => {
  assert.deepEqual(parseMessage(JSON.stringify({ block: { id: ID, height: 870001, extra: 1 } })),
    [{ type: 'block', height: 870001, id: ID }]);
  assert.deepEqual(
    parseMessage(JSON.stringify({ blocks: [{ id: ID, height: 1 }, { id: ID, height: 2 }] })).map(e => e.height),
    [1, 2]
  );
  assert.deepEqual(parseMessage('{"pong":true}'), [{ type: 'pong' }]);
});

test('ignores other topics and malformed data', () => {
  assert.deepEqual(parseMessage('{"mempoolInfo":{"size":1}}'), []);
  assert.deepEqual(parseMessage('not json'), []);
  assert.deepEqual(parseMessage('null'), []);
  assert.deepEqual(parseMessage(JSON.stringify({ block: { id: 'xyz', height: 1 } })), []);
  assert.deepEqual(parseMessage(JSON.stringify({ block: { id: ID, height: -1 } })), []);
  assert.deepEqual(parseMessage(JSON.stringify({ block: { id: ID, height: '5' } })), []);
});

test('back-off grows exponentially, is capped at 5 minutes, and is jittered', () => {
  assert.equal(backoffDelay(0, 0.5), 2000);
  assert.equal(backoffDelay(1, 0.5), 4000);
  assert.equal(backoffDelay(5, 0.5), 64000);
  assert.equal(backoffDelay(20, 0.5), 300000);
  assert.equal(backoffDelay(0, 0), 1500);
  assert.equal(backoffDelay(0, 1), 2500);
});
