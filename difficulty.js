// difficulty.js
// Is a block's difficulty the one Bitcoin's rules require at its height?
// Pure; covered by tests/difficulty.test.mjs.
//
// Mainnet rules (Bitcoin Core pow.cpp, no testnet exceptions):
//   - Difficulty changes only every 2016 blocks ("retarget").
//   - Inside a period every block carries the period's first block's bits.
//   - At a period start P, the new target is the previous target (block
//     P-1) scaled by how long the previous period took, measured from
//     block P-2016 to block P-1, against two weeks; the ratio is clamped
//     to 1/4..4 and the result capped at the network's easiest target.

import { targetFromBits, bitsFromTarget } from './spv.js';

export const RETARGET_INTERVAL = 2016;
export const TARGET_TIMESPAN = 14 * 24 * 60 * 60; // two weeks, seconds
export const GENESIS_BITS = 0x1d00ffff;

// Full-precision mainnet limit (consensus.powLimit), not its compact form.
const POW_LIMIT = (1n << 224n) - 1n;

export function periodStart(height) {
  return height - (height % RETARGET_INTERVAL);
}

// Heights whose headers are needed to check `height`.
export function headersNeeded(height) {
  if (height < RETARGET_INTERVAL) {
    return [];
  }

  const p = periodStart(height);
  const needed = [p - 1, p - RETARGET_INTERVAL];

  if (height !== p) {
    needed.unshift(p);
  }

  return needed;
}

// Bitcoin Core's CalculateNextWorkRequired.
export function nextBits(prevBits, firstTime, lastTime) {
  const actualTimespan = lastTime - firstTime;

  const clampedTimespan = Math.min(
    Math.max(actualTimespan, TARGET_TIMESPAN / 4),
    TARGET_TIMESPAN * 4
  );

  let target = targetFromBits(prevBits);
  target = (target * BigInt(clampedTimespan)) / BigInt(TARGET_TIMESPAN);

  if (target > POW_LIMIT) {
    target = POW_LIMIT;
  }

  return {
    bits: bitsFromTarget(target),
    actualTimespan,
    clamped: clampedTimespan !== actualTimespan
  };
}

// Difficulty change from bits a to bits b, e.g. 0.061 for +6.1 %.
export function difficultyChange(fromBits, toBits) {
  const from = targetFromBits(fromBits);
  const to = targetFromBits(toBits);
  return Number((from * 1000000n) / to) / 1000000 - 1;
}

const hex = bits => '0x' + bits.toString(16).padStart(8, '0');
const fmt = n => n.toLocaleString('en-US');

// block:   { height, hash, bits, previousBlockHash }
// headers: { [height]: { hash, bits, timestamp, previousBlockHash, powOk } }
//          for every height in headersNeeded(block.height)
// Returns { ok, checks: [{ label, ok }], facts: [{ label, value }] }.
export function checkDifficulty(block, headers = {}) {
  const { height, bits } = block;

  if (height < RETARGET_INTERVAL) {
    const checks = [{
      label: `Matches the fixed difficulty of the first 2,016 blocks (${hex(GENESIS_BITS)})`,
      ok: bits === GENESIS_BITS
    }];
    return { ok: checks[0].ok, checks, facts: [{ label: 'Period', value: `#0–#${fmt(RETARGET_INTERVAL - 1)}` }] };
  }

  const p = periodStart(height);
  const start = height === p
    ? { hash: block.hash, bits, previousBlockHash: block.previousBlockHash, powOk: true }
    : headers[p];
  const last = headers[p - 1];
  const first = headers[p - RETARGET_INTERVAL];

  for (const [h, header] of [[p, start], [p - 1, last], [p - RETARGET_INTERVAL, first]]) {
    if (!header) {
      throw new Error(`Missing header at height ${h}`);
    }
  }

  const expected = nextBits(last.bits, first.timestamp, last.timestamp);

  const checks = [];

  if (height !== p) {
    checks.push({
      label: `Same difficulty as block ${fmt(p)}, where this 2,016-block period started`,
      ok: bits === start.bits
    });
  }

  checks.push(
    {
      label: `Difficulty at block ${fmt(p)} is the retarget computed from the previous period`,
      ok: start.bits === expected.bits
    },
    {
      label: `Block ${fmt(p)} builds on block ${fmt(p - 1)}`,
      ok: start.previousBlockHash === last.hash
    },
    {
      label: 'Every header used has valid proof of work',
      ok: [start, last, first].every(h => h.powOk)
    }
  );

  const period = { label: 'Period', value: `#${fmt(p)}–#${fmt(p + RETARGET_INTERVAL - 1)}` };

  // Figures computed from headers without valid work would be meaningless.
  if (![start, last, first].every(h => h.powOk)) {
    return { ok: false, checks, facts: [period] };
  }

  const days = (expected.actualTimespan / 86400).toFixed(1);
  const change = difficultyChange(last.bits, expected.bits) * 100;

  const facts = [
    period,
    {
      label: 'Previous period took',
      value: `${days} days (target 14)${expected.clamped ? ', clamped to the 4× limit' : ''}`
    },
    {
      label: 'Adjustment at its start',
      value: `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)} % difficulty`
    },
    { label: 'Expected bits', value: hex(expected.bits) }
  ];

  return { ok: checks.every(c => c.ok), checks, facts };
}
