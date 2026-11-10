// Live updates over WebSocket.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');


const hashAt = h => '00000000' + String(h).padStart(56, 'a');
const TXID = 'cd'.repeat(32);
let tipH = 870000;
let txConfirmed = false;
const block = h => ({ id: hashAt(h), height: h, timestamp: 1730000000 + (h - 870000) * 600, tx_count: 1, size: 1, weight: 4, previousblockhash: hashAt(h - 1) });

function mock(p) {
  if (p === '/blocks/tip/height') return String(tipH);
  if (p === '/blocks/tip/hash') return hashAt(tipH);
  let m;
  if ((m = p.match(/^\/block-height\/(\d+)$/))) return +m[1] <= tipH ? hashAt(+m[1]) : null;
  if ((m = p.match(/^\/block\/(0{8}a*\d+)$/))) return block(+m[1].replace(/^0+a*/, ''));
  if (p === '/blocks') return [block(tipH)];
  if (p === '/mempool') return { count: 5, vsize: 100, total_fee: 1, fee_histogram: [] };
  if (p === '/fee-estimates') return { 1: 3 };
  if (p === `/tx/${TXID}`) return { txid: TXID, fee: 100, weight: 400, vin: [], vout: [],
    status: txConfirmed ? { confirmed: true, block_height: tipH, block_hash: hashAt(tipH), block_time: 1730000000 } : { confirmed: false } };
  return null;
}

async function newContext(browser, { live = true, custom = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const state = { reqs: [], wsUrls: [], wsSent: [], sockets: [], reject: false };
  await ctx.addInitScript(([live, custom]) => {
    localStorage.setItem('btc_explorer_live', live ? '1' : '0');
    if (custom) localStorage.setItem('btc_explorer_custom_provider', JSON.stringify(custom));
  }, [live, custom]);
  await ctx.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: f });
  });
  await ctx.route(/blockstream\.info|mempool\.space|my-node\.example/, route => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api/, '');
    state.reqs.push(p);
    const v = mock(p);
    if (v === null) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' });
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: typeof v === 'string' ? v : JSON.stringify(v) });
  });
  await ctx.routeWebSocket(/wss?:\/\//, ws => {
    state.wsUrls.push(ws.url());
    state.sockets.push(ws);
    if (state.reject) { ws.close(); return; }
    ws.onMessage(msg => {
      state.wsSent.push(msg);
      const m = JSON.parse(msg);
      if (m.action === 'want') ws.send(JSON.stringify({ blocks: [{ id: hashAt(tipH), height: tipH }] }));
      if (m.action === 'ping') ws.send('{"pong":true}');
    });
  });
  return { ctx, state };
}


module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts, url = BASE) => {
    const { ctx, state } = await newContext(browser, opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
    await page.clock.install();
    await page.goto(url);
    return { page, state };
  };
  const indicator = p => p.locator('header .live-indicator').innerText();
  const tipPolls = s => s.reqs.filter(r => r === '/blocks/tip/height').length;

  // ---- Live on: connects, subscribes to blocks only
  tipH = 870000;
  let { page, state } = await open({ live: true });
  await page.waitForSelector('text=870,000');
  await page.waitForFunction(() => document.querySelector('header .live-indicator')?.textContent.includes('Live'));
  check('live: header says Live', (await indicator(page)).includes('● Live'));
  check('live: one socket, to mempool.space', state.wsUrls.length === 1 && state.wsUrls[0] === 'wss://mempool.space/api/v1/ws', state.wsUrls.join(','));
  check('live: subscribes to blocks only', state.wsSent[0] === '{"action":"want","data":["blocks"]}', state.wsSent.join(' | '));

  // Two simulated minutes with no new block: tip polling should stop
  const before = tipPolls(state);
  await page.clock.runFor(120000);
  const liveTipPolls = tipPolls(state) - before;
  const liveTotal = state.reqs.length;
  check('live: no tip polling for 2 minutes without a block', liveTipPolls === 0, `tip polls=${liveTipPolls}`);
  check('live: only pings sent meanwhile', state.wsSent.slice(1).every(m => m === '{"action":"ping"}') && state.wsSent.length >= 4, `sent=${state.wsSent.length}`);

  // New block pushed -> page fetches and shows it promptly
  tipH = 870001;
  state.sockets[0].send(JSON.stringify({ block: { id: hashAt(870001), height: 870001 } }));
  await page.clock.runFor(1000);
  await page.waitForSelector('text=870,001', { timeout: 5000 });
  check('live: new block appears right after the notification', true);
  await shot(page, 'p8-1-live.png');

  // Socket drops and the server refuses reconnects for a while:
  // polling must resume, and reconnects must back off.
  state.reject = true;
  state.sockets[0].close();
  await page.clock.runFor(500);
  check('drop: indicator leaves Live', !(await indicator(page)).includes('● Live'), await indicator(page));
  const afterDrop = tipPolls(state);
  await page.clock.runFor(65000);
  const attempts = state.wsUrls.length - 1;
  check('drop: tip polling resumes while disconnected', tipPolls(state) > afterDrop, `tip polls ${afterDrop}->${tipPolls(state)}`);
  check('drop: reconnect attempts back off (≤ 6 in 65 s)', attempts >= 2 && attempts <= 6, `attempts=${attempts}`);
  state.reject = false;
  await page.clock.runFor(130000);
  await page.waitForFunction(() => document.querySelector('header .live-indicator')?.textContent.includes('Live'), null, { timeout: 5000 });
  check('drop: reconnects once the server accepts again', true);
  const liveSock = state.sockets[state.sockets.length - 1];

  // Tab hidden -> socket closed after the grace period
  let closed = false;
  liveSock.onClose(() => { closed = true; });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(31000);
  await page.waitForTimeout(300);
  check('hidden: socket closed after 30 s in the background', closed);

  // ---- Live off: the same two minutes poll the tip repeatedly
  tipH = 870000;
  ({ page, state } = await open({ live: false }));
  await page.waitForSelector('text=870,000');
  const b2 = tipPolls(state);
  await page.clock.runFor(120000);
  const pollTipPolls = tipPolls(state) - b2;
  check('off: no WebSocket at all', state.wsUrls.length === 0);
  check('off: header says Polling', (await indicator(page)).includes('Polling'));
  const pollTotal = state.reqs.length;
  check('comparison: polling hits the tip endpoint repeatedly, live does not', pollTipPolls >= 3 && liveTipPolls === 0, `2 min: polling=${pollTipPolls} tip polls, live=${liveTipPolls}`);
  console.log(`MEASURE first 2.5 min on Home: live=${liveTotal} requests, polling=${pollTotal} requests`);

  // ---- Exclusive own endpoint: never contacts mempool.space
  ({ page, state } = await open({ live: true, custom: { base: 'https://my-node.example/api', exclusive: true } }));
  await page.waitForSelector('text=870,000');
  await page.waitForFunction(() => document.querySelector('header .live-indicator')?.textContent.includes('Live'));
  check('exclusive: socket goes only to your endpoint', state.wsUrls.length === 1 && state.wsUrls[0] === 'wss://my-node.example/api/v1/ws', state.wsUrls.join(','));

  // ---- Pending transaction confirms on the block notification
  tipH = 870000; txConfirmed = false;
  ({ page, state } = await open({ live: true }, BASE + '#/tx/' + TXID));
  await page.waitForSelector('text=Unconfirmed');
  await page.waitForFunction(() => document.querySelector('header .live-indicator')?.textContent.includes('Live'));
  const tx0 = state.reqs.filter(r => r === `/tx/${TXID}`).length;
  await page.clock.runFor(120000);
  const txPolls = state.reqs.filter(r => r === `/tx/${TXID}`).length - tx0;
  check('pending tx: not polled while live and no block arrives', txPolls === 0, `polls=${txPolls}`);
  tipH = 870001; txConfirmed = true;
  state.sockets[0].send(JSON.stringify({ block: { id: hashAt(870001), height: 870001 } }));
  await page.clock.runFor(1000);
  await page.waitForSelector('text=Confirmed', { timeout: 5000 });
  check('pending tx: confirms right after the block notification', true);

  // ---- Providers page shows the panel
  await page.goto(BASE + '#/providers');
  await page.waitForSelector('text=Live updates');
  await page.clock.runFor(2500);
  const pt = await page.innerText('.card:has(h2:has-text("Live updates"))');
  check('providers: panel shows endpoint, messages and requests', /wss:\/\/mempool\.space\/api\/v1\/ws/.test(pt) && /messages/.test(pt) && /this session/.test(pt) && /per minute/.test(pt), pt.replace(/\n/g, ' / '));
  await shot(page, 'p8-2-providers.png', true);

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
