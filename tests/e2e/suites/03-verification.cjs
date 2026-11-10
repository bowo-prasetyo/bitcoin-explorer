// Block, transaction and tip verification; your own endpoint.
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

// Block 1: builds on genesis, for a provider exactly one block ahead.
const B1_HASH = '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048';
const B1_HEADER = '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e61bc6649ffff001d01e36299';

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

// Block 100,000's raw coinbase (hashes to K_TXIDS[0]).
const K_CB_RAW = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08044c86041b020602ffffffff0100f2052a010000004341041b0e8c2567c12536aa13357b79a073dc4444acb83c4ec7a0e2f99dd7457516c5817242da796924ca4e99947d087fedf9ce467cb9f7c6287078f801df276fdf84ac00000000';
// Inner nodes of block 100,000's Merkle tree, display order.
const dsha = hex => require('crypto').createHash('sha256').update(require('crypto').createHash('sha256').update(Buffer.from(hex, 'hex')).digest()).digest();
const rev = hex => hex.match(/../g).reverse().join('');
const node = (a, b) => Buffer.from(dsha(rev(a) + rev(b))).reverse().toString('hex');
const K_LEFT = node(K_TXIDS[0], K_TXIDS[1]);
const K_RIGHT = node(K_TXIDS[2], K_TXIDS[3]);

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
    [`/block/${G_HASH}/txid/0`]: G_TXID,
    // The whole genesis block, raw: header, one transaction, the coinbase.
    [`/block/${G_HASH}/raw`]: { rawHex: G_HEADER + '01' + G_RAW },
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
  // Tampering scenarios
  if (scenario === 'fake-block') {
    // Provider claims block 100000's JSON but with a wrong merkle root.
    m[`/block/${K_HASH}`] = { ...K_BLOCK, merkle_root: 'ff'.repeat(32) };
  }
  if (scenario === 'fake-amount') {
    m[`/tx/${G_TXID}`] = { ...G_TX, vout: [{ ...G_TX.vout[0], value: 2100000000000000 }] };
  }
  if (scenario === 'tip-genesis') {
    m['/blocks/tip/height'] = '0';
    m['/blocks/tip/hash'] = G_HASH;
  }
  if (scenario === 'tip-block1' || scenario === 'tip-block1-altered') {
    m['/blocks/tip/height'] = '1';
    // Both providers' newest block is block 1, built on genesis.
    const b1 = { id: B1_HASH, height: 1, version: 1, previousblockhash: G_HASH,
      merkle_root: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098',
      timestamp: 1231469665, bits: 486604799, nonce: 2573394689 };
    m['/blocks/tip/hash'] = B1_HASH;
    m[`/block/${B1_HASH}/header`] = B1_HEADER;
    m[`/block/${B1_HASH}/status`] = { in_best_chain: true, height: 1 };
    m['/blocks/1'] = [scenario === 'tip-block1' ? b1 : { ...b1, nonce: 1 }, G_BLOCK];
  }
  if (scenario === 'inner-node') {
    // A "transaction" that is really the pair (tx 2, tx 3) of block
    // 100,000: its short proof reaches the real root.
    m[`/tx/${K_RIGHT}`] = { txid: K_RIGHT, fee: 0, weight: 256,
      status: { confirmed: true, block_height: 100000, block_hash: K_HASH, block_time: 1293623863 },
      vin: [], vout: [] };
    m[`/tx/${K_RIGHT}/merkle-proof`] = { block_height: 100000, merkle: [K_LEFT], pos: 1 };
    m[`/block/${K_HASH}/txid/0`] = K_TXIDS[0];
    m[`/tx/${K_TXIDS[0]}/hex`] = K_CB_RAW;
    m[`/tx/${K_TXIDS[0]}/merkle-proof`] = { block_height: 100000, merkle: [K_TXIDS[1], K_RIGHT], pos: 0 };
  }
  if (scenario === 'fake-txlist') {
    m[`/block/${K_HASH}/txids`] = [K_TXIDS[0], K_TXIDS[2], K_TXIDS[1], K_TXIDS[3]];
  }
  return m;
}

let scenario = 'honest';
let mempoolTip = 'same';       // 'same' | 'behind' | 'far-behind' | 'conflict' | 'down'
const hosts = [];

function mockFor(host, p) {
  const m = core(scenario);
  if (host === 'mempool.space') {
    if (mempoolTip === 'down') return { status: 503, body: 'down' };
    // One block behind: mempool.space at genesis while the other is at block 1.
    if (mempoolTip === 'behind' && p === '/blocks/tip/hash') return { body: G_HASH };
    // Far behind, across difficulty periods: the leader can't be checked against it.
    if (mempoolTip === 'far-behind' && p === '/blocks/tip/hash') return { body: G_HASH };
    if (mempoolTip === 'conflict' && p === '/blocks/tip/hash') return { body: G_HASH };
    if (mempoolTip === 'conflict' && p === `/block/${G_HASH}/status`) return { body: JSON.stringify({ height: 100000 }) };
    // A provider with a different block at height 0 than the one shown.
    if (scenario === 'other-block' && p === '/block-height/0') return { body: B1_HASH };
  }
  if (host === 'blockstream.info' && mempoolTip === 'behind') {
    if (p === '/blocks/tip/hash') return { body: B1_HASH };
    if (p === `/block/${B1_HASH}/header`) return { body: B1_HEADER };
    if (p === `/block/${B1_HASH}/status`) return { body: JSON.stringify({ height: 1 }) };
  }
  if (!(p in m)) return { status: 404, body: 'not found' };
  const v = m[p];
  if (v?.rawHex) return { body: Buffer.from(v.rawHex, 'hex') };
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
  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
    await setup(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
    return p;
  }
  const badgeTexts = p => p.$$eval('.verify', els => els.map(e => e.className + ' :: ' + e.querySelector('.verify-title').textContent.trim()));
  // At least n badges, and none still checking (the summary badge settles last).
  const waitBadges = (p, n) => p.waitForFunction(n => document.querySelectorAll('.verify:not(.verify-pending)').length >= n && !document.querySelector('.verify-pending'), n, { timeout: 15000 });

  // ---- Block 100000, honest
  let page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 2);
  let b = await badgeTexts(page);
  check('block: PoW verified', b.some(t => /verify-ok :: Proof of work verified/.test(t)), b.join(' | '));
  check('block: tx list verified', b.some(t => /verify-ok :: Transaction list verified/.test(t)));
  check('block: no height badge before BIP34 (block 227,931)', !b.some(t => /Height/.test(t)), b.join(' | '));
  await page.click('.verify-ok >> text=What was checked');
  const det = await page.innerText('.verify-ok');
  check('block: details show difficulty 14,484.162 and work', /14,484\.162/.test(det) && /hashes/.test(det), det.replace(/\n/g, ' / ').slice(0, 200));
  await shot(page, 'p3-1-block.png', true);

  // header cached in IndexedDB 'headers' store
  const cachedHdr = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('btc-explorer');
    r.onsuccess = () => { const q = r.result.transaction('headers').objectStore('headers').get(100000); q.onsuccess = () => res(q.result); };
  }));
  check('block: verified header stored for reuse', cachedHdr?.hash === K_HASH);

  // ---- Block with a lying merkle root in JSON
  scenario = 'fake-block';
  page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('block: JSON not matching header -> FAILED', b.some(t => /verify-fail :: Proof of work check FAILED/.test(t)), b.join(' | '));

  // ---- Reordered txid list
  scenario = 'fake-txlist';
  page = await fresh();
  await page.goto(BASE + '#/block/' + K_HASH);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('block: tampered txid list -> FAILED', b.some(t => /verify-fail :: Transaction list check FAILED/.test(t)), b.join(' | '));

  // ---- Genesis coinbase, honest
  scenario = 'honest';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('tx: contents verified from raw bytes', b.some(t => /verify-ok :: Contents verified/.test(t)), b.join(' | '));
  check('tx: inclusion in block 0 verified', b.some(t => /verify-ok :: Inclusion in block 0 verified/.test(t)));
  await shot(page, 'p3-2-tx.png', true);

  // ---- Provider inflates the amount
  scenario = 'fake-amount';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('tx: inflated amount -> contents FAILED', b.some(t => /verify-fail :: Contents check FAILED/.test(t)), b.join(' | '));
  await page.click('.verify-fail:not(.verify-summary) >> text=What was checked');
  const failDet = await page.innerText('.verify-fail:not(.verify-summary)');
  check('tx: failure names the failing check', /✗ Output amounts and scripts match/.test(failDet) && /✓ Raw transaction hashes to this txid/.test(failDet));
  await shot(page, 'p3-3-tx-tampered.png', true);

  // ---- Another provider has a different block at that height
  scenario = 'other-block';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('tx: block not at that height for another provider -> inclusion FAILED',
    b.some(t => /verify-fail :: Inclusion check FAILED/.test(t)), b.join(' | '));
  scenario = 'honest';

  // ---- A pair of hashes from inside the tree passed off as a transaction
  scenario = 'inner-node';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + K_RIGHT);
  await waitBadges(page, 2);
  b = await badgeTexts(page);
  check('tx: inner Merkle node as a "transaction" -> inclusion FAILED (proof too short)',
    b.some(t => /verify-fail :: Inclusion check FAILED/.test(t)), b.join(' | '));
  scenario = 'honest';

  // ---- Confirmations, header by header up to the providers' tip
  scenario = 'tip-block1';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 4);
  b = await badgeTexts(page);
  check('tx: confirmations verified up to the agreed tip', b.some(t => /verify-ok :: 2 confirmations verified/.test(t)), b.join(' | '));
  check('tx: summary counts the confirmations and witness checks', b.some(t => /verify-summary.*All 4 checks passed/.test(t)), b.join(' | '));
  check('tx: weight verified from the whole block (no witness data in it)', b.some(t => /verify-ok :: Weight verified \(no witness data\)/.test(t)), b.join(' | '));
  await page.context().close();

  // ---- A new block arrives while the page is open: counted again
  scenario = 'tip-genesis';
  page = await fresh();
  await page.clock.install();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 4);
  b = await badgeTexts(page);
  check('tx: in the newest block -> 1 confirmation verified', b.some(t => /verify-ok :: 1 confirmation verified/.test(t)), b.join(' | '));
  scenario = 'tip-block1';
  // Step the fake clock 5 s at a time (under the app's 8 s request timeout)
  // and give the mocked requests real time to answer between steps, until
  // the tip poll has picked up block 1 and the count is checked again.
  let recounted = false;
  for (let i = 0; i < 30 && !recounted; i++) {
    await page.clock.runFor(5000);
    recounted = await page.waitForFunction(
      () => [...document.querySelectorAll('.verify-ok .verify-title')].some(e => /2 confirmations verified/.test(e.textContent)),
      null, { timeout: 500 }).then(() => true, () => false);
  }
  check('tx: a new block re-verifies the confirmations without a reload', recounted, (await badgeTexts(page)).join(' | '));
  // Done with it: a page left open keeps polling into the shared host log.
  await page.context().close();

  scenario = 'tip-block1-altered';
  page = await fresh();
  await page.goto(BASE + '#/tx/' + G_TXID);
  await waitBadges(page, 4);
  b = await badgeTexts(page);
  check('tx: a header above the block that was altered -> confirmations FAILED', b.some(t => /verify-fail :: Confirmations check FAILED/.test(t)), b.join(' | '));
  await page.context().close();
  scenario = 'honest';

  // ---- Tip agreement
  scenario = 'honest';
  for (const [mode, re, cls] of [
    ['same', /All 2 providers agree on the tip/, 'ok'],
    ['behind', /Providers agree; one is catching up/, 'ok'],
    ['far-behind', /A provider is ahead, but its newest block can't be checked yet/, 'na'],
    ['conflict', /Providers DISAGREE on the chain/, 'fail'],
    ['down', /Only one provider answered/, 'na']
  ]) {
    mempoolTip = mode;
    page = await fresh();
    await page.goto(BASE);
    await waitBadges(page, 1);
    b = await badgeTexts(page);
    check(`tip: mempool ${mode} -> ${cls}`, b.some(t => t.includes('verify-' + cls) && re.test(t)), b.join(' | '));
    if (mode === 'behind') {
      await page.click('.verify >> text=What was checked');
      const d = await page.innerText('.verify');
      check('tip: behind details name provider and distance', /[Mm]empool\.space: block 0 .*1 behind on the same chain/.test(d), d.replace(/\n/g, ' / '));
    }
    if (mode === 'conflict') await shot(page, 'p3-4-tip-conflict.png');
  }
  mempoolTip = 'same';

  // ---- Providers page + custom endpoint
  page = await fresh();
  await page.goto(BASE + '#/providers');
  await waitBadges(page, 1);
  let t = await page.innerText('body');
  check('providers: table lists both defaults', /Blockstream/.test(t) && /[Mm]empool\.space/.test(t) && /preferred/.test(t));

  await page.fill('.provider-form input[aria-label]', 'ftp://x');
  await page.click('text=Test');
  await page.waitForSelector('.notice-error');
  check('custom: rejects non-http URL', /https:\/\/ or http:\/\//.test(await page.innerText('.notice-error')));

  await page.fill('.provider-form input[aria-label]', 'https://broken.example/api');
  await page.click('button:has-text("Test")');
  await page.waitForSelector('text=Couldn\'t connect');
  check('custom: unreachable endpoint explains CORS/mixed content', /CORS/.test(await page.innerText('body')));
  check('custom: Save disabled until a test passes', await page.isDisabled('button:has-text("Save")'));

  await page.fill('.provider-form input[aria-label]', 'https://my-node.example/api/');
  await page.check('.provider-form input[type=checkbox]');
  await page.click('button:has-text("Test")');
  await page.waitForSelector('text=Works: it reports block 100,001');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('text=All lookups now go only to your endpoint');
  await page.waitForSelector('text=Your endpoint');
  await shot(page, 'p3-5-providers.png', true);

  // Exclusive: only my-node is contacted afterwards
  hosts.length = 0;
  await page.goto(BASE + '#/tx/' + G_TXID);
  await page.reload();
  await waitBadges(page, 2);
  // Every badge settled (the summary badge counts too).
  await page.waitForFunction(() => !document.querySelector('.verify-pending'), null, { timeout: 15000 });
  const used = [...new Set(hosts)];
  check('custom exclusive: only your endpoint is contacted', used.length === 1 && used[0] === 'my-node.example', used.join(','));
  b = await badgeTexts(page);
  check('custom exclusive: verification still works (contents, inclusion, witness)', b.filter(x => /verify-ok/.test(x) && !/verify-summary/.test(x)).length === 3, b.join(' | '));

  await page.goto(BASE);
  await waitBadges(page, 1);
  b = await badgeTexts(page);
  check('custom exclusive: tip check says nothing to compare', b.some(x => /Only one provider configured/.test(x)), b.join(' | '));

  // Remove
  await page.goto(BASE + '#/providers');
  await page.click('text=Stop using my endpoint');
  await page.waitForSelector('text=Lookups go to the public providers again');
  check('custom: removable', !(await page.innerText('table')).includes('Your endpoint'));

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
