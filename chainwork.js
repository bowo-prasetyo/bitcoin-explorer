// chainwork.js
// Total proof of work behind a chain tip ("chainwork"). Pure; covered by
// tests/chainwork.test.mjs.
//
// A block's work is the expected number of hashes to find it:
// 2^256 / (target + 1), as Bitcoin Core's GetBlockProof. Chainwork is the
// sum over every block from genesis to the tip. On mainnet every block in
// a 2016-block difficulty period has its period's first block's bits, so
// the exact sum needs only one header per period:
//   sum over periods of (blocks in period) x work(period bits).
// The result is the same number Bitcoin Core reports as `chainwork`.

import { targetFromBits } from './spv.js';
import { RETARGET_INTERVAL } from './difficulty.js';

export function workForBits(bits) {
  const target = targetFromBits(bits);
  return (1n << 256n) / (target + 1n);
}

// Heights of the first block of every period up to the tip.
export function periodStarts(tipHeight) {
  const starts = [];
  for (let h = 0; h <= tipHeight; h += RETARGET_INTERVAL) {
    starts.push(h);
  }
  return starts;
}

// bitsByPeriodStart: { [periodStartHeight]: bits } for every periodStarts().
export function chainWork(bitsByPeriodStart, tipHeight) {
  let total = 0n;

  for (const start of periodStarts(tipHeight)) {
    const bits = bitsByPeriodStart[start];

    if (bits === undefined) {
      throw new Error(`Missing period starting at ${start}`);
    }

    const end = Math.min(start + RETARGET_INTERVAL - 1, tipHeight);
    total += BigInt(end - start + 1) * workForBits(bits);
  }

  return total;
}

// Bitcoin Core prints chainwork as 64 hex digits.
export function chainWorkHex(work) {
  return work.toString(16).padStart(64, '0');
}

// log2 with two decimals, e.g. 2^95.71 hashes.
export function log2(work) {
  if (work <= 0n) return 0;
  const bitsLen = work.toString(2).length;
  // Top 53 bits give full double precision for the fraction.
  const shift = Math.max(0, bitsLen - 53);
  const top = Number(work >> BigInt(shift));
  return Math.log2(top) + shift;
}

// How long miners working at the given difficulty would take to redo
// `work`, at the 10-minute block target. Returns years.
export function yearsToRedo(work, currentBits) {
  const blocks = Number(work / workForBits(currentBits));
  const minutes = blocks * 10;
  return minutes / (60 * 24 * 365.25);
}

// "~10 minutes", "~3 days", "~14 years": yearsToRedo in readable units.
export function formatRedoTime(years) {
  const minutes = years * 365.25 * 24 * 60;

  const say = (n, unit) => {
    const r = Math.max(1, Math.round(n));
    return `~${r.toLocaleString('en-US')} ${unit}${r === 1 ? '' : 's'}`;
  };

  if (minutes < 90) return say(minutes, 'minute');
  if (minutes < 48 * 60) return say(minutes / 60, 'hour');
  if (years < 2) return say(minutes / (24 * 60), 'day');
  return say(years, 'year');
}
