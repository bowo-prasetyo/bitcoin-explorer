import test from 'node:test';
import assert from 'node:assert/strict';

import {
  historySeries,
  formatHashrate,
  formatDifficultyShort,
  describeSeries,
  seriesCsv,
  headersOptedIn
} from '../history.js';

const T0 = 1231006505; // genesis block time
const TWO_WEEKS = 14 * 24 * 3600;

// Period 0 at difficulty 1 taking exactly two weeks (600 s per gap), then a
// period at difficulty 4 (0x1c3fffc0) taking one week, then the current one.
const starts = {
  0: { hash: 'g', bits: 0x1d00ffff, timestamp: T0 },
  2016: { bits: 0x1c3fffc0, timestamp: T0 + TWO_WEEKS + 600 },
  4032: { bits: 0x1c3fffc0, timestamp: T0 + TWO_WEEKS + 600 + TWO_WEEKS / 2 + 300 }
};
const ends = {
  2015: { timestamp: T0 + 2015 * 600 },
  4031: { timestamp: T0 + TWO_WEEKS + 600 + 2015 * 300 }
};

test('one point per period: difficulty, average interval, implied hashrate', () => {
  const s = historySeries(starts, ends, 4032);
  assert.equal(s.length, 3);

  assert.deepEqual(s[0], { height: 0, hash: 'g', time: T0, difficulty: 1, interval: 600, hashrate: 2 ** 32 / 600 });
  assert.equal(s[1].hash, null);

  assert.equal(s[1].height, 2016);
  assert.equal(s[1].difficulty, 4);
  assert.equal(s[1].interval, 300);
  assert.equal(s[1].hashrate, (4 * 2 ** 32) / 300);
});

test('the current period has no interval or hashrate yet', () => {
  const s = historySeries(starts, ends, 4032);
  assert.equal(s[2].interval, null);
  assert.equal(s[2].hashrate, null);
  assert.equal(s[2].difficulty, 4);
});

test('a period whose timestamps run backwards gets no average', () => {
  const s = historySeries(starts, { ...ends, 2015: { timestamp: T0 - 10 } }, 2016);
  assert.equal(s[0].interval, null);
  assert.equal(s[0].hashrate, null);
});

test('a missing period start is an error, not a gap', () => {
  assert.throws(() => historySeries({ 0: starts[0] }, ends, 2016), /Missing header at height 2016/);
});

test('formatHashrate picks a unit', () => {
  assert.equal(formatHashrate(2 ** 32 / 600), '7.16 MH/s');
  assert.equal(formatHashrate(6.12e20), '612 EH/s');
  assert.equal(formatHashrate(1.5e21), '1.5 ZH/s');
  assert.equal(formatHashrate(42), '42 H/s');
  assert.equal(formatHashrate(null), '–');
  assert.equal(formatHashrate(0), '–');
});

test('formatDifficultyShort', () => {
  assert.equal(formatDifficultyShort(1), '1');
  assert.equal(formatDifficultyShort(1.23e14), '123 T');
  assert.equal(formatDifficultyShort(95.67e12), '95.7 T');
});

test('describeSeries sums the history up in words', () => {
  const text = describeSeries(historySeries(starts, ends, 4032));
  assert.match(text, /^3 difficulty periods from 2009 to 2009\./);
  assert.match(text, /Difficulty rose from 1 to 4\./);
  assert.match(text, /from 5\.0 min \(2009\) to 10\.0 min \(2009\)/);
  assert.equal(describeSeries([{ ...historySeries(starts, ends, 0)[0], interval: null }]), 'No completed difficulty periods yet.');
});

test('seriesCsv: header row plus one row per period', () => {
  const lines = seriesCsv(historySeries(starts, ends, 4032)).trim().split('\n');
  assert.equal(lines[0], 'first_block,first_block_time_utc,difficulty,avg_block_interval_s,est_hashrate_hps');
  assert.equal(lines[1], '0,2009-01-03T18:15:05.000Z,1,600.0,7158279');
  assert.equal(lines[3].split(',').slice(3).join(','), ',');
});

test('opt-in reads as false without storage (Node, private mode)', () => {
  assert.equal(headersOptedIn(), false);
});
