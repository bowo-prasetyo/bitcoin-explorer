// Input amounts and fee.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { libBody, shot, ROOT } = require('../lib.cjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


const rev = h => Buffer.from(h, 'hex').reverse().toString('hex');
const sha256d = h => crypto.createHash('sha256').update(crypto.createHash('sha256').update(Buffer.from(h, 'hex')).digest()).digest();
const txidOf = raw => Buffer.from(sha256d(raw)).reverse().toString('hex');
const le = (n, bytes) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b.toString('hex').slice(0, bytes * 2); };

const G_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const G_RAW = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
const G_SPK = '4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
const G_TX = { txid: G_TXID, fee: 0, weight: 816, status: { confirmed: false },
  vin: [{ is_coinbase: true, txid: '0'.repeat(64), vout: 4294967295 }],
  vout: [{ value: 5000000000, scriptpubkey: G_SPK, scriptpubkey_type: 'p2pk' }] };

// Child: spends genesis:0, pays 49.9999 BTC to a P2PKH, fee 10,000 sats.
const C_SPK = '76a914' + '11'.repeat(20) + '88ac';
const C_RAW = '01000000' + '01' + rev(G_TXID) + le(0, 4) + '00' + 'ffffffff' + '01' + le(4999990000, 8) + '19' + C_SPK + '00000000';
const C_TXID = txidOf(C_RAW);
const C_TX = { txid: C_TXID, fee: 10000, weight: C_RAW.length * 2, status: { confirmed: false },
  vin: [{ txid: G_TXID, vout: 0, is_coinbase: false, prevout: { value: 5000000000, scriptpubkey: G_SPK, scriptpubkey_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', scriptpubkey_type: 'p2pk' } }],
  vout: [{ value: 4999990000, scriptpubkey: C_SPK, scriptpubkey_address: '12higDjoCCNXSA95xZMWUdPvXNmkAduhWv', scriptpubkey_type: 'p2pkh' }] };

// Big: 30 distinct (unknown) parents.
const BIG_TXID = 'b'.repeat(64);
const BIG_TX = { txid: BIG_TXID, fee: 1, weight: 4000, status: { confirmed: false },
  vin: Array.from({ length: 30 }, (_, i) => ({ txid: String(i).padStart(64, '7'), vout: 0, prevout: { value: 1000, scriptpubkey: C_SPK } })),
  vout: [{ value: 1, scriptpubkey: C_SPK }] };

let scenario = 'honest';
function mock(p) {
  const m = {
    '/blocks/tip/height': '1', '/blocks/tip/hash': 'x', '/blocks': [], '/mempool': { count: 0, vsize: 0, total_fee: 0, fee_histogram: [] }, '/fee-estimates': {},
    [`/tx/${G_TXID}`]: G_TX, [`/tx/${G_TXID}/hex`]: G_RAW,
    [`/tx/${C_TXID}`]: C_TX, [`/tx/${C_TXID}/hex`]: C_RAW,
    [`/tx/${BIG_TXID}`]: BIG_TX
  };
  if (scenario === 'inflated') m[`/tx/${C_TXID}`] = { ...C_TX, vin: [{ ...C_TX.vin[0], prevout: { ...C_TX.vin[0].prevout, value: 6000000000 } }], fee: 1000010000 };
  if (scenario === 'forged-parent') m[`/tx/${G_TXID}/hex`] = G_RAW.replace('00f2052a01000000', '005ea65f01000000');
  if (scenario === 'wrong-fee') m[`/tx/${C_TXID}`] = { ...C_TX, fee: 5000 };
  if (scenario === 'parent-down' && p === `/tx/${G_TXID}/hex`) return { abort: true };
  if (!(p in m)) return { status: 404, body: 'Transaction not found' };
  const v = m[p];
  return { body: typeof v === 'string' ? v : JSON.stringify(v) };
}

async function setup(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const f = libBody(route.request().url());
    if (!f) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: f });
  });
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const r = mock(p);
    if (r.abort) return route.abort('connectionrefused');
    route.fulfill({ status: r.status || 200, headers: { 'access-control-allow-origin': '*' }, body: r.body });
  });
}


module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];
  const reqs = [];
  async function open(url) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
    await setup(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (/Vue warn|integrity/.test(m.text())) errors.push(m.text()); });
    p.on('request', r => reqs.push(new URL(r.url()).pathname));
    await p.goto(BASE + url);
    await p.waitForFunction(() => document.querySelectorAll('.verify:not(.verify-pending)').length >= 3 && !document.querySelector('.verify-pending'), null, { timeout: 20000 });
    return p;
  }
  const badges = p => p.$$eval('.verify', els => els.map(e => e.className.replace('verify ', '') + ' :: ' + e.querySelector('.verify-title').textContent.trim()));
  const details = async (p, text) => { const sel = `.verify:has(.verify-title:has-text("${text}"))`; await p.click(`${sel} >> text=What was checked`); return (await p.innerText(sel)).replace(/\n/g, ' / '); };

  let p = await open('#/tx/' + C_TXID);
  let b = await badges(p);
  check('honest: contents verified', b.some(t => /verify-ok :: Contents verified/.test(t)), b.join(' | '));
  check('honest: inputs + fee verified', b.some(t => /verify-ok :: Input amounts and fee verified/.test(t)));
  let d = await details(p, 'Input amounts');
  check('honest: fee recomputed 10,000 sats', /✓ Fee = inputs − outputs = 10,000 sats, as shown/.test(d) && /50\.00000000 BTC/.test(d), d);
  check('honest: per-input ✓ mark', (await p.innerText('.io-mark')) === '✓');
  await shot(p, 'p5-1-honest.png', true);

  scenario = 'inflated';
  p = await open('#/tx/' + C_TXID);
  b = await badges(p);
  check('inflated input: FAILED', b.some(t => /verify-fail :: Input amounts check FAILED/.test(t)), b.join(' | '));
  check('inflated input: contents (outputs) still verified', b.some(t => /verify-ok :: Contents verified/.test(t)));
  const mark = await p.$eval('.io-mark', e => [e.textContent, e.title]);
  check('inflated input: ✗ with reason on the input', mark[0] === '✗' && /5,000,000,000 sats in the parent, not 6,000,000,000/.test(mark[1]), mark.join(' / '));
  await details(p, 'Input amounts check FAILED');
  await shot(p, 'p5-2-inflated.png', true);

  scenario = 'forged-parent';
  p = await open('#/tx/' + C_TXID);
  d = await details(p, 'Input amounts');
  check('forged parent: hash check fails', /✗ The spent transaction hashes to its txid/.test(d), d);

  scenario = 'wrong-fee';
  p = await open('#/tx/' + C_TXID);
  d = await details(p, 'Input amounts');
  check('wrong fee shown: fee check fails, amounts pass', /✓ Each input amount/.test(d) && /✗ Fee = inputs − outputs = 10,000 sats/.test(d), d);

  scenario = 'parent-down';
  p = await open('#/tx/' + C_TXID);
  b = await badges(p);
  check('parent unreachable: grey, not a pass', b.some(t => /verify-error :: Couldn't download 1 of 1 spent transactions/.test(t)), b.join(' | '));

  scenario = 'honest';
  p = await open('#/tx/' + G_TXID);
  b = await badges(p);
  check('coinbase: nothing to check', b.some(t => /verify-na :: Coinbase: it creates new coins/.test(t)), b.join(' | '));

  reqs.length = 0;
  p = await open('#/tx/' + BIG_TXID);
  b = await badges(p);
  const hexBefore = reqs.filter(r => /^\/api\/tx\/7+\d*\/hex$/.test(r)).length;
  check('30 parents: not checked automatically', b.some(t => /verify-na :: Spends from 30 earlier transactions; not checked automatically/.test(t)) && hexBefore === 0, b.join(' | ') + ` hexRequests=${hexBefore}`);
  await p.click('text=Check all inputs (30 downloads)');
  await p.waitForSelector('.verify-fail:has-text("Input amounts check FAILED")');
  const hexAfter = reqs.filter(r => /\/hex$/.test(r) && !r.includes(BIG_TXID)).length;
  check('30 parents: button runs the check (30 downloads)', hexAfter === 30, `hex=${hexAfter}`);

  check('no page errors / Vue warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
};
