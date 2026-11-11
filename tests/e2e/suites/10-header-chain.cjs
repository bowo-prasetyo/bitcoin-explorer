// Full header chain: the opt-in card on Home, downloading the site's
// header files in a worker, and what it shows when they don't check out.
// Real mainnet periods can't be produced offline (they need real proof of
// work), so the passing path is covered by tests/headersync-browser.test.mjs;
// this suite drives the real app, worker and IndexedDB.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot } = require('../lib.cjs');

const G_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const G_HEADER = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const K_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const K_HEADER = '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710';
const K_BLOCK = { id: K_HASH, height: 100000, timestamp: 1293623863, tx_count: 4, size: 957, weight: 3828 };

function provider(p) {
  const m = {
    '/blocks/tip/height': '100000', '/blocks/tip/hash': K_HASH,
    '/block-height/100000': K_HASH, [`/block/${K_HASH}`]: K_BLOCK,
    [`/block/${K_HASH}/header`]: K_HEADER, [`/block/${K_HASH}/status`]: { height: 100000 },
    '/blocks': [K_BLOCK], '/mempool': { count: 0, vsize: 0, total_fee: 0, fee_histogram: [] }, '/fee-estimates': {}
  };
  if (!(p in m)) return { status: 404, body: 'not found' };
  const v = m[p];
  return { body: typeof v === 'string' ? v : JSON.stringify(v) };
}

// Period 0: the real genesis header, then 2,015 headers that don't link.
const BAD_PERIOD = Buffer.concat([Buffer.from(G_HEADER, 'hex'), Buffer.alloc(2015 * 80, 0x11)]);
const MANIFEST = JSON.stringify({ format: 1, network: 'mainnet', headerSize: 80, periodLength: 2016, periods: 1 });

let files = 'none'; // 'none' -> 404, 'bad' -> one period that fails at block 1
const fileRequests = [];

async function setup(context, BASE) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: f });
  });
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const r = provider(new URL(route.request().url()).pathname.replace(/^\/api/, ''));
    route.fulfill({ status: r.status || 200, headers: { 'access-control-allow-origin': '*' }, body: r.body });
  });
  await context.route(BASE + 'headers/**', route => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/headers\//, '');
    fileRequests.push(p);
    if (files === 'bad' && p === 'manifest.json') return route.fulfill({ status: 200, contentType: 'application/json', body: MANIFEST });
    if (files === 'bad' && p === 'periods/00000.bin') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: BAD_PERIOD });
    route.fulfill({ status: 404, body: 'not found' });
  });
}

module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  await setup(ctx, BASE);
  const page = await ctx.newPage();
  const workers = [];
  page.on('worker', w => workers.push(w.url()));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
  const card = () => page.locator('.card:has(h2:has-text("Full header chain"))');
  const flat = s => s.replace(/\n/g, ' / ');
  const settled = () => card().locator('.verify:not(.verify-pending)').first().waitFor({ timeout: 20000 });

  // Opt-in first: nothing downloaded, size explained.
  await page.goto(BASE);
  await card().waitFor();
  let t = await card().innerText();
  check('opt-in: explains the download before fetching', /about 8 MB, downloaded once/.test(t) && /Download and check the header chain/.test(t), flat(t));
  check('opt-in: no header file requested yet', fileRequests.length === 0, fileRequests.join(','));

  // No header files on this site.
  await card().locator('button:has-text("Download and check the header chain")').click();
  await settled();
  t = await card().innerText();
  check('no files: says it could not download them', /Couldn't download the header files/.test(t), flat(t));
  check('no files: asked for the manifest only', fileRequests.join(',') === 'manifest.json', fileRequests.join(','));
  check('opt-in remembered', await page.evaluate(() => localStorage.getItem('assay_header_chain')) === '1');
  check('buttons: check again and delete', /Check for new headers/.test(t) && /Delete stored headers/.test(t), flat(t));

  // A period that fails at block 1: reported, nothing stored.
  files = 'bad';
  fileRequests.length = 0;
  await card().locator('button:has-text("Check for new headers")').click();
  await page.waitForFunction(() => /FAILED/.test(document.querySelector('.header-chain')?.innerText || ''), null, { timeout: 20000 });
  t = await card().innerText();
  check('bad file: FAILED at block 1', /Header files FAILED the check at block 1\b/.test(t), flat(t));
  check('bad file: downloaded and checked in a worker', fileRequests.includes('periods/00000.bin') && workers.some(u => u.endsWith('/headerworker.js')), `${fileRequests.join(',')} workers=${workers.join(',')}`);
  await card().locator('text=What was checked').first().click();
  t = await card().innerText();
  check("bad file: names the problem", /Block 1 doesn't build on block 0/.test(t), flat(t));
  const stored = await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('btc-explorer');
    req.onsuccess = () => {
      const r = req.result.transaction('periods').objectStore('periods').count();
      r.onsuccess = () => { resolve(r.result); req.result.close(); };
    };
  }));
  check('bad file: nothing stored', stored === 0, String(stored));
  await shot(page, 'p10-1-bad-file.png', true);

  // Junk written straight into storage is not shown as checked: the next
  // visit re-checks it from the genesis block and deletes it.
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('btc-explorer');
    req.onsuccess = () => {
      const tx = req.result.transaction('periods', 'readwrite');
      tx.objectStore('periods').put({ index: 0, bytes: new Uint8Array(161280).fill(7).buffer, tip: { height: 2015, hash: 'ab'.repeat(32), work: '0x1' } });
      tx.oncomplete = () => { req.result.close(); resolve(); };
    };
  }));
  await page.evaluate(() => localStorage.setItem('assay_header_chain_synced', String(Date.now())));
  fileRequests.length = 0;
  await page.reload();
  await page.waitForFunction(() => /re-check/.test(document.querySelector('.header-chain')?.innerText || ''), null, { timeout: 20000 });
  t = await card().innerText();
  check('tampered storage: re-checked and deleted, not shown as checked', /Stored header chain FAILED the re-check and was deleted/.test(t) && !/Header chain checked/.test(t), flat(t));
  check('tampered storage: recent full check means no download', fileRequests.length === 0, fileRequests.join(','));

  // Delete: back to the opt-in.
  page.once('dialog', d => d.accept());
  await card().locator('button:has-text("Delete stored headers")').click();
  await card().locator('button:has-text("Download and check the header chain")').waitFor({ timeout: 10000 });
  check('delete: back to the opt-in', await page.evaluate(() => localStorage.getItem('assay_header_chain')) === null);

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
