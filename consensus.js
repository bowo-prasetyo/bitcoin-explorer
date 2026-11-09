// consensus.js
// Compares the chain tip reported by each provider. Pure; covered by
// tests/consensus.test.mjs.
//
// Input: one entry per configured provider:
//   { name, ok: true,  height, hash }
//   { name, ok: false, error }
// leaderHashes (optional): { [height]: hash } as reported by the provider
//   with the highest tip, for the heights of lagging providers. Lets us
//   tell "a block behind on the same chain" from "on a different chain".
//
// Output:
//   state: 'agree'       all responding providers report the same tip
//          'behind'      same chain, some providers haven't seen the
//                        newest block(s) yet
//          'conflict'    providers report different chains
//          'single'      only one provider answered, nothing to compare
//          'unavailable' no provider answered
//   responded, total, height, hash (best tip), lagging: [{ name, by }]

export function compareTips(results, leaderHashes = {}) {
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
