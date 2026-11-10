// Difficulty traced back to the genesis block.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');


const G_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const G_HEADER = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const G_BLOCK = { id: G_HASH, height: 0, timestamp: 1231006505, tx_count: 1, size: 285, weight: 1140, merkle_root: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', previousblockhash: null, bits: 486604799, nonce: 2083236893 };
const K_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const K_HEADER = '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710';
const K_BLOCK = { id: K_HASH, height: 100000, timestamp: 1293623863, tx_count: 4, size: 957, weight: 3828, merkle_root: 'f3e94742aca4b5ef85488dc37c06c3282295ffec960994b2c0d5ac2a25a95766', previousblockhash: '000000000002d01c1fccc21636b607dfd930d31d01c3a62104612a1719011250', bits: 453281356, nonce: 274148111 };
const fakeHash = h => '00000000' + String(h).padStart(56, 'f');
const FAKE_HEADER = '01000000' + '11'.repeat(32) + '22'.repeat(32) + '00000000' + '4c86041b' + '00000000';
const FAKE_PREV = '11'.repeat(32); // display order of the fake prev field is the same bytes

let tip = 'genesis';
function mock(p) {
  const T = tip === 'genesis' ? G_BLOCK : K_BLOCK;
  const m = {
    '/blocks/tip/height': String(T.height), '/blocks/tip/hash': T.id,
    [`/block-height/${T.height}`]: T.id, [`/block/${T.id}`]: T,
    [`/block/${G_HASH}`]: G_BLOCK, [`/block/${K_HASH}`]: K_BLOCK,
    [`/block/${G_HASH}/header`]: G_HEADER, [`/block/${K_HASH}/header`]: K_HEADER,
    [`/block/${G_HASH}/txids`]: [G_BLOCK.merkle_root], [`/block/${G_HASH}/txs/0`]: [],
    [`/block/${T.id}/status`]: { height: T.height },
    '/block-height/0': G_HASH,
    [`/block/${FAKE_PREV}/header`]: FAKE_HEADER,
    '/blocks': [T], '/mempool': { count: 0, vsize: 0, total_fee: 0, fee_histogram: [] }, '/fee-estimates': {}
  };
  for (let h = 2016; h < 100000; h += 2016) {
    m[`/block-height/${h}`] = fakeHash(h);
    m[`/block/${fakeHash(h)}/header`] = FAKE_HEADER;
  }
  for (const h of [98783, 96768]) { m[`/block-height/${h}`] = fakeHash(h); m[`/block/${fakeHash(h)}/header`] = FAKE_HEADER; }
  if (!(p in m)) return { status: 404, body: 'not found' };
  const v = m[p];
  return { body: typeof v === 'string' ? v : JSON.stringify(v) };
}

async function setup(context, { patchGate = false } = {}) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: f });
  });
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const r = mock(p);
    route.fulfill({ status: r.status || 200, headers: { 'access-control-allow-origin': '*' }, body: r.body });
  });
  if (patchGate) {
    // Test seam: the one-step check can only pass with real mainnet
    // headers, which this sandbox can't fetch. Skip that gate to exercise
    // the trace-back UI.
    await context.route(BASE + 'components/BlockView.js', route => {
      const src = fs.readFileSync(path.join(ROOT, 'components/BlockView.js'), 'utf8')
        .replace("this.difficultyCheck?.state !== 'ok' || ", '');
      route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript' }, body: src });
    });
  }
}


// Used by setup() as well as the suite.
let BASE;

module.exports = async function ({ chromium, BASE: base, check }) {
  BASE = base;
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async opts => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    await setup(ctx, opts);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
    return p;
  };
  const badge = (scope, title) => scope.locator(`.verify:has(.verify-title:has-text("${title}"))`);
  const text = async l => (await l.innerText()).replace(/\n/g, ' / ');

  // Home, genesis tip: history has nothing to trace
  let page = await newPage();
  await page.goto(BASE);
  const card = page.locator('.card:has(h2:has-text("Work behind the tip"))');
  await card.waitFor();
  check('opt-in text mentions difficulty history', /does every\s+difficulty change since the genesis block follow the rules/.test((await card.innerText()).replace(/\n/g, ' ')));
  await card.locator('button:has-text("Add up the total work")').click();
  await badge(card, 'In the first difficulty period').waitFor({ timeout: 20000 });
  check('genesis tip: history says nothing to trace', true);

  // Home, block 100000 tip with made-up period headers: history FAILED
  tip = '100000';
  await page.evaluate(() => indexedDB.deleteDatabase('btc-explorer'));
  await page.reload();
  await badge(card, 'Difficulty history check FAILED').waitFor({ timeout: 40000 });
  await badge(card, 'Difficulty history check FAILED').locator('text=What was checked').click();
  let t = await text(badge(card, 'Difficulty history check FAILED'));
  check('fake history: proof-of-work and genesis checks pass/fail correctly', /✓ Starts from the genesis block/.test(t) && /✗ All 99 headers pass proof-of-work checks/.test(t), t);
  check('fake history: names the first bad blocks', /Block 2,015/.test(t) || /Block 2,016/.test(t), t);
  check('fake history: no stats shown on failure', !/Largest increase/.test(t));
  await shot(page, 'p7-1-home-fake-history.png', true);

  // Block page, real gate: block 100000's one-step check fails -> no offer
  page = await newPage();
  await page.goto(BASE + '#/block/' + K_HASH);
  await badge(page, 'Difficulty check FAILED').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  check('block: no trace-back offered when the one-step check fails', !(await page.locator('text=Trace back to the genesis block').count()));

  // Block page, gate skipped: offer with cost, then run with progress
  page = await newPage({ patchGate: true });
  await page.goto(BASE + '#/block/' + K_HASH);
  const offer = page.locator('button:has-text("Trace back to the genesis block")');
  await offer.waitFor({ timeout: 30000 });
  check('block: offer states the cost (99 headers)', /\(99 headers\)/.test(await offer.innerText()), await offer.innerText());
  await offer.click();
  await badge(page, 'Difficulty history check FAILED').waitFor({ timeout: 40000 });
  check('block: trace runs and reports, offer disappears', !(await page.locator('text=Trace back to the genesis block').count()));
  await shot(page, 'p7-2-block-trace.png', true);

  // Genesis block page: below period 2, nothing offered
  page = await newPage({ patchGate: true });
  await page.goto(BASE + '#/block/' + G_HASH);
  await badge(page, 'Difficulty is correct for block 0').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  check('genesis block: no trace-back offer', !(await page.locator('text=Trace back to the genesis block').count()));

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
