import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyQuery } from '../search.js';

const GENESIS_BLOCK = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const GENESIS_TX = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

test('block heights', () => {
  assert.deepEqual(classifyQuery('0'), { type: 'height', height: 0 });
  assert.deepEqual(classifyQuery(' 870000 '), { type: 'height', height: 870000 });
  assert.equal(classifyQuery('123456789012').type, 'invalid');
});

test('64-hex hashes, with block-likelihood hint', () => {
  assert.deepEqual(classifyQuery(GENESIS_BLOCK), { type: 'hash', hash: GENESIS_BLOCK, likelyBlock: true });
  assert.deepEqual(classifyQuery(GENESIS_TX.toUpperCase()), { type: 'hash', hash: GENESIS_TX, likelyBlock: false });
});

test('mainnet addresses', () => {
  for (const a of [
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',                               // P2PKH
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',                               // P2SH
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',                       // P2WPKH
    'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',   // P2WSH
    'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'    // P2TR
  ]) {
    assert.deepEqual(classifyQuery(a), { type: 'address', address: a }, a);
  }
});

test('uppercase bech32 is normalised; mixed case is rejected', () => {
  const a = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  assert.deepEqual(classifyQuery(a.toUpperCase()), { type: 'address', address: a });
  assert.equal(classifyQuery('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').type, 'invalid');
});

test('helpful reasons for invalid input', () => {
  assert.match(classifyQuery('').reason, /Enter/);
  assert.match(classifyQuery('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx').reason, /testnet/);
  assert.match(classifyQuery('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn').reason, /testnet/);
  assert.match(classifyQuery('abcdef0123').reason, /64 hex characters; this one has 10/);
  assert.match(classifyQuery('hello world').reason, /Not a block height/);
  // 0 and O are not base58
  assert.equal(classifyQuery('1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf0a').type, 'invalid');
});
