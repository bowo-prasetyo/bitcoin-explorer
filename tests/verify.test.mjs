// Regression tests for the verification audit: each test drives verify.js
// against mocked providers, the way a dishonest provider would answer, and
// checks that the badge is not green. Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ---- Environment: fake providers, in-memory IndexedDB, quiet timers ----

// api.js re-ranks providers on a timer; don't let it keep Node alive.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realSetInterval(...args).unref();

// routes[host][path] -> body (string or JSON). Hosts: the default providers.
const HOSTS = ['blockstream.info', 'mempool.space'];
let routes;
const serve = (path, body, hosts = HOSTS) => hosts.forEach(h => { routes[h][path] = body; });

globalThis.fetch = async url => {
  const u = new URL(url);
  const body = routes[u.host]?.[u.pathname.replace(/^\/api/, '')];
  if (body === undefined) return new Response('not found', { status: 404 });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
};

const stores = { headers: new Map(), cache: new Map() };
const request = fn => {
  const r = {};
  queueMicrotask(() => { r.result = fn(); r.onsuccess?.(); });
  return r;
};
globalThis.indexedDB = {
  open() {
    const r = {};
    queueMicrotask(() => {
      r.result = {
        objectStoreNames: { contains: () => true },
        transaction: name => ({
          objectStore: () => ({
            get: k => request(() => stores[name].get(k)),
            put: v => request(() => stores[name].set(v.height ?? v.id, v))
          })
        })
      };
      r.onsuccess?.({ target: r });
    });
    return r;
  }
};

const V = await import('../verify.js');
const { initDB } = await import('../db.js');
await initDB();

test.beforeEach(() => {
  routes = Object.fromEntries(HOSTS.map(h => [h, {}]));
  stores.headers.clear();
});

// ---- Real mainnet data and helpers ----

const G_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const G_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000' +
  '000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
  '4b1e5e4a29ab5f49ffff001d1dac2b7c';
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
const B1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048';
const B1_HEADER =
  '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d61900' +
  '00000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e8' +
  '57233e0e61bc6649ffff001d01e36299';

const NULL_INPUT = { is_coinbase: true, txid: '0'.repeat(64), vout: 0xffffffff };
const G_TX = {
  txid: G_TXID, fee: 0, weight: 816,
  status: { confirmed: true, block_height: 0, block_hash: G_HASH },
  vin: [NULL_INPUT],
  vout: [{ value: 5000000000, scriptpubkey: G_SPK }]
};

// Minimal legacy transactions, built by hand.
const le = (n, bytes) => {
  let h = '';
  for (let i = 0; i < bytes; i++) h += Number((BigInt(n) >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0');
  return h;
};
const rev = hex => hex.match(/../g).reverse().join('');
const txidOf = raw => {
  const once = createHash('sha256').update(Buffer.from(raw, 'hex')).digest();
  return rev(createHash('sha256').update(once).digest('hex'));
};
const rawTx = (inputs, outputs) =>
  '02000000' + le(inputs.length, 1) +
  inputs.map(([txid, vout]) => rev(txid) + le(vout, 4) + '00' + 'ffffffff').join('') +
  le(outputs.length, 1) +
  outputs.map(([value, spk]) => le(value, 8) + le(spk.length / 2, 1) + spk).join('') +
  '00000000';

const SPK_A = '0014' + 'aa'.repeat(20);
const SPK_M = '0014' + 'bb'.repeat(20);
const P1 = rawTx([['11'.repeat(32), 0]], [[50_000_000, SPK_A]]);
const P2 = rawTx([['22'.repeat(32), 0]], [[70_000_000, SPK_A]]);
const SPEND = rawTx([[txidOf(P1), 0], [txidOf(P2), 0]], [[119_000_000, SPK_M]]); // fee 0.01 BTC

const prevout = { value: 50_000_000, scriptpubkey: SPK_A };
const honestSpend = () => ({
  txid: txidOf(SPEND), fee: 1_000_000,
  vin: [
    { txid: txidOf(P1), vout: 0, is_coinbase: false, prevout },
    { txid: txidOf(P2), vout: 0, is_coinbase: false, prevout: { value: 70_000_000, scriptpubkey: SPK_A } }
  ],
  vout: [{ value: 119_000_000, scriptpubkey: SPK_M }]
});

function serveSpend() {
  serve(`/tx/${txidOf(SPEND)}/hex`, SPEND);
  serve(`/tx/${txidOf(P1)}/hex`, P1);
  serve(`/tx/${txidOf(P2)}/hex`, P2);
}

const failed = (r, label) => r.checks.find(c => c.label.includes(label))?.ok === false;

// ---- Transaction inclusion: a block only one provider knows ----

function serveGenesisInclusion() {
  serve(`/block/${G_HASH}/header`, G_HEADER);
  serve(`/tx/${G_TXID}/merkle-proof`, { block_height: 0, merkle: [], pos: 0 });
  // Its block's coinbase (itself), which inclusion checks the proof against.
  serve(`/block/${G_HASH}/txid/0`, G_TXID);
  serve(`/tx/${G_TXID}/hex`, G_RAW);
}

test('inclusion: passes when every provider has the block at that height', async () => {
  serveGenesisInclusion();
  serve('/block-height/0', G_HASH);
  const r = await V.verifyTransactionInclusion(G_TX);
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.ok(r.checks.some(c => c.ok && /2 of 2 providers have this block at height 0/.test(c.label)));
});

test('inclusion: a valid-work block another provider does not have at that height FAILS', async () => {
  // Audit finding: a difficulty-1 header (~2^32 hashes) presented as block
  // 900,123 used to pass. Here the genesis block plays that cheap block.
  serveGenesisInclusion();
  const lie = { ...G_TX, status: { confirmed: true, block_height: 900123, block_hash: G_HASH } };
  serve(`/tx/${G_TXID}/merkle-proof`, { block_height: 900123, merkle: [], pos: 0 });
  serve('/block-height/900123', G_HASH, ['mempool.space']);    // the liar
  serve('/block-height/900123', 'ab'.repeat(32), ['blockstream.info']); // the real chain
  const r = await V.verifyTransactionInclusion(lie);
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'Blockstream has a different block at height 900,123'), JSON.stringify(r.checks));
});

test('inclusion: a block no other provider can confirm is not a pass', async () => {
  // Before BIP34, so only the provider check can tie the block to a height.
  serveGenesisInclusion();
  const lie = { ...G_TX, status: { confirmed: true, block_height: 200000, block_hash: G_HASH } };
  serve(`/tx/${G_TXID}/merkle-proof`, { block_height: 200000, merkle: [], pos: 0 });
  serve('/block-height/200000', G_HASH, ['mempool.space']);
  const r = await V.verifyTransactionInclusion(lie);
  assert.equal(r.state, 'error');
  assert.match(r.title, /Only 1 of 2 providers could confirm block 200,000/);
});

// ---- Transaction contents and inputs: the coinbase flag ----

test('contents: the real genesis coinbase passes and is confirmed a coinbase', async () => {
  serve(`/tx/${G_TXID}/hex`, G_RAW);
  const c = await V.verifyTransactionContents(G_TX);
  assert.equal(c.state, 'ok', JSON.stringify(c.checks));
  assert.equal(c.coinbase, true);
  const i = await V.verifyTransactionInputs(G_TX, { outputTotal: c.outputTotal, coinbase: c.coinbase });
  assert.equal(i.state, 'na');
});

test('contents: an ordinary transaction shown as a coinbase FAILS', async () => {
  serveSpend();
  const lie = { ...honestSpend(), vin: [{ ...NULL_INPUT }] };
  const c = await V.verifyTransactionContents(lie);
  assert.equal(c.state, 'fail');
  assert.equal(c.coinbase, null);
  // The inputs check never takes the provider's word for a coinbase.
  const i = await V.verifyTransactionInputs(lie, { coinbase: c.coinbase });
  assert.notEqual(i.state, 'na');
  assert.notEqual(i.state, 'ok');
});

test('contents: a second input hidden behind a coinbase flag FAILS', async () => {
  serveSpend();
  const lie = honestSpend();
  lie.vin[1] = { ...lie.vin[1], is_coinbase: true };
  lie.fee = 50_000_000 - 119_000_000;
  const c = await V.verifyTransactionContents(lie);
  assert.equal(c.state, 'fail');
  assert.ok(failed(c, 'It is not a coinbase'), JSON.stringify(c.checks));
});

test('inputs: the honest two-input transaction passes with its fee', async () => {
  serveSpend();
  const tx = honestSpend();
  const c = await V.verifyTransactionContents(tx);
  assert.equal(c.state, 'ok', JSON.stringify(c.checks));
  const i = await V.verifyTransactionInputs(tx, { outputTotal: c.outputTotal, coinbase: c.coinbase });
  assert.equal(i.state, 'ok', JSON.stringify(i.checks));
});

test('inputs: a negative fee is never "verified"', async () => {
  // Outputs worth more than the inputs: Bitcoin Core's bad-txns-in-belowout.
  const big = rawTx([[txidOf(P1), 0]], [[60_000_000, SPK_M]]);
  serve(`/tx/${txidOf(big)}/hex`, big);
  serve(`/tx/${txidOf(P1)}/hex`, P1);
  const tx = {
    txid: txidOf(big), fee: -10_000_000,
    vin: [{ txid: txidOf(P1), vout: 0, is_coinbase: false, prevout }],
    vout: [{ value: 60_000_000, scriptpubkey: SPK_M }]
  };
  const c = await V.verifyTransactionContents(tx);
  const i = await V.verifyTransactionInputs(tx, { outputTotal: c.outputTotal, coinbase: c.coinbase });
  assert.equal(i.state, 'fail');
  assert.ok(failed(i, 'Inputs cover the outputs'));
});

test('contents: a weight that does not match the raw bytes FAILS', async () => {
  serve(`/tx/${G_TXID}/hex`, G_RAW);
  const c = await V.verifyTransactionContents({ ...G_TX, weight: 400 });
  assert.equal(c.state, 'fail');
  assert.ok(failed(c, 'Weight matches the raw transaction'));
});

// ---- Block transaction list: CVE-2012-2459 ----

test('block: a txid list padded with a duplicate FAILS though the root matches', async () => {
  const a = 'aa'.repeat(32), b = 'bb'.repeat(32), c = 'cc'.repeat(32);
  const { computeMerkleRoot } = await import('../spv.js');
  const root = await computeMerkleRoot([a, b, c]);
  serve('/block/X/txids', [a, b, c, c]);
  const r = await V.verifyBlockTransactions({ id: 'X', tx_count: 4 }, root, [], 0);
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'No transaction is listed twice'));
  assert.ok(r.checks.find(x => /rebuild the header's Merkle root/.test(x.label)).ok);
});

// ---- Block proof of work: invalid targets are red, not grey ----

test('block: a header whose bits encode a zero target FAILS instead of erroring', async () => {
  const zero = G_HEADER.slice(0, 144) + '0000001d' + '00000000';
  const { blockHashFromHeader } = await import('../spv.js');
  const id = await blockHashFromHeader(zero);
  serve(`/block/${id}/header`, zero);
  const r = await V.verifyBlockHeader({ id, height: null, timestamp: 1231006505,
    merkle_root: G_TXID, previousblockhash: null });
  assert.equal(r.state, 'fail');
});

// ---- Total work: never from difficulties the history didn't trace ----

test('total work: a cheap header standing in for a period start is not added up', async () => {
  // A provider claims the genesis header (valid work at difficulty 1) is
  // also block 2,016, and the tip. Each header passes its own proof of
  // work; only the trace back to genesis shows it's wrong.
  serve('/block-height/0', G_HASH);
  serve('/block-height/2016', G_HASH);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  const r = await V.verifyChainWork({ id: G_HASH, height: 2017 });
  assert.notEqual(r.state, 'ok');
  assert.equal(r.work, undefined);
});

test('total work: genesis alone still matches Bitcoin Core', async () => {
  serve('/block-height/0', G_HASH);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  const r = await V.verifyChainWork({ id: G_HASH, height: 0 });
  assert.equal(r.state, 'ok');
  assert.equal(r.work, 0x100010001n);
});

// ---- Chain tip ----

function serveTip(hosts, height, hash, header) {
  serve('/blocks/tip/hash', hash, hosts);
  serve(`/block/${hash}/header`, header, hosts);
  serve(`/block/${hash}/status`, { height }, hosts);
}

test('tip: one block behind, with a real header that builds on it', async () => {
  serveTip(['blockstream.info'], 1, B1_HASH, B1_HEADER);
  serveTip(['mempool.space'], 0, G_HASH, G_HEADER);
  const r = await V.verifyTip();
  assert.equal(r.state, 'ok');
  assert.equal(r.comparison.state, 'behind');
});

test('tip: a valid-work header one above a tip it does not build on is a conflict', async () => {
  // The genesis header claimed as block 2, on top of an honest block 1.
  serveTip(['mempool.space'], 2, G_HASH, G_HEADER);
  serveTip(['blockstream.info'], 1, B1_HASH, B1_HEADER);
  serve('/block-height/1', B1_HASH, ['mempool.space']); // its word agrees; its header doesn't
  const r = await V.verifyTip();
  assert.equal(r.state, 'fail');
  assert.equal(r.comparison.state, 'conflict');
});

// ---- Block height in the coinbase (BIP34) ----

const { computeMerkleRoot, bip34Prefix } = await import('../spv.js');

// A block at 900,123: a coinbase committing to that height, then one
// more transaction. Only its Merkle root matters here (the header itself
// is checked by verifyBlockHeader).
const cbWith = scriptSig =>
  '01000000' + '01' + '00'.repeat(32) + 'ffffffff' +
  le(scriptSig.length / 2, 1) + scriptSig + 'ffffffff' +
  '01' + le(312_500_000, 8) + le(SPK_A.length / 2, 1) + SPK_A + '00000000';
const CB = cbWith(bip34Prefix(900123) + '2f6d696e65722f');
const CB_ID = txidOf(CB);
const ROOT = await computeMerkleRoot([CB_ID, txidOf(SPEND)]);
const BLOCK = { id: 'b9'.repeat(32), height: 900123 };

function serveBlockCoinbase() {
  serve(`/block/${BLOCK.id}/txid/0`, CB_ID);
  serve(`/tx/${CB_ID}/hex`, CB);
  serve(`/tx/${CB_ID}/merkle-proof`, { block_height: 900123, merkle: [txidOf(SPEND)], pos: 0 });
}

test('height: a block whose coinbase commits to its height passes', async () => {
  serveBlockCoinbase();
  const r = await V.verifyBlockHeight(BLOCK, { merkleRoot: ROOT });
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.equal(r.title, 'Height 900,123 is written in the block');
});

test('height: a real block shown under another height FAILS', async () => {
  serveBlockCoinbase();
  const r = await V.verifyBlockHeight({ ...BLOCK, height: 900200 }, { merkleRoot: ROOT });
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'it says 900,123'), JSON.stringify(r.checks));
});

test("height: a transaction that isn't first in the block can't stand in for the coinbase", async () => {
  // The provider names the second transaction as the coinbase.
  const fakeCb = cbWith(bip34Prefix(900123));
  const id = txidOf(fakeCb);
  serve(`/block/${BLOCK.id}/txid/0`, id);
  serve(`/tx/${id}/hex`, fakeCb);
  serve(`/tx/${id}/merkle-proof`, { block_height: 900123, merkle: [CB_ID], pos: 1 });
  const r = await V.verifyBlockHeight(BLOCK, { merkleRoot: ROOT });
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'puts it first in this block'));
});

test('height: blocks before BIP34 get no height badge', async () => {
  assert.equal(await V.verifyBlockHeight({ id: G_HASH, height: 0 }, { merkleRoot: G_TXID }), null);
  assert.equal(await V.verifyBlockHeight({ id: G_HASH, height: 227930 }, { merkleRoot: G_TXID }), null);
});

test('inclusion: providers agreeing on a block does not let them renumber it', async () => {
  // Both providers claim the genesis block is block 900,123. Its coinbase
  // (the real genesis coinbase) commits to no such height.
  serveGenesisInclusion();
  const lie = { ...G_TX, status: { confirmed: true, block_height: 900123, block_hash: G_HASH } };
  serve(`/tx/${G_TXID}/merkle-proof`, { block_height: 900123, merkle: [], pos: 0 });
  serve('/block-height/900123', G_HASH);
  serve(`/block/${G_HASH}/txid/0`, G_TXID);
  serve(`/tx/${G_TXID}/hex`, G_RAW);
  const r = await V.verifyTransactionInclusion(lie);
  assert.equal(r.state, 'fail');
  assert.ok(r.checks.some(c => /2 of 2 providers have this block/.test(c.label) && c.ok));
  assert.ok(failed(r, 'commits to height 900,123'));
});

test('checkHeightInCoinbase: an honest post-BIP34 block passes every step', async () => {
  // The coinbase step that inclusion runs. (A full inclusion test would
  // need a real post-BIP34 header, which the fixtures don't have.)
  serveBlockCoinbase();
  const r = await V.checkHeightInCoinbase(BLOCK.id, 900123, ROOT);
  assert.equal(r.applies, true);
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks));
});

// ---- Merkle-proof depth: the 64-byte transaction weakness ----

// Real block 100,000: four transactions, so every proof is 2 hashes deep.
const K_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const K_HEADER =
  '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252a' +
  'acd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710';
const [K_CB, K_T1, K_T2, K_T3] = [
  '8c14f0db3df150123e6f3dbbf30f8b955a8249b62ac1d1ff16284aefa3d06d87',
  'fff2525b8931402dd09222c50775608f75787bd2b87e56995a7bdd30f79702c4',
  '6359f0868171b1d194cbee1af2f16ea598ae8fad666d9b012c8ed2b79a236ec4',
  'e9a66845e05d5abc0ad04ec80f774a7e585c6e8db975962d069a522137b80c1d'
];
// Its coinbase, raw (hashes to K_CB).
const K_CB_RAW =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff' +
  '08044c86041b020602ffffffff0100f2052a010000004341041b0e8c2567c12536aa13357b79a073dc' +
  '4444acb83c4ec7a0e2f99dd7457516c5817242da796924ca4e99947d087fedf9ce467cb9f7c6287078' +
  'f801df276fdf84ac00000000';

const { merkleRootFromProof } = await import('../spv.js');
const pair = (left, right) => merkleRootFromProof(left, [right], 0); // inner node
const LEFT = await pair(K_CB, K_T1);   // hash of (coinbase, tx 1)
const RIGHT = await pair(K_T2, K_T3);  // hash of (tx 2, tx 3)

function serveBlock100000() {
  serve(`/block/${K_HASH}/header`, K_HEADER);
  serve('/block-height/100000', K_HASH);
  serve(`/block/${K_HASH}/txid/0`, K_CB);
  serve(`/tx/${K_CB}/hex`, K_CB_RAW);
  serve(`/tx/${K_CB}/merkle-proof`, { block_height: 100000, merkle: [K_T1, RIGHT], pos: 0 });
}
const confirmedIn100000 = txid =>
  ({ txid, status: { confirmed: true, block_height: 100000, block_hash: K_HASH } });

test('depth: a real proof as deep as the coinbase passes', async () => {
  serveBlock100000();
  serve(`/tx/${K_T2}/merkle-proof`, { block_height: 100000, merkle: [K_T3, LEFT], pos: 2 });
  const r = await V.verifyTransactionInclusion(confirmedIn100000(K_T2));
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.ok(r.checks.some(c => c.ok && /as deep as the coinbase's \(2 hashes\)/.test(c.label)));
});

test("depth: an inner node of the tree passed off as a transaction FAILS", async () => {
  // The "transaction" is the pair (tx 2, tx 3): 64 bytes that hash to
  // RIGHT. Its one-hash proof reaches the real root of a real block with
  // real proof of work, and every provider has that block there.
  serveBlock100000();
  serve(`/tx/${RIGHT}/merkle-proof`, { block_height: 100000, merkle: [LEFT], pos: 1 });
  const r = await V.verifyTransactionInclusion(confirmedIn100000(RIGHT));
  assert.equal(r.state, 'fail');
  assert.ok(r.checks.find(c => /Merkle proof leads from this txid/.test(c.label)).ok);
  assert.ok(failed(r, "as deep as the coinbase's"), JSON.stringify(r.checks));
});

test("depth: at position 0 the transaction must be the block's coinbase", async () => {
  // The pair (coinbase, tx 1) claimed as the block's first transaction.
  serveBlock100000();
  serve(`/tx/${LEFT}/merkle-proof`, { block_height: 100000, merkle: [RIGHT], pos: 0 });
  const r = await V.verifyTransactionInclusion(confirmedIn100000(LEFT));
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'This transaction is the one first in the block'));
});

test("depth: the coinbase can't be swapped for a shallower stand-in", async () => {
  // The provider names the inner node LEFT as the coinbase, with a
  // one-hash proof, so that a one-hash proof elsewhere would look right.
  serveBlock100000();
  serve(`/block/${K_HASH}/txid/0`, LEFT);
  serve(`/tx/${LEFT}/hex`, K_CB_RAW);
  serve(`/tx/${LEFT}/merkle-proof`, { block_height: 100000, merkle: [RIGHT], pos: 0 });
  serve(`/tx/${RIGHT}/merkle-proof`, { block_height: 100000, merkle: [LEFT], pos: 1 });
  const r = await V.verifyTransactionInclusion(confirmedIn100000(RIGHT));
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'is a coinbase and hashes to its txid'));
});

test("depth: a coinbase that can't be fetched leaves inclusion grey, never green", async () => {
  serveBlock100000();
  routes['blockstream.info'][`/block/${K_HASH}/txid/0`] = undefined;
  routes['mempool.space'][`/block/${K_HASH}/txid/0`] = undefined;
  serve(`/tx/${K_T2}/merkle-proof`, { block_height: 100000, merkle: [K_T3, LEFT], pos: 2 });
  const r = await V.verifyTransactionInclusion(confirmedIn100000(K_T2));
  assert.equal(r.state, 'error');
  assert.match(r.title, /Couldn't fetch block 100,000's coinbase/);
});

// ---- Confirmations: blocks on top, header by header ----

// Esplora block JSON for the real genesis block and block 1.
const G_JSON = { id: G_HASH, height: 0, version: 1, previousblockhash: null,
  merkle_root: G_TXID, timestamp: 1231006505, bits: 0x1d00ffff, nonce: 2083236893 };
const B1_JSON = { id: B1_HASH, height: 1, version: 1, previousblockhash: G_HASH,
  merkle_root: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098',
  timestamp: 1231469665, bits: 0x1d00ffff, nonce: 2573394689 };

function serveChainToBlock1() {
  serveTip(HOSTS, 1, B1_HASH, B1_HEADER);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  serve('/blocks/1', [B1_JSON, G_JSON]);
}

test('confirmations: a block with one real block on top has 2, verified', async () => {
  serveChainToBlock1();
  const r = await V.verifyConfirmations(G_TX);
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.equal(r.title, '2 confirmations verified');
  assert.equal(r.confirmations, 2);
  assert.ok(r.checks.some(c => c.ok && /1 block on top each point to the block before/.test(c.label)));
  assert.ok(r.checks.some(c => c.ok && /ends at the newest block the providers agree on \(1\)/.test(c.label)));
  assert.ok(r.facts.some(f => f.label === 'Work built on top'));
});

test('confirmations: a transaction in the newest block has 1', async () => {
  serveTip(HOSTS, 0, G_HASH, G_HEADER);
  const r = await V.verifyConfirmations(G_TX);
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.equal(r.title, '1 confirmation verified');
});

test("confirmations: a block the chain above doesn't build on FAILS (replaced block)", async () => {
  // The providers' block 1 doesn't point to this transaction's block 0.
  serveChainToBlock1();
  const other = { ...G_TX, status: { ...G_TX.status, block_hash: B1_HASH } };
  serve(`/block/${B1_HASH}/header`, B1_HEADER);
  const r = await V.verifyConfirmations(other);
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'point to the block before'));
});

test('confirmations: a header whose JSON was altered FAILS', async () => {
  serveChainToBlock1();
  serve('/blocks/1', [{ ...B1_JSON, timestamp: B1_JSON.timestamp + 600 }, G_JSON]);
  const r = await V.verifyConfirmations(G_TX);
  assert.equal(r.state, 'fail');
  assert.ok(failed(r, 'valid proof of work'));
});

test("confirmations: providers that don't agree on the tip leave it grey", async () => {
  serveTip(['blockstream.info'], 1, B1_HASH, B1_HEADER);
  serveTip(['mempool.space'], 1, G_HASH, G_HEADER); // same height, other block
  serve(`/block/${G_HASH}/header`, G_HEADER);
  const r = await V.verifyConfirmations(G_TX);
  assert.equal(r.state, 'error');
  assert.match(r.title, /Providers don't agree on the newest block/);
});

test('confirmations: deeper than the limit, "at least", anchored by every provider', async () => {
  // Tip at height 2 (the genesis header standing in for it; only its
  // height matters here), limit 2: block 1 is checked and every provider
  // must have it at height 1.
  serveTip(HOSTS, 2, G_HASH, G_HEADER);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  serve('/blocks/1', [B1_JSON, G_JSON]);
  serve('/block-height/1', B1_HASH);
  const r = await V.verifyConfirmations(G_TX, { limit: 2 });
  assert.equal(r.state, 'ok', JSON.stringify(r.checks));
  assert.equal(r.title, 'At least 2 confirmations verified');
  assert.equal(r.atLeast, true);
  assert.ok(r.facts.some(f => f.value === '2 of 3'));
});

test('confirmations: deeper than the limit, a provider with another block there FAILS', async () => {
  serveTip(HOSTS, 2, G_HASH, G_HEADER);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  serve('/blocks/1', [B1_JSON, G_JSON]);
  serve('/block-height/1', B1_HASH, ['blockstream.info']);
  serve('/block-height/1', 'ab'.repeat(32), ['mempool.space']);
  const r = await V.verifyConfirmations(G_TX, { limit: 2 });
  assert.equal(r.state, 'fail');
});

test('confirmations: a provider that leaves out a block leaves it grey', async () => {
  serveTip(HOSTS, 1, B1_HASH, B1_HEADER);
  serve(`/block/${G_HASH}/header`, G_HEADER);
  serve('/blocks/1', [G_JSON]); // block 1 missing
  const r = await V.verifyConfirmations(G_TX);
  assert.equal(r.state, 'error');
});

test('confirmations: unconfirmed transactions have nothing to check', async () => {
  const r = await V.verifyConfirmations({ ...G_TX, status: { confirmed: false } });
  assert.equal(r.state, 'na');
});
