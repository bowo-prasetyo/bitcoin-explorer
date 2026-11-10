// search.js
// Classifies a search query before anything is sent to a provider, so
// typos get an immediate explanation instead of a failed lookup.
// Bitcoin mainnet only. Covered by tests/search.test.mjs.

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';
const BECH32 = '[02-9ac-hj-np-z]';

const LEGACY_ADDRESS = new RegExp(`^[13]${BASE58}{25,34}$`);

// bc1q... (segwit v0, 42 or 62 chars) and bc1p... (taproot, 62 chars).
// Bech32 is case-insensitive but must not be mixed-case.
const SEGWIT_ADDRESS = new RegExp(`^bc1${BECH32}{39,59}$`);

const TESTNET_ADDRESS = new RegExp(
  `^([mn2]${BASE58}{25,34}|(tb1|bcrt1)${BECH32}{8,87})$`,
  'i'
);

const HEX64 = /^[0-9a-fA-F]{64}$/;
const DIGITS = /^\d+$/;

// Highest height we'll accept as a plausible block height.
const MAX_HEIGHT = 99999999;

// Results:
//   { type: 'height',  height }
//   { type: 'hash',    hash, likelyBlock }  block hash or txid
//   { type: 'address', address }
//   { type: 'invalid', reason }
export function classifyQuery(input) {
  let q = (input || '').trim();

  // A payment link from a wallet or QR code: bitcoin:<address>?amount=…
  const uri = /^bitcoin:([^?#]*)/i.exec(q);

  if (uri) {
    try {
      q = decodeURIComponent(uri[1]).trim();
    } catch {
      q = ''; // malformed %-escape
    }

    const inner = classifyQuery(q);

    return inner.type === 'address' || inner.reason?.includes('testnet')
      ? inner
      : { type: 'invalid', reason: 'That bitcoin: link has no valid address in it.' };
  }

  if (!q) {
    return { type: 'invalid', reason: 'Enter a block height, block hash, transaction id or address.' };
  }

  if (DIGITS.test(q)) {
    const height = Number(q);

    if (height > MAX_HEIGHT) {
      return { type: 'invalid', reason: `${q} is too large to be a block height.` };
    }

    return { type: 'height', height };
  }

  if (HEX64.test(q)) {
    const hash = q.toLowerCase();

    // Mainnet proof-of-work makes every block hash start with at least
    // eight zero hex digits; a txid almost never does.
    return { type: 'hash', hash, likelyBlock: hash.startsWith('00000000') };
  }

  if (LEGACY_ADDRESS.test(q)) {
    return { type: 'address', address: q };
  }

  const isMixedCase = q !== q.toLowerCase() && q !== q.toUpperCase();

  if (!isMixedCase && SEGWIT_ADDRESS.test(q.toLowerCase())) {
    return { type: 'address', address: q.toLowerCase() };
  }

  if (TESTNET_ADDRESS.test(q)) {
    return { type: 'invalid', reason: 'That looks like a testnet address. This explorer shows Bitcoin mainnet.' };
  }

  if (/^[0-9a-fA-F]+$/.test(q)) {
    return { type: 'invalid', reason: `Block hashes and transaction ids are 64 hex characters; this one has ${q.length}.` };
  }

  return { type: 'invalid', reason: 'Not a block height, block hash, transaction id or Bitcoin address.' };
}
