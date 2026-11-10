// consensus.js
// Checks and compares the chain tip reported by each provider. No network
// or storage; covered by tests/consensus.test.mjs.

import { verifyHeaderPoW } from './spv.js';
import { periodStart, nextBits, RETARGET_INTERVAL } from './difficulty.js';

// Why a tip header that a provider sent doesn't check out.
const POW_FAILURES = [
  ['hashMatches', "its header doesn't hash to the tip it named"],
  ['meetsTarget', "its header doesn't meet its own difficulty target"],
  ['withinPowLimit', 'its header claims an easier difficulty than mainnet allows']
];

// Checks each answering provider's tip header for proof of work.
// Input: entries from api.js getTipFromEach():
//   { name, ok: true, height, hash, header } | { name, ok: false, error }
// A passing entry gains the header's { bits, timestamp, previousBlockHash },
// which compareTips() uses to check a leader against a lagging provider.
// A provider that answered with a header that fails is marked
//   { ok: false, invalid: true, error }
// which is not the same as being unreachable: it sent data that isn't a
// real block, and compareTips() reports that as a failure.
export async function checkTipHeaders(tips) {
  return Promise.all(tips.map(async t => {
    if (!t.ok) return t;

    let pow;
    try {
      pow = await verifyHeaderPoW(t.header, t.hash);
    } catch {
      return { ...t, ok: false, invalid: true, error: 'sent a malformed block header' };
    }

    if (pow.ok) {
      const { bits, timestamp, previousBlockHash } = pow.header;
      return { ...t, bits, timestamp, previousBlockHash };
    }

    const [, reason] = POW_FAILURES.find(([key]) => !pow.checks[key]);
    return { ...t, ok: false, invalid: true, error: reason };
  }));
}

// Input: one entry per configured provider:
//   { name, ok: true,  height, hash, bits, timestamp, previousBlockHash }
//   { name, ok: false, error }               unreachable, or no usable answer
//   { name, ok: false, invalid: true, error } answered with an invalid tip
// leaderHashes (optional): { [height]: hash } as reported by the provider
//   with the highest tip, for the heights of lagging providers.
// retargetFirst (optional): { [height]: { timestamp } } the first header of
//   the period before the leader's, as reported by a lagging provider;
//   needed only when the leader's tip starts a new difficulty period.
//
// A header's proof of work only proves the work its own difficulty claims,
// and the easiest mainnet difficulty takes seconds to meet. So a leader is
// only "ahead on the same chain" when that can be checked against a lagging
// provider's own, independently checked tip:
//   - it builds on the lagging tip: its header's previous-block field when
//     it is one block ahead, else the leader's word for the hash at the
//     lagging height, and
//   - its difficulty is the one Bitcoin requires after the lagging tip:
//     the same within a period, or the retarget at a period start.
// A leader with the wrong difficulty is reported like a tip that fails
// proof of work (`invalid`): it is a block mined at a made-up difficulty.
// When it can't be checked (more than one block ahead across a period
// boundary, or missing data) the state is 'unconfirmed', never a pass.
//
// Output:
//   state: 'invalid'     a provider sent a tip that fails proof of work or
//                        has the wrong difficulty; wins over every other
//                        state. `chainState` keeps what the remaining
//                        providers said.
//          'agree'       all responding providers report the same tip
//          'behind'      same chain, some providers haven't seen the
//                        newest block(s) yet
//          'unconfirmed' a provider is ahead, but its newer blocks can't
//                        be checked against the others yet
//          'conflict'    providers report different chains
//          'single'      only one provider answered, nothing to compare
//          'unavailable' no provider answered
//   responded, total, height, hash (best tip), lagging: [{ name, by }],
//   unconfirmed: [{ name, by }], conflicts: [name], invalid: [name],
//   results: the input with any leader found to have the wrong difficulty
//            turned into { ok: false, invalid: true, error }

export function compareTips(results, leaderHashes = {}, retargetFirst = {}) {
  let current = results;

  // At most one leader is replaced per round; a provider caught with the
  // wrong difficulty drops out and the next highest tip is compared.
  for (;;) {
    const cmp = compareValidTips(current, leaderHashes, retargetFirst);

    if (cmp.badLeader) {
      const { name, error } = cmp.badLeader;
      current = current.map(r => r.name === name ? { ...r, ok: false, invalid: true, error } : r);
      // The leader's word about earlier hashes can't be used any more.
      leaderHashes = {};
      continue;
    }

    const invalid = current.filter(r => !r.ok && r.invalid).map(r => r.name);
    const out = { ...cmp, invalid, results: current };

    return invalid.length
      ? { ...out, state: 'invalid', chainState: cmp.state }
      : out;
  }
}

const fmt = n => n.toLocaleString('en-US');

// Is `leader` the block(s) Bitcoin allows after `r`? Returns
// 'linked' | 'conflict' | 'unconfirmed' | { error } (wrong difficulty).
function relate(leader, r, leaderHashes, retargetFirst) {
  const by = leader.height - r.height;

  let linked;
  if (by === 1 && leader.previousBlockHash !== undefined) {
    linked = leader.previousBlockHash === r.hash;
  } else if (leaderHashes[r.height] !== undefined) {
    linked = leaderHashes[r.height] === r.hash;
  } else {
    return 'unconfirmed';
  }

  if (!linked) return 'conflict';

  if (leader.bits === undefined || r.bits === undefined) {
    return 'unconfirmed';
  }

  const p = periodStart(leader.height);
  let expected;

  if (periodStart(r.height) === p) {
    expected = r.bits;
  } else if (by === 1 && leader.height === p) {
    const first = retargetFirst[p - RETARGET_INTERVAL];
    if (!first || r.timestamp === undefined) return 'unconfirmed';
    expected = nextBits(r.bits, first.timestamp, r.timestamp).bits;
  } else {
    return 'unconfirmed';
  }

  return leader.bits === expected
    ? 'linked'
    : { error: `its difficulty doesn't follow from block ${fmt(r.height)} as ${r.name} reports it` };
}

function compareValidTips(results, leaderHashes, retargetFirst) {
  const total = results.length;
  const ok = results.filter(r => r.ok);

  const base = { total, responded: ok.length, lagging: [], unconfirmed: [], conflicts: [] };

  if (ok.length === 0) {
    return { ...base, state: 'unavailable', height: null, hash: null };
  }

  const best = ok.reduce((a, b) => (b.height > a.height ? b : a));
  const summary = { ...base, height: best.height, hash: best.hash };

  if (ok.length === 1) {
    return { ...summary, state: 'single' };
  }

  for (const r of ok) {
    if (r === best) continue;

    if (r.height === best.height) {
      if (r.hash !== best.hash) {
        summary.conflicts.push(r.name);
      }
      continue;
    }

    const by = best.height - r.height;
    const rel = relate(best, r, leaderHashes, retargetFirst);

    if (rel === 'conflict') {
      summary.conflicts.push(r.name);
    } else if (rel === 'unconfirmed') {
      summary.unconfirmed.push({ name: r.name, by });
    } else if (rel === 'linked') {
      summary.lagging.push({ name: r.name, by });
    } else {
      return { ...summary, badLeader: { name: best.name, error: rel.error } };
    }
  }

  const state = summary.conflicts.length
    ? 'conflict'
    : summary.unconfirmed.length
      ? 'unconfirmed'
      : summary.lagging.length ? 'behind' : 'agree';

  return { ...summary, state };
}
