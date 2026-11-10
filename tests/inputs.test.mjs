import test from 'node:test';
import assert from 'node:assert/strict';

import { parentTxids, checkSpentOutputs, isCoinbaseTx } from '../inputs.js';
import { reverseHex, txidFromRaw } from '../spv.js';

// Real parent: the genesis coinbase (one output, 50 BTC, P2PK).
const G_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const G_RAW =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
  '4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f' +
  '72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffff' +
  'ffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962' +
  'e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00' +
  '000000';
const G_SPK =
  '4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4c' +
  'ef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';

const child = (vin, extra = {}) => ({
  txid: 'c'.repeat(64),
  vin,
  vout: [],
  ...extra
});

const spendGenesis = (prevout = { value: 5000000000, scriptpubkey: G_SPK }) =>
  ({ txid: G_TXID, vout: 0, prevout });

const NULL_INPUT = { is_coinbase: true, txid: '0'.repeat(64), vout: 0xffffffff };

test('parentTxids dedupes', () => {
  assert.deepEqual(parentTxids(child([spendGenesis(), spendGenesis()])), [G_TXID]);
});

test("parentTxids ignores the provider's coinbase flag on an ordinary input", () => {
  const tx = child([spendGenesis(), { ...spendGenesis(), txid: 'd'.repeat(64), is_coinbase: true }]);
  assert.deepEqual(parentTxids(tx), [G_TXID, 'd'.repeat(64)]);
});

test('isCoinbaseTx follows Bitcoin: one input, spending the null outpoint', () => {
  assert.equal(isCoinbaseTx(child([NULL_INPUT])), true);
  assert.equal(isCoinbaseTx(child([{ ...spendGenesis(), is_coinbase: true }])), false);
  assert.equal(isCoinbaseTx(child([NULL_INPUT, NULL_INPUT])), false);
  assert.equal(isCoinbaseTx(child([{ ...NULL_INPUT, vout: 0 }])), false);
  assert.deepEqual(parentTxids(child([NULL_INPUT])), []);
});

test('an honest input is verified against the raw parent', async () => {
  const r = await checkSpentOutputs(child([spendGenesis()]), { [G_TXID]: G_RAW });
  assert.equal(r.ok, true);
  assert.equal(r.totalIn, 5000000000);
  assert.deepEqual(r.perInput, [{ index: 0, ok: true, value: 5000000000 }]);
});

test('an inflated input amount is caught', async () => {
  const tx = child([spendGenesis({ value: 7000000000, scriptpubkey: G_SPK })]);
  const r = await checkSpentOutputs(tx, { [G_TXID]: G_RAW });
  assert.equal(r.ok, false);
  assert.equal(r.parentsOk, true);
  assert.equal(r.amountsOk, false);
  assert.equal(r.totalIn, null);
  assert.match(r.perInput[0].reason, /5,000,000,000 sats in the parent, not 7,000,000,000/);
});

test('a different script (address) is caught', async () => {
  const tx = child([spendGenesis({ value: 5000000000, scriptpubkey: '76a914' + '00'.repeat(20) + '88ac' })]);
  const r = await checkSpentOutputs(tx, { [G_TXID]: G_RAW });
  assert.equal(r.ok, false);
  assert.match(r.perInput[0].reason, /script/);
});

test('a substituted parent fails its hash', async () => {
  // Same structure, value changed to 60 BTC: no longer hashes to G_TXID.
  const forged = G_RAW.replace('00f2052a01000000', '005ea65f01000000');
  const tx = child([spendGenesis({ value: 6000000000, scriptpubkey: G_SPK })]);
  const r = await checkSpentOutputs(tx, { [G_TXID]: forged });
  assert.equal(r.ok, false);
  assert.equal(r.parentsOk, false);
  assert.match(r.perInput[0].reason, /does not hash/);
});

test('missing parent, unreadable parent, or missing output fails', async () => {
  const tx = child([spendGenesis()]);
  assert.equal((await checkSpentOutputs(tx, {})).ok, false);
  const bad = await checkSpentOutputs(tx, { [G_TXID]: 'zz' });
  assert.match(bad.perInput[0].reason, /unreadable/);

  const r = await checkSpentOutputs(child([{ ...spendGenesis(), vout: 3 }]), { [G_TXID]: G_RAW });
  assert.match(r.perInput[0].reason, /no output 3/);
});

test('coinbase inputs are not counted as spending anything', async () => {
  const r = await checkSpentOutputs(child([NULL_INPUT]), {});
  assert.equal(r.ok, true);
  assert.equal(r.totalIn, 0);
  assert.equal(r.perInput[0].coinbase, true);
});

test('an input flagged "coinbase" by the provider is still checked', async () => {
  // Audit finding: flagging an input as coinbase used to hide it.
  const hidden = { txid: 'd'.repeat(64), vout: 0, is_coinbase: true };
  const r = await checkSpentOutputs(child([spendGenesis(), hidden]), { [G_TXID]: G_RAW });
  assert.equal(r.ok, false);
  assert.equal(r.perInput[1].coinbase, undefined);
  assert.match(r.perInput[1].reason, /not available/);
});

test('a real child transaction built here hashes consistently', async () => {
  // Spend genesis:0 -> one P2PKH output; serialise by hand.
  const le = (n, bytes) => {
    let h = '';
    for (let i = 0; i < bytes; i++) { h += (Number(BigInt(n) >> BigInt(8 * i) & 0xffn)).toString(16).padStart(2, '0'); }
    return h;
  };
  const spk = '76a914' + '11'.repeat(20) + '88ac';
  const raw = '01000000' + '01' + reverseHex(G_TXID) + le(0, 4) + '00' + 'ffffffff' +
    '01' + le(4999990000, 8) + (spk.length / 2).toString(16).padStart(2, '0') + spk + '00000000';
  const txid = await txidFromRaw(raw);
  assert.match(txid, /^[0-9a-f]{64}$/);

  const r = await checkSpentOutputs({ txid, vin: [spendGenesis()], vout: [{ value: 4999990000 }] }, { [G_TXID]: G_RAW });
  assert.equal(r.ok, true);
  assert.equal(r.totalIn - 4999990000, 10000); // the fee
});
