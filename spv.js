// spv.js
// Verifying Bitcoin data in the browser: block-header proof of work,
// Merkle roots and inclusion proofs, and txids from raw transactions.
//
// Pure functions over hex strings; no network, no framework.
// Covered by tests/spv.test.mjs.
//
// Byte order: block hashes, txids and merkle roots are *displayed*
// (and returned by Esplora APIs) byte-reversed relative to the order
// they are hashed in. Functions here take and return display order
// unless stated otherwise.

// =====================================================
// BYTES & HASHING
// =====================================================

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Invalid hex string');
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function reverseHex(hex) {
  return bytesToHex(hexToBytes(hex).reverse());
}

async function sha256(bytes) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes)
  );
}

// SHA256(SHA256(bytes)) over raw bytes given as hex; returns hex in the
// same (internal) byte order.
export async function doubleSHA256(hex) {
  return bytesToHex(await sha256(await sha256(hexToBytes(hex))));
}

function readUInt32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

// =====================================================
// BLOCK HEADERS & PROOF OF WORK
// =====================================================

// Easiest target mainnet allows (difficulty 1): bits 0x1d00ffff.
export const MAINNET_POW_LIMIT = targetFromBits(0x1d00ffff);

// Compact "bits" -> target as BigInt.
export function targetFromBits(bits) {
  const exponent = bits >>> 24;
  const mantissa = bits & 0x007fffff;

  if (bits & 0x00800000) {
    throw new Error('Negative target');
  }

  return exponent <= 3
    ? BigInt(mantissa >>> (8 * (3 - exponent)))
    : BigInt(mantissa) << BigInt(8 * (exponent - 3));
}

// Target (BigInt) -> compact "bits", exactly as Bitcoin Core's
// arith_uint256::GetCompact (the encoding truncates low-order bits).
export function bitsFromTarget(target) {
  if (target < 0n) {
    throw new Error('Negative target');
  }

  let size = target === 0n ? 0 : Math.ceil(target.toString(16).length / 2);
  let compact = size <= 3
    ? Number(target << BigInt(8 * (3 - size)))
    : Number(target >> BigInt(8 * (size - 3)));

  // The top mantissa bit is a sign bit; shift into the next byte instead.
  if (compact & 0x00800000) {
    compact >>>= 8;
    size++;
  }

  return ((size << 24) | compact) >>> 0;
}

// Expected number of hashes to find a block at this target.
export function expectedHashes(target) {
  return (1n << 256n) / (target + 1n);
}

// Mainnet difficulty: pow limit / target.
export function difficultyFromTarget(target) {
  // Keep 3 decimals of precision without floating-point BigInt overflow.
  return Number((MAINNET_POW_LIMIT * 1000n) / target) / 1000;
}

export function parseHeader(headerHex) {
  if (headerHex.length !== 160) {
    throw new Error(`A block header is 80 bytes; got ${headerHex.length / 2}`);
  }

  const bytes = hexToBytes(headerHex);

  return {
    version: readUInt32LE(bytes, 0),
    previousBlockHash: reverseHex(headerHex.slice(8, 72)),
    merkleRoot: reverseHex(headerHex.slice(72, 136)),
    timestamp: readUInt32LE(bytes, 68),
    bits: readUInt32LE(bytes, 72),
    nonce: readUInt32LE(bytes, 76)
  };
}

export async function blockHashFromHeader(headerHex) {
  return reverseHex(await doubleSHA256(headerHex));
}

// The target encoded in `bits`, or null when Bitcoin Core would reject it
// outright: negative, zero, or wider than 256 bits (CheckProofOfWork).
export function validTargetFromBits(bits) {
  let target;

  try {
    target = targetFromBits(bits);
  } catch {
    return null; // negative
  }

  return target === 0n || target >= (1n << 256n) ? null : target;
}

// Checks a raw header against a claimed block hash. Returns every check
// separately so the UI can say exactly what passed.
//
// This proves only the work the header itself claims: a header that names
// the easiest mainnet difficulty passes with about 2^32 hashes, which takes
// seconds on ordinary hardware. Whether that difficulty is the one required
// at the block's height is checked separately (difficulty.js, and the
// cross-provider checks in verify.js and consensus.js).
export async function verifyHeaderPoW(headerHex, expectedHash) {
  const header = parseHeader(headerHex);
  const hash = await blockHashFromHeader(headerHex);
  const target = validTargetFromBits(header.bits);

  const checks = {
    // The header really is the block the provider named.
    hashMatches: hash === expectedHash.toLowerCase(),
    // Someone did the work: hash <= target encoded in the header.
    meetsTarget: target !== null && BigInt('0x' + hash) <= target,
    // The target is a real one, and isn't easier than mainnet ever allows.
    withinPowLimit: target !== null && target <= MAINNET_POW_LIMIT
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    header,
    hash,
    target,
    difficulty: target === null ? null : difficultyFromTarget(target),
    expectedHashes: target === null ? null : expectedHashes(target)
  };
}

// =====================================================
// MERKLE TREES
// =====================================================

// Computes the merkle root of a block's txids (display order, in block
// order). Returns { root (display order), mutated }.
//
// `mutated` is Bitcoin Core's check for CVE-2012-2459: because an odd
// level pairs its last hash with itself, the lists [a, b, c] and
// [a, b, c, c] have the same root. Core rejects any level where two
// paired hashes are identical; a real block never has that, since a
// transaction can't appear twice in one block.
export async function computeMerkleRootChecked(txids) {
  if (!txids.length) {
    throw new Error('A block has at least one transaction');
  }

  let layer = txids.map(reverseHex);
  let mutated = false;

  while (layer.length > 1) {
    const next = [];

    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left; // odd count: pair with itself

      if (i + 1 < layer.length && left === right) {
        mutated = true;
      }

      next.push(await doubleSHA256(left + right));
    }

    layer = next;
  }

  return { root: reverseHex(layer[0]), mutated };
}

export async function computeMerkleRoot(txids) {
  return (await computeMerkleRootChecked(txids)).root;
}

export async function verifyMerkleRoot(txids, expectedRoot) {
  if (!txids.length) {
    return false;
  }

  const { root, mutated } = await computeMerkleRootChecked(txids);
  return !mutated && root === expectedRoot.toLowerCase();
}

// Folds a merkle branch (sibling hashes, display order, leaf to root) for
// the transaction at index `pos`. This is the format of Esplora's
// /tx/:txid/merkle-proof. Returns { root (display order), mutated }.
//
// `mutated`: a node on the right paired with an identical left sibling.
// In a real tree identical pairs only come from an odd level's last hash
// being paired with itself, and that hash is always on the left.
export async function checkMerkleProof(txid, branch, pos) {
  if (!Number.isInteger(pos) || pos < 0) {
    throw new Error('Invalid position');
  }

  let hash = reverseHex(txid);
  let index = pos;
  let mutated = false;

  for (const sibling of branch) {
    const s = reverseHex(sibling);

    if (index & 1 && s === hash) {
      mutated = true;
    }

    hash = index & 1
      ? await doubleSHA256(s + hash)
      : await doubleSHA256(hash + s);

    index = Math.floor(index / 2);
  }

  // Left over bits mean the position doesn't fit this branch.
  if (index !== 0) {
    throw new Error('Position does not match branch length');
  }

  return { root: reverseHex(hash), mutated };
}

export async function merkleRootFromProof(txid, branch, pos) {
  return (await checkMerkleProof(txid, branch, pos)).root;
}

// =====================================================
// RAW TRANSACTIONS
// =====================================================

export const COINBASE_PREV_TXID = '0'.repeat(64);
export const COINBASE_PREV_VOUT = 0xffffffff;

// Parses a raw transaction (hex) far enough to compute its txid and list
// its inputs and outputs. Handles segwit (BIP144) serialization.
//
// Also returns:
//   coinbase  exactly one input, spending the null outpoint (all-zero txid,
//             index 0xffffffff): Bitcoin Core's CTransaction::IsCoinBase.
//   size      bytes as served, witness included
//   weight    BIP141 weight: legacy size x 3 + full size. The witness isn't
//             covered by the txid, so this proves only that the weight
//             matches these bytes.
export function parseTransaction(rawHex) {
  const bytes = hexToBytes(rawHex);
  let offset = 0;

  const need = n => {
    if (offset + n > bytes.length) {
      throw new Error('Truncated transaction');
    }
  };

  const take = n => {
    need(n);
    const slice = bytes.subarray(offset, offset + n);
    offset += n;
    return slice;
  };

  const varint = () => {
    need(1);
    const first = bytes[offset++];
    if (first < 0xfd) return first;
    if (first === 0xfd) { const b = take(2); return b[0] | (b[1] << 8); }
    if (first === 0xfe) { return readUInt32LE(take(4), 0); }
    const b = take(8);
    return readUInt32LE(b, 0) + readUInt32LE(b, 4) * 2 ** 32;
  };

  const start = 0;
  take(4); // version
  const afterVersion = offset;

  let segwit = false;
  if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
    segwit = true;
    offset += 2;
  }

  const bodyStart = offset;

  const vin = [];
  const vinCount = varint();
  for (let i = 0; i < vinCount; i++) {
    const prevTxid = bytesToHex(take(32).slice().reverse());
    const prevVout = readUInt32LE(take(4), 0);
    take(varint()); // scriptSig
    take(4);        // sequence
    vin.push({ txid: prevTxid, vout: prevVout });
  }

  const vout = [];
  const voutCount = varint();
  for (let i = 0; i < voutCount; i++) {
    const v = take(8);
    const value = readUInt32LE(v, 0) + readUInt32LE(v, 4) * 2 ** 32;
    const script = bytesToHex(take(varint()));
    vout.push({ value, scriptpubkey: script });
  }

  const bodyEnd = offset;

  if (segwit) {
    for (let i = 0; i < vinCount; i++) {
      const items = varint();
      for (let j = 0; j < items; j++) {
        take(varint());
      }
    }
  }

  const locktime = take(4);

  if (offset !== bytes.length) {
    throw new Error('Trailing bytes after transaction');
  }

  // txid commits to the legacy serialization: no marker, flag or witness.
  const legacyHex =
    bytesToHex(bytes.subarray(start, afterVersion)) +
    bytesToHex(bytes.subarray(bodyStart, bodyEnd)) +
    bytesToHex(locktime);

  const coinbase =
    vin.length === 1 &&
    vin[0].txid === COINBASE_PREV_TXID &&
    vin[0].vout === COINBASE_PREV_VOUT;

  const size = bytes.length;
  const weight = (legacyHex.length / 2) * 3 + size;

  return { segwit, vin, vout, legacyHex, coinbase, size, weight };
}

export async function txidFromRaw(rawHex) {
  const { legacyHex } = parseTransaction(rawHex);
  return reverseHex(await doubleSHA256(legacyHex));
}
