// history.js
// Bitcoin's history, from headers the browser has checked: one point per
// difficulty period (2,016 blocks, about two weeks), built from the
// period's first and last header. Those are the same headers the
// difficulty-history check downloads and verifies (verify.js), so a chart
// drawn from them shows nothing a provider merely claimed. Pure apart from
// the opt-in flag; covered by tests/history.test.mjs.

import { targetFromBits, difficultyFromTarget } from './spv.js';
import { RETARGET_INTERVAL } from './difficulty.js';

// Bitcoin measures a period over its 2,015 gaps between first and last block.
const GAPS = RETARGET_INTERVAL - 1;

// starts: { [P]: { hash, bits, timestamp } } for P = 0, 2016, ..., lastStart
// ends:   { [P - 1]: { timestamp } }   for P = 2016, ..., lastStart
// -> [{ height, hash, time, difficulty, interval, hashrate }], oldest first.
//    `interval` is the average seconds between blocks in the period and
//    `hashrate` the hashes per second that difficulty implies at that pace:
//    difficulty × 2^32 per block. The last period isn't over yet, so both
//    are null for it.
export function historySeries(starts, ends, lastStart) {
  const series = [];

  for (let p = 0; p <= lastStart; p += RETARGET_INTERVAL) {
    const start = starts[p];
    if (!start) throw new Error(`Missing header at height ${p}`);

    const end = ends[p + RETARGET_INTERVAL - 1];
    const difficulty = difficultyFromTarget(targetFromBits(start.bits));

    // Miners set timestamps, so a period can (rarely) appear to run
    // backwards; there is no meaningful average then.
    const span = end ? end.timestamp - start.timestamp : null;
    const interval = span !== null && span > 0 ? span / GAPS : null;

    series.push({
      height: p,
      hash: start.hash ?? null,
      time: start.timestamp,
      difficulty,
      interval,
      hashrate: interval ? (difficulty * 2 ** 32) / interval : null
    });
  }

  return series;
}

const HASH_UNITS = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s', 'YH/s'];

// 6.12e20 -> "612 EH/s"
export function formatHashrate(hps) {
  if (!Number.isFinite(hps) || hps <= 0) return '–';
  let i = 0;
  while (hps >= 1000 && i < HASH_UNITS.length - 1) {
    hps /= 1000;
    i++;
  }
  return `${hps >= 100 ? Math.round(hps) : +hps.toFixed(hps >= 10 ? 1 : 2)} ${HASH_UNITS[i]}`;
}

// 1.23e14 -> "123 T" (difficulty is a plain number).
export function formatDifficultyShort(d) {
  const units = ['', ' k', ' M', ' G', ' T', ' P', ' E'];
  let i = 0;
  while (d >= 1000 && i < units.length - 1) {
    d /= 1000;
    i++;
  }
  return `${d >= 100 ? Math.round(d) : +d.toFixed(d >= 10 ? 1 : 2)}${units[i]}`;
}

// A chart's text alternative.
export function describeSeries(series) {
  const done = series.filter(s => s.interval);
  if (!done.length) return 'No completed difficulty periods yet.';

  const first = series[0];
  const last = series[series.length - 1];
  const year = s => new Date(s.time * 1000).getUTCFullYear();
  const peak = done.reduce((a, b) => (b.hashrate > a.hashrate ? b : a));
  const slowest = done.reduce((a, b) => (b.interval > a.interval ? b : a));
  const fastest = done.reduce((a, b) => (b.interval < a.interval ? b : a));
  const min = s => `${(s.interval / 60).toFixed(1)} min`;

  return `${series.length.toLocaleString('en-US')} difficulty periods from ${year(first)} to ${year(last)}. ` +
    `Difficulty rose from ${formatDifficultyShort(first.difficulty)} to ${formatDifficultyShort(last.difficulty)}. ` +
    `Estimated hashrate peaked at ${formatHashrate(peak.hashrate)} (${year(peak)}). ` +
    `Average time between blocks ranged from ${min(fastest)} (${year(fastest)}) ` +
    `to ${min(slowest)} (${year(slowest)}).`;
}

// One CSV row per period, for "Download as CSV".
export function seriesCsv(series) {
  const rows = series.map(s => [
    s.height,
    new Date(s.time * 1000).toISOString(),
    s.difficulty,
    s.interval === null ? '' : s.interval.toFixed(1),
    s.hashrate === null ? '' : Math.round(s.hashrate)
  ].join(','));
  return ['first_block,first_block_time_utc,difficulty,avg_block_interval_s,est_hashrate_hps', ...rows].join('\n') + '\n';
}

// The user's one-time agreement to download history headers, shared by
// "Work behind the tip" (home) and the Charts page. The key predates the
// Charts page; renaming it would forget earlier agreements.
const OPT_IN_KEY = 'btc_explorer_chainwork';

export function headersOptedIn() {
  try { return localStorage.getItem(OPT_IN_KEY) === '1'; } catch { return false; }
}

export function optInToHeaders() {
  try { localStorage.setItem(OPT_IN_KEY, '1'); } catch { /* private mode */ }
}
