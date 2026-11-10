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

// =====================================================
// FULL HISTORY: every retarget from genesis
// =====================================================

export const GENESIS_HASH =
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

// Checks every retarget from the genesis block up to the period starting
// at `lastStart`, so each period's difficulty follows from the genesis
// block's fixed difficulty and the timestamps in between.
//
// starts: { [P]: header } for P = 0, 2016, ..., lastStart (period starts)
// ends:   { [P - 1]: header } for P = 2016, ..., lastStart (period ends)
// header: { hash, bits, timestamp, previousBlockHash, powOk }
//
// Returns { ok, retargets, failures: [{ height, problem }], stats }.
export function checkDifficultyHistory(starts, ends, lastStart) {
  const failures = [];
  const fail = (height, problem) => failures.push({ height, problem });

  const genesis = starts[0];

  if (!genesis) {
    throw new Error('Missing genesis header');
  }

  if (genesis.hash !== GENESIS_HASH) fail(0, 'not the genesis block');
  if (genesis.bits !== GENESIS_BITS) fail(0, 'genesis difficulty is not 0x1d00ffff');
  if (!genesis.powOk) fail(0, 'invalid proof of work');

  const stats = { retargets: 0, clamped: 0, maxUp: null, maxDown: null };

  for (let p = RETARGET_INTERVAL; p <= lastStart; p += RETARGET_INTERVAL) {
    const prev = starts[p - RETARGET_INTERVAL];
    const end = ends[p - 1];
    const start = starts[p];

    if (!prev || !end || !start) {
      throw new Error(`Missing header near height ${p}`);
    }

    if (!end.powOk) fail(p - 1, 'invalid proof of work');
    if (!start.powOk) fail(p, 'invalid proof of work');

    if (end.bits !== prev.bits) {
      fail(p - 1, `difficulty differs from its period's first block`);
    }

    if (start.previousBlockHash !== end.hash) {
      fail(p, `doesn't build on block ${(p - 1).toLocaleString('en-US')}`);
    }

    const expected = nextBits(prev.bits, prev.timestamp, end.timestamp);

    if (start.bits !== expected.bits) {
      fail(p, `difficulty isn't the retarget from the previous period`);
    }

    stats.retargets++;
    if (expected.clamped) stats.clamped++;

    const change = difficultyChange(prev.bits, start.bits);
    if (!stats.maxUp || change > stats.maxUp.change) stats.maxUp = { height: p, change };
    if (!stats.maxDown || change < stats.maxDown.change) stats.maxDown = { height: p, change };
  }

  return { ok: failures.length === 0, retargets: stats.retargets, failures, stats };
}

// =====================================================
// A RUN OF CONSECUTIVE HEADERS (confirmations)
// =====================================================

// Do the headers at heights from..to form a chain Bitcoin allows?
// headers: { [height]: { hash, bits, timestamp, previousBlockHash, powOk } }
//          for every height from..to
// periodFirst: { [height]: { timestamp, powOk } } the first header of the
//          period before each period start in from+1..to (only needed
//          when the run crosses a retarget and doesn't contain it).
// Each header after `from` must point to the one before and have the
// difficulty required after it: the same inside a period, the retarget
// at a period start.
// Returns { linked, powOk, difficultyOk, ok }.
export function checkHeaderChain(headers, from, to, periodFirst = {}) {
  let linked = true;
  let powOk = !!headers[from]?.powOk;
  let difficultyOk = true;

  for (let h = from + 1; h <= to; h++) {
    const cur = headers[h];
    const prev = headers[h - 1];

    if (!cur || !prev) {
      throw new Error(`Missing header at height ${h}`);
    }

    linked &&= cur.previousBlockHash === prev.hash;
    powOk &&= !!cur.powOk;

    if (h % RETARGET_INTERVAL !== 0) {
      difficultyOk &&= cur.bits === prev.bits;
    } else {
      const first = headers[h - RETARGET_INTERVAL] ?? periodFirst[h - RETARGET_INTERVAL];
      difficultyOk &&= !!first?.powOk &&
        cur.bits === nextBits(prev.bits, first.timestamp, prev.timestamp).bits;
    }
  }

  return { linked, powOk, difficultyOk, ok: linked && powOk && difficultyOk };
}
