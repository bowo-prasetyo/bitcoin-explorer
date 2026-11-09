// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMerkleRoot,
  verifyMerkleRoot,
  reverseHex
} from '../spv.js';

// Block 100000: four transactions.
const BLOCK_100000_TXIDS = [
  '8c14f0db3df150123e6f3dbbf30f8b955a8249b62ac1d1ff16284aefa3d06d87',
  'fff2525b8931402dd09222c50775608f75787bd2b87e56995a7bdd30f79702c4',
  '6359f0868171b1d194cbee1af2f16ea598ae8fad666d9b012c8ed2b79a236ec4',
  'e9a66845e05d5abc0ad04ec80f774a7e585c6e8db975962d069a522137b80c1d'
];
const BLOCK_100000_ROOT =
  'f3e94742aca4b5ef85488dc37c06c3282295ffec960994b2c0d5ac2a25a95766';

// Genesis block: one transaction, so the root is the coinbase txid.
const GENESIS_TXID =
  '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

test('merkle root of block 100000 matches the header', async () => {
  assert.equal(
    await computeMerkleRoot(BLOCK_100000_TXIDS),
    BLOCK_100000_ROOT
  );
  assert.equal(
    await verifyMerkleRoot(BLOCK_100000_TXIDS, BLOCK_100000_ROOT),
    true
  );
});

test('odd transaction count duplicates the last hash', async () => {
  const three = BLOCK_100000_TXIDS.slice(0, 3);
  const withDup = [...three, three[2]];

  assert.equal(
    await computeMerkleRoot(three),
    await computeMerkleRoot(withDup)
  );
});

test('single-transaction block root is the txid', async () => {
  assert.equal(await computeMerkleRoot([GENESIS_TXID]), GENESIS_TXID);
});

test('tampered or reordered txids fail verification', async () => {
  const reordered = [...BLOCK_100000_TXIDS].reverse();
  assert.equal(await verifyMerkleRoot(reordered, BLOCK_100000_ROOT), false);
  assert.equal(await verifyMerkleRoot([], BLOCK_100000_ROOT), false);
});

test('reverseHex reverses byte order', () => {
  assert.equal(reverseHex('0a0b0c'), '0c0b0a');
});
