// Freshness, offline cache, errors and not-found answers.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');



const TXID = 'aa'.repeat(32);
const MISSING = 'bb'.repeat(32);
const BLOCK = '00'.repeat(4) + 'cc'.repeat(28);

const mock = {
  '/blocks/tip/height': '870000',
  '/block-height/870000': BLOCK,
  [`/block/${BLOCK}`]: { id: BLOCK, height: 870000, timestamp: 1730000000, tx_count: 2 },
  [`/block/${BLOCK}/txs/0`]: [{ txid: TXID }],
  '/blocks': [{ id: BLOCK, height: 870000, tx_count: 2, size: 1000, weight: 4000 }],
  '/mempool': { count: 1234, vsize: 567890, total_fee: 100000, fee_histogram: [[5, 1000], [2, 3000]] },
  '/fee-estimates': { '1': 5.1, '6': 3.2 },
  [`/tx/${TXID}`]: {
    txid: TXID, fee: 500, weight: 800,
    status: { confirmed: true, block_height: 870000 },
    vin: [{ is_coinbase: false, prevout: { scriptpubkey_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } }],
    vout: [
      { scriptpubkey_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', scriptpubkey_type: 'v0_p2wpkh' },
      { scriptpubkey_type: 'op_return' }
    ]
  },
  '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4': {
    chain_stats: { funded_txo_sum: 1, spent_txo_sum: 0, tx_count: 1 },
    mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
  }
};

let mode = 'ok';
const hits = [];

async function setup(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
      body: f
    });
  });
  await context.route(/blockstream\.info|mempool\.space|jonasschnelli/, route => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api/, '');
    hits.push(u.host + p);
    if (mode === 'down') return route.abort('connectionrefused');
    const headers = { 'access-control-allow-origin': '*' };
    if (p === `/tx/${MISSING}` || p === `/block/${MISSING}`) {
      return route.fulfill({ status: 400, headers, body: 'Invalid hex string' });
    }
    if (!(p in mock)) return route.fulfill({ status: 404, headers, body: 'not found' });
    const v = mock[p];
    route.fulfill({ status: 200, headers, body: typeof v === 'string' ? v : JSON.stringify(v) });
  });
}


module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  await setup(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /integrity|Vue warn/i.test(m.text())) errors.push(m.text()); });

  // 1. Home, healthy providers
  await page.goto(BASE);
  await page.waitForSelector('text=1,234');
  await page.waitForSelector('text=5 blocks', { state: 'detached' }).catch(() => {});
  const home = await page.innerText('body');
  check('home renders tip, blocks, mempool, fees', /870,000/.test(home) && /1,234/.test(home) && /6 blocks/.test(home));
  check('home shows freshness label', /Updated just now/.test(home));
  check('only two known providers contacted', hits.every(h => /^(blockstream\.info|mempool\.space)\//.test(h)), [...new Set(hits.map(h => h.split('/')[0]))].join(','));
  await shot(page, '1-home-ok.png', true);

  // 2. Fresh cache: reload within TTL should not refetch mempool
  hits.length = 0;
  await page.reload();
  await page.waitForSelector('text=1,234');
  await page.waitForTimeout(800);
  check('fresh cache served without network', !hits.some(h => h.endsWith('/mempool')), `hits=${hits.length}`);
  check('cached label shown', /\(cached\)/.test(await page.innerText('body')));

  // 3. Stale cache + outage: data stays, warning shown
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('btc-explorer');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('cache', 'readwrite');
      const st = tx.objectStore('cache');
      const all = st.getAll();
      all.onsuccess = () => { for (const e of all.result) { e.timestamp -= 3600000; st.put(e); } };
      tx.oncomplete = res; tx.onerror = rej;
    };
  }));
  mode = 'down';
  await page.reload();
  await page.waitForSelector('text=Couldn\'t refresh');
  const stale = await page.innerText('body');
  check('stale cache still displayed while offline', /1,234/.test(stale) && /870,000/.test(stale));
  check('stale warning shows age', /Showing data from\s+1 h ago/.test(stale));
  await shot(page, '2-home-stale-offline.png', true);

  // 4. Outage with no cache: error, not blank fields
  const fresh = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await setup(fresh);
  const p2 = await fresh.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.goto(BASE + '#/tx/' + TXID);
  await p2.waitForSelector('text=Couldn\'t reach any Bitcoin data provider');
  const txDown = await p2.innerText('body');
  check('tx page outage shows error, no empty "Fee:" fields', !/Fee rate/.test(txDown) && !/Loading transaction/.test(txDown));
  await shot(p2, '3-tx-offline.png');

  // 5. Not found: one provider answers definitively, no failover
  mode = 'ok';
  hits.length = 0;
  await p2.goto(BASE + '#/tx/' + MISSING);
  await p2.waitForSelector('text=This transaction was not found');
  hits.length = 0;
  await p2.reload();
  await p2.waitForSelector('text=This transaction was not found');
  await p2.waitForTimeout(500);
  const txHits = hits.filter(h => h.includes(MISSING));
  check('not-found asks one provider only', txHits.length === 1, JSON.stringify(txHits));
  await shot(p2, '4-tx-not-found.png');

  // 6. Tx page healthy, including OP_RETURN output
  await p2.goto(BASE + '#/tx/' + TXID);
  await p2.reload();
  await p2.waitForSelector('text=Fee rate');
  const txOk = await p2.innerText('body');
  check('tx page renders with OP_RETURN label', /0\.00000500 BTC/.test(txOk) && /OP_RETURN \(data, no address\)/.test(txOk));
  await shot(p2, '5-tx-ok.png');

  // 7. Block page confirmations + address page + charts
  await p2.goto(BASE + '#/block/' + BLOCK); await p2.reload();
  await p2.waitForSelector('text=Confirmations');
  check('block page shows confirmations', true);
  await p2.goto(BASE + '#/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); await p2.reload();
  await p2.waitForSelector('text=Balance');
  check('address page renders', true);
  await p2.goto(BASE + '#/charts'); await p2.reload();
  await p2.waitForSelector('text=Updated');
  check('charts page renders', /Mempool transaction count/.test(await p2.innerText('body')));

  // 8. Search: provider outage gives a message instead of guessing
  mode = 'down';
  await p2.goto(BASE); await p2.reload();
  await p2.fill('input', '00000000' + MISSING.slice(8));
  await p2.click('button');
  await p2.waitForSelector('text=to look this up');
  check('search outage reports error instead of navigating', p2.url().endsWith('#/'), p2.url());

  check('no page errors / SRI / Vue warnings', errors.length === 0, errors.join(' | '));
  await browser.close();
};
