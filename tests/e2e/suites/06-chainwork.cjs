// Total work behind the tip.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');


const G_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const G_HEADER = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const G_BLOCK = { id: G_HASH, height: 0, timestamp: 1231006505, tx_count: 1, size: 285, weight: 1140 };
const K_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const K_HEADER = '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710';
const K_BLOCK = { id: K_HASH, height: 100000, timestamp: 1293623863, tx_count: 4, size: 957, weight: 3828 };
const fakeHash = h => '00000000' + String(h).padStart(56, 'f');
const FAKE_HEADER = '01000000' + '11'.repeat(32) + '22'.repeat(32) + '00000000' + '4c86041b' + '00000000';

let tip = 'genesis';
function mock(p) {
  const T = tip === 'genesis' ? G_BLOCK : K_BLOCK;
  const m = {
    '/blocks/tip/height': String(T.height), '/blocks/tip/hash': T.id,
    [`/block-height/${T.height}`]: T.id, [`/block/${T.id}`]: T,
    [`/block/${G_HASH}/header`]: G_HEADER, [`/block/${K_HASH}/header`]: K_HEADER,
    [`/block/${T.id}/status`]: { height: T.height },
    '/block-height/0': G_HASH,
    '/blocks': [T], '/mempool': { count: 0, vsize: 0, total_fee: 0, fee_histogram: [] }, '/fee-estimates': {}
  };
  for (let h = 2016; h < 100000; h += 2016) {
    m[`/block-height/${h}`] = fakeHash(h);
    // Tip's own period start claims an easier difficulty than the tip.
    m[`/block/${fakeHash(h)}/header`] = h === 98784 ? FAKE_HEADER.replace('4c86041b', 'ffff001d') : FAKE_HEADER;
  }
  if (!(p in m)) return { status: 404, body: 'not found' };
  const v = m[p];
  return { body: typeof v === 'string' ? v : JSON.stringify(v) };
}

const reqs = [];
async function setup(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: f });
  });
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    reqs.push(p);
    const r = mock(p);
    route.fulfill({ status: r.status || 200, headers: { 'access-control-allow-origin': '*' }, body: r.body });
  });
}


module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  await setup(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
  const card = () => page.locator('.card:has(h2:has-text("Work behind the tip"))');

  // Genesis tip: opt-in first, nothing fetched for it yet
  await page.goto(BASE);
  await card().waitFor();
  let t = await card().innerText();
  check('opt-in: explains cost before fetching', /about 1 header \(1 KB\)/.test(t) && /Add up the total work/.test(t), t.replace(/\n/g, ' / '));

  await card().locator('button:has-text("Add up the total work")').click();
  await card().locator('.verify:not(.verify-pending)').first().waitFor({ timeout: 20000 });
  t = await card().innerText();
  check('genesis: total work 2^32.00 hashes', /verify|Total work behind block 0: 2\^32\.00 hashes/.test(t) && /Total work behind block 0: 2\^32\.00 hashes/.test(t), t.replace(/\n/g, ' / '));
  await card().locator('text=What was checked').first().click();
  t = await card().innerText();
  check("genesis: chainwork equals Core's genesis value", t.includes('0000000000000000000000000000000000000000000000000000000100010001'));
  check('genesis: single-period wording', /The header of the only difficulty period so far passes/.test(t));
  await shot(page, 'p6-1-genesis.png', true);

  // Remembered: reload computes automatically
  await page.reload();
  await card().locator('.verify-ok').first().waitFor({ timeout: 20000 });
  check('remembered: reload runs without a click', !(await card().innerText()).includes("Add up the total work"));

  // Block 100000 tip with made-up period headers -> fail, never a total
  tip = '100000';
  reqs.length = 0;
  await page.evaluate(() => indexedDB.deleteDatabase('btc-explorer'));
  await page.reload();
  await card().locator('.verify:not(.verify-pending)').first().waitFor({ timeout: 30000 });
  t = await card().innerText();
  check('fake period headers: FAILED, no total shown', /Total work check FAILED/.test(t) && !/2\^/.test(t), t.replace(/\n/g, ' / '));
  await card().locator('text=What was checked').first().click();
  t = await card().innerText();
  check('fake period headers: names both failing checks', /✗ 50 headers, one per difficulty period, pass proof-of-work checks/.test(t) && /✗ The tip's difficulty matches/.test(t), t.replace(/\n/g, ' / '));
  const lookups = new Set(reqs.filter(r => /^\/block-height\/\d+$/.test(r)).map(r => +r.split('/')[2]));
  const expected = []; for (let h = 2016; h < 100000; h += 2016) expected.push(h);
  check('fetched exactly one header per period (49 + genesis + tip)', expected.every(h => lookups.has(h)) && lookups.has(0), `lookups=${lookups.size}`);
  await shot(page, 'p6-2-fake.png', true);

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
