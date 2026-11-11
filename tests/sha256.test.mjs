import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { sha256, doubleSha256 } from '../sha256.js';

const hex = b => Buffer.from(b).toString('hex');

test('known SHA-256 vectors', () => {
  assert.equal(hex(sha256(new Uint8Array())), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    hex(sha256(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
});

test('matches crypto.subtle for every length 0..300 (padding edge cases)', async () => {
  const data = webcrypto.getRandomValues(new Uint8Array(300));
  for (let n = 0; n <= 300; n++) {
    const msg = data.subarray(0, n);
    const expected = new Uint8Array(await webcrypto.subtle.digest('SHA-256', msg));
    assert.equal(hex(sha256(msg)), hex(expected), `length ${n}`);
  }
});

test('double SHA-256 of the genesis header is the genesis block hash', () => {
  const header = Buffer.from(
    '0100000000000000000000000000000000000000000000000000000000000000' +
    '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
    '4b1e5e4a29ab5f49ffff001d1dac2b7c', 'hex');
  assert.equal(
    hex(doubleSha256(new Uint8Array(header)).reverse()),
    '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
  );
});
