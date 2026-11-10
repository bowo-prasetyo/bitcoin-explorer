import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBtc,
  formatNumber,
  formatFeeRate,
  formatTime,
  formatAgo,
  formatVsize,
  vsizeFromWeight,
  addressNetValue,
  sumValues,
  formatLocalTime,
  histogramBuckets
} from '../format.js';

test('formatBtc is exact on integer sats', () => {
  assert.equal(formatBtc(0), '0.00000000 BTC');
  assert.equal(formatBtc(1), '0.00000001 BTC');
  assert.equal(formatBtc(5000000000), '50.00000000 BTC');
  assert.equal(formatBtc(2100000000000000), '21,000,000.00000000 BTC');
  assert.equal(formatBtc(-12345), '−0.00012345 BTC');
  assert.equal(formatBtc(12345, { sign: true }), '+0.00012345 BTC');
  assert.equal(formatBtc(0, { sign: true }), '0.00000000 BTC');
  assert.equal(formatBtc(undefined), '–');
});

test('formatNumber adds separators', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(null), '–');
});

test('fee rate uses vsize = ceil(weight / 4)', () => {
  assert.equal(vsizeFromWeight(561), 141);
  assert.equal(formatFeeRate(1410, 561), '10.0 sat/vB');
  assert.equal(formatFeeRate(500, 0), '–');
});

test('formatTime renders UTC', () => {
  assert.equal(formatTime(1231006505), '2009-01-03 18:15 UTC');
  assert.equal(formatTime(0), '–');
});

test('formatAgo buckets', () => {
  const now = 1_000_000_000_000;
  assert.equal(formatAgo(now - 3_000, now), 'just now');
  assert.equal(formatAgo(now - 42_000, now), '42s ago');
  assert.equal(formatAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatAgo(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(formatAgo(now - 12 * 86_400_000, now), '12 days ago');
  assert.equal(formatAgo(now - 800 * 86_400_000, now), '2 years ago');
});

test('formatVsize scales units', () => {
  assert.equal(formatVsize(250), '250 vB');
  assert.equal(formatVsize(4321), '4.3 kvB');
  assert.equal(formatVsize(12_345_678), '12.35 MvB');
});

test('addressNetValue nets received minus spent', () => {
  const tx = {
    vin: [
      { prevout: { scriptpubkey_address: 'A', value: 1000 } },
      { prevout: { scriptpubkey_address: 'B', value: 500 } }
    ],
    vout: [
      { scriptpubkey_address: 'C', value: 900 },
      { scriptpubkey_address: 'A', value: 400 },
      { scriptpubkey_type: 'op_return', value: 0 }
    ]
  };
  assert.equal(addressNetValue(tx, 'A'), -600);
  assert.equal(addressNetValue(tx, 'C'), 900);
  assert.equal(addressNetValue({ vin: [{ is_coinbase: true }], vout: [] }, 'A'), 0);
  assert.equal(sumValues(tx.vout), 1300);
  assert.equal(sumValues(tx.vin, v => v.prevout?.value), 1500);
});

test("formatLocalTime: the viewer's zone, or null when it reads like UTC", () => {
  const genesis = 1231006505; // 2009-01-03 18:15:05 UTC
  assert.equal(formatLocalTime(genesis, 'UTC'), null);
  assert.equal(formatLocalTime(genesis, 'Europe/London'), null); // GMT in winter
  assert.match(formatLocalTime(genesis, 'Europe/Berlin'), /^3 Jan 2009, 19:15 (CET|GMT\+1)$/);
  assert.match(formatLocalTime(genesis, 'Asia/Jakarta'), /^4 Jan 2009, 01:15 (WIB|GMT\+7)$/);
  assert.equal(formatLocalTime(0), null);
  assert.equal(formatLocalTime(undefined), null);
});

test('histogramBuckets: ranges from each rate up to the previous one', () => {
  assert.deepEqual(histogramBuckets([[50, 100], [20.04, 200], [1, 300]]), [
    { label: '50+', from: 50, to: null, vsize: 100 },
    { label: '20–50', from: 20, to: 50, vsize: 200 },
    { label: '1–20', from: 1, to: 20, vsize: 300 }
  ]);
  assert.deepEqual(histogramBuckets([]), []);
  assert.deepEqual(histogramBuckets(undefined), []);
});
