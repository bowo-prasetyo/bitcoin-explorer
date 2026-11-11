// headerchain.js
// Checks a run of consecutive raw block headers, from the genesis block or
// from where an earlier run ended, against Bitcoin's rules for headers.
// It is the inner loop of a full header-chain sync: about a million
// headers, so it reads bytes directly and hashes synchronously
// (sha256.js). Pure; covered by tests/headerchain.test.mjs.
//
// Every header must, as in Bitcoin Core (CheckBlockHeader and
// ContextualCheckBlockHeader):
//   - point to the header before it (the first one to the genesis block's
//     hash, or to where the previous run ended);
//   - carry the difficulty the rules require at its height: the same as
//     the block before inside a 2,016-block period, the retarget
//     (difficulty.js nextBits) at a period start;
//   - hash to no more than the target that difficulty encodes, and that
//     target must be within the network's limit;
//   - have a timestamp later than the median of the previous 11 blocks';
//   - have at least the version that BIP34, BIP66 and BIP65 require from
//     their activation heights.
// Not checked here: that a timestamp is at most two hours in the future.
// That rule depends on the local clock and only matters at the tip, so it
// belongs where new tips are accepted.
//
// The result carries a `state` (the last valid header and the total work
// up to it) that the next run starts from, so a chain can be checked one
// period at a time and resumed later.

import { doubleSha256Into } from './sha256.js';
import { validTargetFromBits } from './spv.js';
import { nextBits, POW_LIMIT, RETARGET_INTERVAL, GENESIS_HASH } from './difficulty.js';
import { workForBits } from './chainwork.js';

export const HEADER_SIZE = 80;

// Bitcoin Core's GetMedianTimePast: the median of the last 11 blocks.
const MEDIAN_TIME_SPAN = 11;

// Mainnet consensus parameters that apply to headers.
export const MAINNET = {
  genesisHash: GENESIS_HASH,
  powLimit: POW_LIMIT,
  // [activation height, minimum version] (Core's bad-version check).
  minVersions: [[227931, 2], [363725, 3], [388381, 4]]
};

// state:
//   { height, hash, bits, timestamp, periodStartTimestamp,
//     recentTimestamps: [up to 11, oldest first], work: BigInt }
// `hash` is in display order; `work` is the chainwork up to `height`,
// the number Bitcoin Core reports as `chainwork`.
//
// checkHeaders(bytes, prev, params)
//   bytes:  Uint8Array of n × 80 bytes, consecutive headers.
//   prev:   null when bytes starts with the genesis block, else the state
//           a previous run returned (the header just before bytes).
//   params: MAINNET, or a test chain's { genesisHash, powLimit, minVersions }.
// Returns { ok, checked, failure: { height, problem } | null, state }.
// `checked` counts the headers that passed; `state` is after the last one
// of them (or `prev` when none did).
export function checkHeaders(bytes, prev = null, params = MAINNET) {
  if (!(bytes instanceof Uint8Array) || bytes.length % HEADER_SIZE !== 0) {
    throw new Error('Headers must be a whole number of 80-byte headers');
  }

  const count = bytes.length / HEADER_SIZE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The previous header's hash in internal byte order: what the next
  // header's previous-block field must contain.
  const prevHash = new Uint8Array(32);
  const hash = new Uint8Array(32);

  let height, bits, timestamp, periodStartTimestamp, work, recent;

  if (prev) {
    prevHash.set(hexToBytes(prev.hash).reverse());
    ({ height, bits, timestamp, periodStartTimestamp, work } = prev);
    recent = prev.recentTimestamps.slice(-MEDIAN_TIME_SPAN);
  } else {
    height = -1;
    work = 0n;
    recent = [];
  }

  // Targets and work only change at retargets: cache them by bits.
  let cachedBits = null;
  let targetLE = null;
  let blockWork = 0n;

  const genesisHash = hexToBytes(params.genesisHash).reverse();
  const state = () => ({
    height,
    hash: height < 0 ? null : bytesToHex(prevHash.slice().reverse()),
    bits,
    timestamp,
    periodStartTimestamp,
    recentTimestamps: recent.slice(),
    work
  });

  const fail = (h, problem, i) => ({
    ok: false,
    checked: i,
    failure: { height: h, problem },
    state: height < 0 ? null : state()
  });

  for (let i = 0; i < count; i++) {
    const at = i * HEADER_SIZE;
    const h = height + 1;

    const version = view.getInt32(at, true);
    const time = view.getUint32(at + 68, true);
    const hBits = view.getUint32(at + 72, true);

    doubleSha256Into(bytes, at, HEADER_SIZE, hash, 0);

    if (h === 0) {
      // The genesis block is fixed: its hash commits to every field.
      if (!equalBytes(hash, genesisHash)) {
        return fail(h, 'is not the genesis block', i);
      }
    } else {
      if (!equalBytes(bytes, prevHash, at + 4)) {
        return fail(h, `doesn't build on block ${fmt(h - 1)}`, i);
      }

      const required = h % RETARGET_INTERVAL === 0
        ? nextBits(bits, periodStartTimestamp, timestamp, params.powLimit).bits
        : bits;

      if (hBits !== required) {
        return fail(h, h % RETARGET_INTERVAL === 0
          ? `difficulty isn't the retarget from the previous period (expected ${hex(required)}, got ${hex(hBits)})`
          : `difficulty differs from block ${fmt(h - 1)} inside a period (expected ${hex(required)}, got ${hex(hBits)})`, i);
      }

      const median = medianOf(recent);
      if (time <= median) {
        return fail(h, `timestamp ${time} isn't later than the median of the previous blocks (${median})`, i);
      }

      for (const [from, min] of params.minVersions) {
        if (h >= from && version < min) {
          return fail(h, `version ${version} is below ${min}, required from block ${fmt(from)}`, i);
        }
      }
    }

    if (hBits !== cachedBits) {
      const target = validTargetFromBits(hBits);
      if (target === null || target > params.powLimit) {
        return fail(h, `difficulty ${hex(hBits)} is outside the network's limits`, i);
      }
      cachedBits = hBits;
      targetLE = targetBytesLE(target);
      blockWork = workForBits(hBits);
    }

    if (!atMostLE(hash, targetLE)) {
      return fail(h, "hash doesn't meet its difficulty target (invalid proof of work)", i);
    }

    // Accept the header.
    height = h;
    bits = hBits;
    timestamp = time;
    if (h % RETARGET_INTERVAL === 0) periodStartTimestamp = time;
    work += blockWork;
    recent.push(time);
    if (recent.length > MEDIAN_TIME_SPAN) recent.shift();
    prevHash.set(hash);
  }

  return { ok: true, checked: count, failure: null, state: state() };
}

// =====================================================
// HELPERS
// =====================================================

const fmt = n => n.toLocaleString('en-US');
const hex = b => '0x' + b.toString(16).padStart(8, '0');

function hexToBytes(hexStr) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hexStr)) throw new Error('Invalid hex string');
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// a[offset, offset + 32) equals b.
function equalBytes(a, b, offset = 0) {
  for (let i = 0; i < 32; i++) {
    if (a[offset + i] !== b[i]) return false;
  }
  return true;
}

// Target as 32 little-endian bytes, the order a hash is compared in.
function targetBytesLE(target) {
  const out = new Uint8Array(32);
  let t = target;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  return out;
}

// Both little-endian 256-bit numbers: is a <= b?
function atMostLE(a, b) {
  for (let i = 31; i >= 0; i--) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return true;
}

// Core's GetMedianTimePast: sort the last (up to) 11 timestamps and take
// the element at index floor(n / 2). Before any block there is no lower
// bound.
function medianOf(times) {
  if (times.length === 0) return -1;
  const sorted = times.slice().sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}
