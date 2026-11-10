// consensus.js
// Checks and compares the chain tip reported by each provider. No network
// or storage; covered by tests/consensus.test.mjs.

import { verifyHeaderPoW } from './spv.js';

// Why a tip header that a provider sent doesn't check out.
const POW_FAILURES = [
  ['hashMatches', "its header doesn't hash to the tip it named"],
  ['meetsTarget', "its header doesn't meet its own difficulty target"],
  ['withinPowLimit', 'its header claims an easier difficulty than mainnet allows']
];

// Checks each answering provider's tip header for proof of work.
// Input: entries from api.js getTipFromEach():
//   { name, ok: true, height, hash, header } | { name, ok: false, error }
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

    if (pow.ok) return t;

    const [, reason] = POW_FAILURES.find(([key]) => !pow.checks[key]);
    return { ...t, ok: false, invalid: true, error: reason };
  }));
}

// Input: one entry per configured provider:
//   { name, ok: true,  height, hash }
//   { name, ok: false, error }               unreachable, or no usable answer
//   { name, ok: false, invalid: true, error } answered with an invalid tip
// leaderHashes (optional): { [height]: hash } as reported by the provider
//   with the highest tip, for the heights of lagging providers. Lets us
//   tell "a block behind on the same chain" from "on a different chain".
//
// Output:
//   state: 'invalid'     a provider sent a tip that fails proof of work;
//                        wins over every other state. `chainState` keeps
//                        what the remaining providers said.
//          'agree'       all responding providers report the same tip
//          'behind'      same chain, some providers haven't seen the
//                        newest block(s) yet
//          'conflict'    providers report different chains
//          'single'      only one provider answered, nothing to compare
//          'unavailable' no provider answered
//   responded, total, height, hash (best tip), lagging: [{ name, by }],
//   conflicts: [name], invalid: [name]

export function compareTips(results, leaderHashes = {}) {
  const cmp = compareValidTips(results, leaderHashes);
  const invalid = results.filter(r => !r.ok && r.invalid).map(r => r.name);

  return invalid.length
    ? { ...cmp, invalid, state: 'invalid', chainState: cmp.state }
    : { ...cmp, invalid };
}

function compareValidTips(results, leaderHashes) {
  const total = results.length;
  const ok = results.filter(r => r.ok);

  const base = { total, responded: ok.length, lagging: [], conflicts: [] };

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

    if (r.height > best.height) continue; // not possible; best is max

    const leaderHash = leaderHashes[r.height];

    if (leaderHash !== undefined && leaderHash !== r.hash) {
      summary.conflicts.push(r.name);
    } else {
      summary.lagging.push({ name: r.name, by: best.height - r.height });
    }
  }

  const state = summary.conflicts.length
    ? 'conflict'
    : summary.lagging.length ? 'behind' : 'agree';

  return { ...summary, state };
}
