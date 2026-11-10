// Difficulty is correct for the height.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');



// ---- Real mainnet data
const G_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const G_HEADER = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const G_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const G_RAW = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
const G_SPK = '4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';

const K_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const K_HEADER = '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710';
const K_TXIDS = [
  '8c14f0db3df150123e6f3dbbf30f8b955a8249b62ac1d1ff16284aefa3d06d87',
  'fff2525b8931402dd09222c50775608f75787bd2b87e56995a7bdd30f79702c4',
  '6359f0868171b1d194cbee1af2f16ea598ae8fad666d9b012c8ed2b79a236ec4',
  'e9a66845e05d5abc0ad04ec80f774a7e585c6e8db975962d069a522137b80c1d'
];
const K_BLOCK = { id: K_HASH, height: 100000, timestamp: 1293623863, tx_count: 4, size: 957, weight: 3828,
  merkle_root: 'f3e94742aca4b5ef85488dc37c06c3282295ffec960994b2c0d5ac2a25a95766',
  previousblockhash: '000000000002d01c1fccc21636b607dfd930d31d01c3a62104612a1719011250', bits: 453281356, nonce: 274148111 };
const G_BLOCK = { id: G_HASH, height: 0, timestamp: 1231006505, tx_count: 1, size: 285, weight: 1140,
  merkle_root: G_TXID, previousblockhash: null, bits: 486604799, nonce: 2083236893 };
const G_TX = { txid: G_TXID, fee: 0, weight: 816,
  status: { confirmed: true, block_height: 0, block_hash: G_HASH, block_time: 1231006505 },
  vin: [{ is_coinbase: true, txid: '0'.repeat(64), vout: 4294967295 }],
  vout: [{ value: 5000000000, scriptpubkey: G_SPK, scriptpubkey_type: 'p2pk' }] };

const mkTxStub = (txid, i) => ({ txid, fee: 0, weight: 800, vin: i === 0 ? [{ is_coinbase: true }] : [{ txid: 'aa'.repeat(32), vout: 0, prevout: { value: 1 } }], vout: [{ value: 1000, scriptpubkey_type: 'p2pkh' }], status: { confirmed: true } });

// Shared core data (served by every provider)
function core(scenario) {
  const m = {
    '/blocks/tip/height': '100001',
    [`/block-height/100001`]: K_HASH, // tip lookups on Home resolve here
    [`/block/${K_HASH}`]: K_BLOCK,
    [`/block/${K_HASH}/header`]: K_HEADER,
    [`/block/${K_HASH}/txids`]: K_TXIDS,
    [`/block/${K_HASH}/txs/0`]: K_TXIDS.map(mkTxStub),
    [`/block/${K_HASH}/status`]: { in_best_chain: true, height: 100000 },
    '/block-height/100000': K_HASH,
    '/block-height/0': G_HASH,
    [`/block/${G_HASH}`]: G_BLOCK,
    [`/block/${G_HASH}/header`]: G_HEADER,
    [`/block/${G_HASH}/txids`]: [G_TXID],
    [`/block/${G_HASH}/txs/0`]: [G_TX],
    [`/block/${G_HASH}/status`]: { in_best_chain: true, height: 0 },
    [`/tx/${G_TXID}`]: G_TX,
    [`/tx/${G_TXID}/hex`]: G_RAW,
    [`/tx/${G_TXID}/merkle-proof`]: { block_height: 0, merkle: [], pos: 0 },
    '/blocks/tip/hash': K_HASH,
    '/blocks': [K_BLOCK],
    '/mempool': { count: 1, vsize: 1, total_fee: 1, fee_histogram: [] },
    '/fee-estimates': { 1: 2 }
  };
  // Period of block 100000 starts at 98784; serve made-up headers there.
  const fakeHash = h => '00000000' + String(h).padStart(56, 'f');
  for (const h of [98784, 98783, 96768]) {
    m[`/block-height/${h}`] = fakeHash(h);
    m[`/block/${fakeHash(h)}/header`] = '01000000' + '11'.repeat(32) + '22'.repeat(32) + '00000000' + '4c86041b' + '00000000';
  }
  if (scenario === 'no-period-headers') {
    for (const h of [98784, 98783, 96768]) delete m[`/block-height/${h}`];
  }
  // Tampering scenarios
  if (scenario === 'fake-block') {
    // Provider claims block 100000's JSON but with a wrong merkle root.
    m[`/block/${K_HASH}`] = { ...K_BLOCK, merkle_root: 'ff'.repeat(32) };
  }
  if (scenario === 'fake-amount') {
    m[`/tx/${G_TXID}`] = { ...G_TX, vout: [{ ...G_TX.vout[0], value: 2100000000000000 }] };
  }
  if (scenario === 'fake-txlist') {
    m[`/block/${K_HASH}/txids`] = [K_TXIDS[0], K_TXIDS[2], K_TXIDS[1], K_TXIDS[3]];
  }
  return m;
}

let scenario = 'honest';
let mempoolTip = 'same';       // 'same' | 'behind' | 'conflict' | 'down'
const hosts = [];

function mockFor(host, p) {
  const m = core(scenario);
  if (host === 'mempool.space') {
    if (mempoolTip === 'down') return { status: 503, body: 'down' };
    if (mempoolTip === 'behind' && p === '/blocks/tip/hash') return { body: G_HASH }; // tip "at height 0"
    if (mempoolTip === 'conflict' && p === '/blocks/tip/hash') return { body: G_HASH };
    if (mempoolTip === 'conflict' && p === `/block/${G_HASH}/status`) return { body: JSON.stringify({ height: 100000 }) };
  }
  if (!(p in m)) return { status: 404, body: 'not found' };
  const v = m[p];
  return { body: typeof v === 'string' ? v : JSON.stringify(v) };
}

async function setup(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
      body: f });
  });
  await context.route(/blockstream\.info|mempool\.space|my-node\.example|broken\.example/, route => {
    const u = new URL(route.request().url());
    hosts.push(u.host);
    if (u.host === 'broken.example') return route.abort('connectionrefused');
    const p = u.pathname.replace(/^\/api/, '');
    const r = mockFor(u.host, p);
    route.fulfill({ status: r.status || 200, headers: { 'access-control-allow-origin': '*' }, body: r.body });
  });
}


module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];
  const reqs = [];
  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    await setup(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
    p.on('request', r => reqs.push(new URL(r.url()).pathname));
    return p;
  }
  const badgeTexts = p => p.$$eval('.verify', els => els.map(e => e.className + ' :: ' + e.querySelector('.verify-title').textContent.trim()));
  // At least n badges, and none still checking (the summary badge settles last).
  const waitBadges = (p, n) => p.waitForFunction(n => document.querySelectorAll('.verify:not(.verify-pending)').length >= n && !document.querySelector('.verify-pending'), n, { timeout: 20000 });

  // Genesis: first period, bits from the verified header
  let page = await fresh();
  await page.goto(BASE + '#/block/' + G_HASH);
  await waitBadges(page, 3);
  let b = await badgeTexts(page);
  check('genesis: difficulty correct (first period)', b.some(t => /verify-ok :: Difficulty is correct for block 0/.test(t)), b.join(' | '));
  await page.click('.verify:has-text("Difficulty is correct") >> text=What was checked');
  const d = await page.innerText('.verify:has-text("Difficulty is correct")');
  check('genesis: details name the first-period rule', /fixed difficulty of the first 2,016 blocks \(0x1d00ffff\)/.test(d) && /#0–#2,015/.test(d), d.replace(/\n/g,' / '));
  await shot(page, 'p4-1-genesis.png', true);

  // Block 100000 with made-up period headers: must fail, after a fresh retry
  reqs.length = 0;
  page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 3);
  b = await badgeTexts(page);
  check('100000: PoW still verified', b.some(t => /verify-ok :: Proof of work verified/.test(t)));
  check('100000: fake period headers -> difficulty FAILED', b.some(t => /verify-fail :: Difficulty check FAILED/.test(t)), b.join(' | '));
  await page.click('.verify-fail:not(.verify-summary) >> text=What was checked');
  const f = await page.innerText('.verify-fail:not(.verify-summary)');
  check('100000: failure names invalid work, not a pass', /✗ Every header used has valid proof of work/.test(f), f.replace(/\n/g,' / '));
  check('100000: needed heights were 98,784 / 98,783 / 96,768', ['98784','98783','96768'].every(h => reqs.includes('/api/block-height/' + h)), reqs.filter(r => r.includes('block-height')).join(','));
  await shot(page, 'p4-2-fake-period.png', true);

  // Provider can't supply the period headers: grey, never green
  scenario = 'no-period-headers';
  page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 3);
  b = await badgeTexts(page);
  check('100000: missing period headers -> grey "couldn\'t check"', b.some(t => /verify-error :: Couldn't check the difficulty/.test(t)), b.join(' | '));
  scenario = 'honest';

  // Block whose own header fails -> difficulty needs a checked header
  scenario = 'fake-block';
  page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 3);
  b = await badgeTexts(page);
  check('bad header -> difficulty not attempted', b.some(t => /verify-error :: Difficulty needs a checked block header first/.test(t)), b.join(' | '));
  scenario = 'honest';

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
