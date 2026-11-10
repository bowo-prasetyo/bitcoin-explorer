// Search, navigation, amounts, history, cache pruning, phones.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const { devices } = require('playwright');
const fs = require('fs');
const path = require('path');



const hex = (c, n = 64) => c.repeat(n).slice(0, n);
const bh = h => '00000000' + String(h).padStart(56, 'a');   // fake block hash for height h
const TIP = 870001;
const NOW = Math.floor(Date.now() / 1000);
const ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const OTHER = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

function mkTx(i, { coinbase = false, height = 870000, confirmed = true } = {}) {
  return {
    txid: String(i).padStart(4, '0') + hex('e', 60),
    fee: coinbase ? 0 : 2820,
    weight: 1128,
    status: confirmed
      ? { confirmed: true, block_height: height, block_hash: bh(height), block_time: NOW - 600 }
      : { confirmed: false },
    vin: coinbase
      ? [{ is_coinbase: true, txid: hex('0'), vout: 4294967295 }]
      : [{ txid: hex('d'), vout: 1, prevout: { scriptpubkey_address: ADDR, scriptpubkey_type: 'v0_p2wpkh', value: 100000 } }],
    vout: [
      { scriptpubkey_address: OTHER, scriptpubkey_type: 'p2pkh', value: coinbase ? 312500000 : 60000 },
      { scriptpubkey_address: ADDR, scriptpubkey_type: 'v0_p2wpkh', value: coinbase ? 0 : 37180 },
      { scriptpubkey_type: 'op_return', value: 0 }
    ]
  };
}

const blockTxs = Array.from({ length: 30 }, (_, i) => mkTx(i, { coinbase: i === 0 }));
const TX = blockTxs[1];

const blocks = {};
for (const h of [869999, 870000, 870001]) {
  blocks[h] = { id: bh(h), height: h, timestamp: NOW - (TIP - h + 1) * 600, tx_count: h === 870000 ? 30 : 2,
    size: 1543210, weight: 3990000, previousblockhash: bh(h - 1) };
}

const addrConfirmed = Array.from({ length: 40 }, (_, i) => mkTx(100 + i));
const pending = mkTx(999, { confirmed: false });

const mock = {
  '/blocks/tip/height': String(TIP),
  '/blocks': [blocks[870001], blocks[870000], blocks[869999]],
  '/mempool': { count: 123456, vsize: 45678901, total_fee: 123456789, fee_histogram: [[5, 1000]] },
  '/fee-estimates': Object.fromEntries([1,2,3,4,5,6,10,12,24,144,504,1008].map(t => [t, 20 / Math.sqrt(t)])),
  [`/tx/${TX.txid}`]: TX,
  [`/address/${ADDR}`]: {
    chain_stats: { funded_txo_sum: 500000, spent_txo_sum: 120000, tx_count: 40 },
    mempool_stats: { funded_txo_sum: 37180, spent_txo_sum: 100000, tx_count: 1 }
  },
  [`/address/${ADDR}/txs`]: [pending, ...addrConfirmed.slice(0, 25)],
  [`/address/${ADDR}/txs/chain/${addrConfirmed[24].txid}`]: addrConfirmed.slice(25)
};
for (const h of Object.keys(blocks)) {
  mock[`/block-height/${h}`] = bh(h);
  mock[`/block/${bh(h)}`] = blocks[h];
}
mock[`/block/${bh(870000)}/txs/0`] = blockTxs.slice(0, 25);
mock[`/block/${bh(870000)}/txs/25`] = blockTxs.slice(25);
mock[`/block/${bh(870001)}/txs/0`] = [mkTx(500, { coinbase: true, height: 870001 }), mkTx(501, { height: 870001 })];
mock[`/block/${bh(869999)}/txs/0`] = [mkTx(600, { coinbase: true, height: 869999 }), mkTx(601, { height: 869999 })];

const hits = [];

async function setup(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
      body: f });
  });
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    hits.push(p);
    const headers = { 'access-control-allow-origin': '*' };
    if (!(p in mock)) return route.fulfill({ status: 404, headers, body: 'Block not found' });
    const v = mock[p];
    route.fulfill({ status: 200, headers, body: typeof v === 'string' ? v : JSON.stringify(v) });
  });
}

const text = p => p.innerText('body');

module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  await setup(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /integrity|Vue warn/i.test(m.text())) errors.push(m.text()); });
  page.on('console', m => { if (m.type() === 'warning' && /Vue warn/.test(m.text())) errors.push(m.text()); });

  // ---- Home
  await page.goto(BASE);
  await page.waitForSelector('text=123,456');
  let t = await text(page);
  check('home: formatted mempool + fees', /45\.68 MvB/.test(t) && /1\.23456789 BTC/.test(t));
  check('home: curated fee targets with ETA', /1 block\s*\(~10 min\)/.test(t) && /144 blocks\s*\(~1 day\)/.test(t) && /1008 blocks\s*\(~1 week\)/.test(t) && !/10 blocks/.test(t), '');
  check('home: recent blocks show age', /870,001\s+10 min ago/.test(t) || /870,001\s*\t\s*10 min ago/.test(t), t.match(/870,001[^\n]*/)?.[0]);
  await shot(page, 'p2-1-home.png', true);

  // ---- Search validation
  for (const [q, re] of [
    ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', /testnet/],
    ['abcdef0123', /64 hex characters; this one has 10/],
    ['hello', /Not a block height/],
    ['999999', /no block at height 999,999 yet/]
  ]) {
    await page.fill('input', q);
    await page.press('input', 'Enter');
    await page.waitForSelector('.notice-error');
    const msg = await page.innerText('.notice-error');
    check(`search rejects "${q}"`, re.test(msg) && /#\/$/.test(page.url()), msg + " @ " + page.url());
  }

  // Enter on a height navigates to the block
  hits.length = 0;
  await page.fill('input', '870000');
  await page.press('input', 'Enter');
  await page.waitForURL(/#\/block\//);
  check('search: Enter + height -> block page', page.url().endsWith('#/block/' + bh(870000)));

  // txid not starting with zeros skips the block lookup
  await page.goto(BASE);
  hits.length = 0;
  await page.fill('input', TX.txid);
  await page.press('input', 'Enter');
  await page.waitForURL(/#\/tx\//);
  await page.waitForTimeout(1500); check('search: txid goes straight to tx (no block probe)', !hits.includes('/block/' + TX.txid), hits.join(','));

  // ---- Recent block link
  await page.goto(BASE);
  await page.click('table >> text=870,000');
  await page.waitForURL(/#\/block\//);
  await page.waitForSelector('text=Confirmations');
  t = await text(page);
  check('block: from recent blocks link, shows height + confirmations', /Block 870,000/.test(t) && /Confirmations\s*2/.test(t));
  check('block: prev/next links', /‹ Block 869,999/.test(t) && /Block 870,001 ›/.test(t));
  check('block: page 1 shows 1–25 of 30', /1–25\s+of 30/.test(t) && /Page 1 of 2/.test(t));
  check('block: coinbase tag + fee rate', /coinbase/.test(t) && /10\.0 sat\/vB/.test(t));
  await shot(page, 'p2-2-block.png', true);

  await page.click('text=Next ›');
  await page.waitForSelector('text=26–30');
  t = await text(page);
  check('block: page 2 shows 26–30 numbered 26..30', /Page 2 of 2/.test(t) && /\n?26\s/.test(t) && !/Next ›/.test(t));

  // next block (same component, different params) actually reloads
  await page.click('text=Block 870,001 ›');
  await page.waitForSelector('h2:has-text("Block 870,001")');
  t = await text(page);
  check('block: next-block navigation remounts with new data', /Chain tip/.test(t) && /1–2\s+of 2/.test(t));

  await page.click('text=‹ Block 870,000');
  await page.waitForSelector('h2:has-text("Block 870,000")');
  check('block: previous-block navigation', true);

  // ---- Transaction
  await page.goto(BASE + '#/tx/' + TX.txid);
  await page.waitForSelector('text=Fee rate');
  t = await text(page);
  check('tx: confirmed in block link + time', /Confirmed\s+in block\s+870,000/.test(t) && /UTC/.test(t));
  check('tx: amounts, fee, fee rate, size', /0\.00097180 BTC/.test(t) && /2,820 sats/.test(t) && /10\.0 sat\/vB/.test(t) && /282 vB/.test(t));
  check('tx: input amount + prevout link', /0\.00100000 BTC/.test(t) && /from dddddddd…:1/.test(t));
  check('tx: OP_RETURN output labelled', /OP_RETURN/.test(t));
  await page.click(`a[href="#/block/${bh(870000)}"]`);
  await page.waitForURL(/#\/block\//);
  check('tx: block link navigates', true);
  await page.goto(BASE + '#/tx/' + TX.txid);
  await page.waitForSelector('text=Fee rate');
  await shot(page, 'p2-3-tx.png', true);

  // ---- Address
  await page.goto(BASE + '#/address/' + ADDR);
  await page.waitForSelector('text=Balance');
  await page.waitForSelector('text=Load older transactions');
  t = await text(page);
  check('address: balance = funded − spent', /Balance\s*0\.00380000 BTC/.test(t));
  check('address: pending delta signed', /−0\.00062820 BTC/.test(t) && /1 unconfirmed transaction\b/.test(t));
  check('address: history with pending + net change', /pending/.test(t) && /showing 26 of 41/.test(t));
  await shot(page, 'p2-4-address.png', true);
  await page.click('text=Load older transactions');
  await page.waitForSelector('text=showing 41 of 41');
  check('address: load more appends and hides button', !(await text(page)).includes('Load older transactions'));

  hits.length = 0;
  await page.goto(BASE + '#/address/notanaddress');
  await page.waitForSelector('text=isn\'t a valid Bitcoin mainnet address');
  check('address: invalid URL rejected without API call', hits.length === 0, hits.join(','));

  // ---- Cache: schema + eviction
  const dbInfo = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('btc-explorer');
    r.onsuccess = () => res({ v: r.result.version, stores: [...r.result.objectStoreNames] });
  }));
  check('db: v3 without write-only stores', dbInfo.v === 3 && !dbInfo.stores.includes('blocks') && !dbInfo.stores.includes('txs'), JSON.stringify(dbInfo));

  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('btc-explorer');
    r.onsuccess = () => {
      const tx = r.result.transaction('cache', 'readwrite');
      const st = tx.objectStore('cache');
      const now = Date.now();
      for (let i = 0; i < 50; i++) st.put({ id: 'old-' + i, timestamp: now - 30 * 86400000, data: {} });
      for (let i = 0; i < 600; i++) st.put({ id: 'bulk-' + i, timestamp: now - 3600000 + i, data: {} });
      tx.oncomplete = res; tx.onerror = rej;
    };
  }));
  await page.goto(BASE);
  await page.reload();
  await page.waitForSelector('text=123,456');
  await page.waitForTimeout(500);
  const counts = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('btc-explorer');
    r.onsuccess = () => {
      const st = r.result.transaction('cache').objectStore('cache');
      const all = st.getAllKeys();
      all.onsuccess = () => res({ total: all.result.length, old: all.result.filter(k => k.startsWith('old-')).length,
        newestBulkKept: all.result.includes('bulk-599'), oldestBulkKept: all.result.includes('bulk-0') });
    };
  }));
  check('db: prune drops expired and caps size', counts.old === 0 && counts.total <= 505 && counts.newestBulkKept && !counts.oldestBulkKept, JSON.stringify(counts));

  // ---- Mobile: no horizontal page scroll
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  await setup(mctx);
  const m = await mctx.newPage();
  m.on('pageerror', e => errors.push(e.message));
  for (const route of ['', '#/block/' + bh(870000), '#/tx/' + TX.txid, '#/address/' + ADDR]) {
    await m.goto(BASE + route);
    await m.waitForTimeout(1200);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`mobile: no horizontal scroll on /${route.split('/')[1] || 'home'}`, over <= 0, `overflow=${over}px`);
  }
  await m.goto(BASE + '#/tx/' + TX.txid); await m.waitForSelector('text=Fee rate');
  await shot(m, 'p2-5-tx-mobile.png', true);

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
