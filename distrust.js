// distrust.js
// Providers caught sending an invalid chain tip (consensus.js) are left
// out of lookups: Assay can't check balances, the mempool or fees, so it
// shouldn't ask a provider that has already sent it a fake block. Pure;
// api.js keeps the state and stores it. Covered by tests/distrust.test.mjs.
//
// A provider is trusted again when its tip passes the chain-tip check, when
// the user says so on the Providers page, or after DISTRUST_TTL, so a
// briefly broken provider isn't shut out for good on a device that rarely
// opens the home page (where the tip is checked on every new block).

export const DISTRUST_TTL = 24 * 60 * 60 * 1000;

// { [base]: { name, reason, since } }, from storage. Drops expired and
// malformed entries.
export function parseDistrust(text, now = Date.now()) {
  let parsed;

  try {
    parsed = JSON.parse(text || '{}');
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const out = {};

  for (const [base, entry] of Object.entries(parsed)) {
    if (
      entry &&
      typeof entry.since === 'number' &&
      typeof entry.reason === 'string' &&
      now - entry.since < DISTRUST_TTL &&
      entry.since <= now
    ) {
      out[base] = { name: String(entry.name || base), reason: entry.reason, since: entry.since };
    }
  }

  return out;
}

export function isDistrusted(distrust, base, now = Date.now()) {
  const entry = distrust[base];
  return !!entry && now - entry.since < DISTRUST_TTL;
}

// The providers a lookup may use, best first.
export function lookupNodes(ranked, distrust, now = Date.now()) {
  return ranked.filter(node => !isDistrusted(distrust, node.base, now));
}

// Applies one chain-tip check (entries from consensus.js checkTipHeaders,
// each with `base`) and returns the new record, or the same object when
// nothing changed. Invalid tips are distrusted; a valid tip clears a
// provider. Unreachable providers prove nothing and stay as they were.
export function applyTipCheck(distrust, tips, now = Date.now()) {
  let next = distrust;

  for (const t of tips) {
    if (t.invalid) {
      if (!distrust[t.base]) {
        next = { ...next, [t.base]: { name: t.name, reason: t.error, since: now } };
      }
    } else if (t.ok && next[t.base]) {
      next = { ...next };
      delete next[t.base];
    }
  }

  return next;
}
