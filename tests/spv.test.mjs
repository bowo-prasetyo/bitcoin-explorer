// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMerkleRoot,
  verifyMerkleRoot,
  merkleRootFromProof,
  reverseHex,
  doubleSHA256,
  parseHeader,
  verifyHeaderPoW,
  targetFromBits,
  MAINNET_POW_LIMIT,
  parseTransaction,
  txidFromRaw,
  computeMerkleRootChecked,
  checkMerkleProof,
  validTargetFromBits,
  blockHashFromHeader,
  bip34Prefix,
  heightInScriptSig,
  checkCoinbaseHeight,
  BIP34_HEIGHT
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

// ---------------------------------------------------------------
// Block headers & proof of work
// ---------------------------------------------------------------

const GENESIS_HASH =
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const GENESIS_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
  '4b1e5e4a29ab5f49ffff001d1dac2b7c';

const BLOCK_100000_HASH =
  '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const BLOCK_100000_HEADER =
  '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200' +
  '000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac' +
  '4247e9f337221b4d4c86041b0f2b5710';

test('parseHeader reads block 100000', () => {
  assert.deepEqual(parseHeader(BLOCK_100000_HEADER), {
    version: 1,
    previousBlockHash: '000000000002d01c1fccc21636b607dfd930d31d01c3a62104612a1719011250',
    merkleRoot: BLOCK_100000_ROOT,
    timestamp: 1293623863,
    bits: 0x1b04864c,
    nonce: 274148111
  });
  assert.throws(() => parseHeader('00'), /80 bytes/);
});

test('real headers pass every proof-of-work check', async () => {
  for (const [header, hash, difficulty] of [
    [GENESIS_HEADER, GENESIS_HASH, 1],
    [BLOCK_100000_HEADER, BLOCK_100000_HASH, 14484.162]
  ]) {
    const r = await verifyHeaderPoW(header, hash);
    assert.equal(r.ok, true, hash);
    assert.deepEqual(r.checks, { hashMatches: true, meetsTarget: true, withinPowLimit: true });
    assert.equal(r.difficulty, difficulty);
  }
});

test('a tampered header fails the work check', async () => {
  // Change the nonce: the header no longer hashes below its target.
  const tampered = BLOCK_100000_HEADER.slice(0, -8) + '00000000';
  const r = await verifyHeaderPoW(tampered, BLOCK_100000_HASH);
  assert.equal(r.ok, false);
  assert.equal(r.checks.hashMatches, false);
  assert.equal(r.checks.meetsTarget, false);
});

test('a header under a different block id fails', async () => {
  const r = await verifyHeaderPoW(GENESIS_HEADER, BLOCK_100000_HASH);
  assert.equal(r.ok, false);
  assert.equal(r.checks.hashMatches, false);
  assert.equal(r.checks.meetsTarget, true);
});

test('targetFromBits and the mainnet limit', () => {
  assert.equal(targetFromBits(0x1d00ffff), 0xffffn << 208n);
  assert.equal(MAINNET_POW_LIMIT, 0xffffn << 208n);
  assert.ok(targetFromBits(0x1d01ffff) > MAINNET_POW_LIMIT);
  assert.equal(targetFromBits(0x03123456), 0x123456n);
  assert.equal(targetFromBits(0x02123456), 0x1234n);
  assert.throws(() => targetFromBits(0x04923456), /Negative/);
});

// ---------------------------------------------------------------
// Merkle inclusion proofs
// ---------------------------------------------------------------

// Builds the Esplora-style branch (display order) for leaf `pos`.
async function branchFor(txids, pos) {
  let layer = txids.map(reverseHex);
  let index = pos;
  const branch = [];
  while (layer.length > 1) {
    const sibling = layer[index ^ 1] ?? layer[index];
    branch.push(reverseHex(sibling));
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(await doubleSHA256(layer[i] + (layer[i + 1] ?? layer[i])));
    }
    layer = next;
    index >>= 1;
  }
  return branch;
}

test('inclusion proofs for every tx in block 100000 reach the real root', async () => {
  for (let pos = 0; pos < 4; pos++) {
    const branch = await branchFor(BLOCK_100000_TXIDS, pos);
    assert.equal(
      await merkleRootFromProof(BLOCK_100000_TXIDS[pos], branch, pos),
      BLOCK_100000_ROOT,
      `pos ${pos}`
    );
  }
});

test('a proof with the wrong position or txid does not reach the root', async () => {
  const branch = await branchFor(BLOCK_100000_TXIDS, 2);
  assert.notEqual(await merkleRootFromProof(BLOCK_100000_TXIDS[2], branch, 3), BLOCK_100000_ROOT);
  assert.notEqual(await merkleRootFromProof(BLOCK_100000_TXIDS[1], branch, 2), BLOCK_100000_ROOT);
  await assert.rejects(merkleRootFromProof(BLOCK_100000_TXIDS[2], branch, 4), /Position/);
});

test('single-transaction block: empty branch, root is the txid', async () => {
  assert.equal(await merkleRootFromProof(GENESIS_TXID, [], 0), GENESIS_TXID);
});

// ---------------------------------------------------------------
// Raw transactions
// ---------------------------------------------------------------

const GENESIS_RAW =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
  '4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f' +
  '72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffff' +
  'ffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962' +
  'e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00' +
  '000000';

test('txid from raw genesis coinbase', async () => {
  assert.equal(await txidFromRaw(GENESIS_RAW), GENESIS_TXID);

  const tx = parseTransaction(GENESIS_RAW);
  assert.equal(tx.segwit, false);
  assert.equal(tx.vin.length, 1);
  assert.equal(tx.vin[0].txid, '00'.repeat(32));
  assert.equal(tx.vin[0].vout, 0xffffffff);
  // "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks"
  assert.match(tx.vin[0].scriptSig, /^04ffff001d0104455468652054696d6573/);
  assert.equal(tx.vout.length, 1);
  assert.equal(tx.vout[0].value, 5000000000);
  assert.match(tx.vout[0].scriptpubkey, /^4104678afdb0/);
});

test('segwit serialization: witness does not change the txid', async () => {
  // Same transaction with marker/flag and a one-item witness added.
  const body = GENESIS_RAW.slice(8, -8);
  const segwit = '01000000' + '0001' + body + '01' + '02abcd' + '00000000';

  const tx = parseTransaction(segwit);
  assert.equal(tx.segwit, true);
  assert.equal(await txidFromRaw(segwit), GENESIS_TXID);
});

test('malformed raw transactions are rejected', () => {
  assert.throws(() => parseTransaction(GENESIS_RAW.slice(0, -10)), /Truncated/);
  assert.throws(() => parseTransaction(GENESIS_RAW + '00'), /Trailing/);
});

// ---------------------------------------------------------------
// Audit regressions
// ---------------------------------------------------------------

test('CVE-2012-2459: a repeated last txid rebuilds the root but is flagged', async () => {
  const three = BLOCK_100000_TXIDS.slice(0, 3);
  const honest = await computeMerkleRootChecked(three);
  const padded = await computeMerkleRootChecked([...three, three[2]]);
  assert.equal(padded.root, honest.root); // same root: why the flag is needed
  assert.equal(honest.mutated, false);
  assert.equal(padded.mutated, true);
  assert.equal(await verifyMerkleRoot([...three, three[2]], honest.root), false);
  assert.equal(await verifyMerkleRoot(three, honest.root), true);
});

test('real blocks are not flagged as mutated', async () => {
  assert.equal((await computeMerkleRootChecked(BLOCK_100000_TXIDS)).mutated, false);
  assert.equal((await computeMerkleRootChecked([GENESIS_TXID])).mutated, false);
});

test('a Merkle proof pairing a right-hand node with an identical left sibling is flagged', async () => {
  const [a, b, c] = BLOCK_100000_TXIDS;
  // Honest proof for c (index 2 of 3): sibling is c itself, on the right.
  const honest = await checkMerkleProof(c, [c, await merkleRootFromProof(a, [b], 0)], 2);
  assert.equal(honest.mutated, false);
  // The phantom 4th leaf (a copy of c at index 3) reaches the same root.
  const phantom = await checkMerkleProof(c, [c, await merkleRootFromProof(a, [b], 0)], 3);
  assert.equal(phantom.root, honest.root);
  assert.equal(phantom.mutated, true);
});

test('zero, negative and oversized targets are invalid, not a crash', async () => {
  assert.equal(validTargetFromBits(0x1d000000), null);  // zero
  assert.equal(validTargetFromBits(0x04800001), null);  // negative
  assert.equal(validTargetFromBits(0xff123456), null);  // beyond 256 bits
  assert.equal(validTargetFromBits(0x1d00ffff), MAINNET_POW_LIMIT);

  const zero = GENESIS_HEADER.slice(0, 144) + '0000001d' + '00000000';
  const r = await verifyHeaderPoW(zero, await blockHashFromHeader(zero));
  assert.equal(r.ok, false);
  assert.equal(r.checks.meetsTarget, false);
  assert.equal(r.checks.withinPowLimit, false);
  assert.equal(r.difficulty, null);
});

test('parseTransaction recognises a coinbase by its null outpoint', () => {
  assert.equal(parseTransaction(GENESIS_RAW).coinbase, true);
});

test('parseTransaction computes BIP141 weight', () => {
  // Legacy transaction: weight = 4 x size. Genesis coinbase: 204 bytes.
  const g = parseTransaction(GENESIS_RAW);
  assert.equal(g.size, 204);
  assert.equal(g.weight, 816);
});

// ---------------------------------------------------------------
// BIP34: height in the coinbase
// ---------------------------------------------------------------

// A minimal coinbase: one input spending the null outpoint, with this
// scriptSig, and one empty output.
const coinbaseWith = scriptSig =>
  '01000000' + '01' + '00'.repeat(32) + 'ffffffff' +
  (scriptSig.length / 2).toString(16).padStart(2, '0') + scriptSig + 'ffffffff' +
  '01' + '0000000000000000' + '00' + '00000000';

test('bip34Prefix is CScript() << height, as Bitcoin Core serialises it', () => {
  assert.equal(BIP34_HEIGHT, 227931);
  // The activation block's own coinbase starts with 03 5b7a03.
  assert.equal(bip34Prefix(227931), '035b7a03');
  assert.equal(bip34Prefix(900123), '031bbc0d');
  // Minimal CScriptNum: an extra 0x00 when the top bit is set.
  assert.equal(bip34Prefix(127), '017f');
  assert.equal(bip34Prefix(128), '028000');
  assert.equal(bip34Prefix(0x7fffff), '03ffff7f');
  assert.equal(bip34Prefix(0x800000), '0400008000');
  // Small numbers are opcodes, not pushes.
  assert.equal(bip34Prefix(0), '00');
  assert.equal(bip34Prefix(1), '51');
  assert.equal(bip34Prefix(16), '60');
  assert.equal(bip34Prefix(17), '0111');
  assert.throws(() => bip34Prefix(-1));
});

test('heightInScriptSig reads the first push', () => {
  assert.equal(heightInScriptSig('035b7a03' + 'abcd'), 227931);
  assert.equal(heightInScriptSig('0400008000'), 0x800000);
  assert.equal(heightInScriptSig('4c00'), null);
  assert.equal(heightInScriptSig(''), null);
});

test('checkCoinbaseHeight: a coinbase that commits to its height', () => {
  const raw = coinbaseWith(bip34Prefix(900123) + '2f6d696e65722f');
  assert.deepEqual(checkCoinbaseHeight(raw, 900123), { ok: true, applies: true, coinbase: true, claimed: 900123 });
});

test('checkCoinbaseHeight: a different height fails and says what it claims', () => {
  const raw = coinbaseWith(bip34Prefix(900123));
  const r = checkCoinbaseHeight(raw, 900124);
  assert.equal(r.ok, false);
  assert.equal(r.claimed, 900123);
});

test('checkCoinbaseHeight: a non-minimal encoding of the right number fails, as in Core', () => {
  // 4-byte push of 227931: same number, not CScript() << 227931.
  const r = checkCoinbaseHeight(coinbaseWith('045b7a0300'), 227931);
  assert.equal(r.ok, false);
  assert.equal(r.claimed, 227931);
});

test('checkCoinbaseHeight: not a coinbase fails', () => {
  const notCoinbase = GENESIS_RAW.replace('0'.repeat(64) + 'ffffffff', '11'.repeat(32) + '00000000');
  const r = checkCoinbaseHeight(notCoinbase, 900123);
  assert.equal(r.ok, false);
  assert.equal(r.coinbase, false);
});

test('checkCoinbaseHeight: blocks before BIP34 carry no height', () => {
  // The genesis coinbase starts with the difficulty bits, not a height.
  const r = checkCoinbaseHeight(GENESIS_RAW, 0);
  assert.equal(r.applies, false);
  assert.equal(checkCoinbaseHeight(GENESIS_RAW, BIP34_HEIGHT).ok, false);
});
