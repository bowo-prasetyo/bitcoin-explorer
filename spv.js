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

  return parseHeaderBytes(hexToBytes(headerHex));
}

// The same fields, read from 80 raw bytes at `offset` (for header chains
// stored as bytes, with no hex round-trip).
export function parseHeaderBytes(bytes, offset = 0) {
  if (bytes.length - offset < 80) {
    throw new Error('A block header is 80 bytes');
  }

  const displayHex = (from, to) => bytesToHex(bytes.slice(offset + from, offset + to).reverse());

  return {
    version: readUInt32LE(bytes, offset),
    previousBlockHash: displayHex(4, 36),
    merkleRoot: displayHex(36, 68),
    timestamp: readUInt32LE(bytes, offset + 68),
    bits: readUInt32LE(bytes, offset + 72),
    nonce: readUInt32LE(bytes, offset + 76)
  };
}

// The 80-byte header (hex) rebuilt from an Esplora block's JSON fields.
// Hashing it and comparing with the block's id checks every field: a
// provider can't change one without the hash changing too.
export function headerFromBlockJson(b) {
  const u32 = n => {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
      throw new Error('Invalid header field');
    }
    return bytesToHex([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  };
  const hash = h => {
    if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error('Invalid header hash');
    return reverseHex(h.toLowerCase());
  };

  return (
    u32(b.version) +
    (b.previousblockhash ? hash(b.previousblockhash) : '00'.repeat(32)) +
    hash(b.merkle_root) +
    u32(b.timestamp) +
    u32(b.bits) +
    u32(b.nonce)
  );
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
  const tx = readTransaction(bytes, 0);

  if (tx.end !== bytes.length) {
    throw new Error('Trailing bytes after transaction');
  }

  return tx;
}

// Reads one transaction from `bytes` at `start` (a raw transaction, or
// one inside a raw block). Returns parseTransaction's fields plus:
//   end      offset just after the transaction
//   fullHex  its bytes as served, witness included (hashes to the wtxid)
//   witness  each input's witness stack, as hex items ([] without one)
function readTransaction(bytes, start) {
  let offset = start;

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
    const scriptSig = bytesToHex(take(varint()));
    take(4);        // sequence
    vin.push({ txid: prevTxid, vout: prevVout, scriptSig });
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

  const witness = vin.map(() => []);
  if (segwit) {
    for (let i = 0; i < vinCount; i++) {
      const items = varint();
      for (let j = 0; j < items; j++) {
        witness[i].push(bytesToHex(take(varint())));
      }
    }
  }

  const locktime = take(4);

  // txid commits to the legacy serialization: no marker, flag or witness.
  const legacyHex =
    bytesToHex(bytes.subarray(start, afterVersion)) +
    bytesToHex(bytes.subarray(bodyStart, bodyEnd)) +
    bytesToHex(locktime);

  const coinbase =
    vin.length === 1 &&
    vin[0].txid === COINBASE_PREV_TXID &&
    vin[0].vout === COINBASE_PREV_VOUT;

  const size = offset - start;
  const weight = (legacyHex.length / 2) * 3 + size;

  return {
    segwit, vin, vout, legacyHex, coinbase, size, weight, witness,
    end: offset,
    fullHex: bytesToHex(bytes.subarray(start, offset))
  };
}

export async function txidFromRaw(rawHex) {
  const { legacyHex } = parseTransaction(rawHex);
  return reverseHex(await doubleSHA256(legacyHex));
}

// =====================================================
// BIP34: BLOCK HEIGHT IN THE COINBASE
// =====================================================

// From this height on, mainnet requires every block's coinbase scriptSig
// to start with the block's height (Bitcoin Core: consensus.BIP34Height,
// block 000000000000024b89b42a942fe0d9fea3bb44ab7bd1b19115dd6a759c0808b8).
export const BIP34_HEIGHT = 227931;

// The script bytes Bitcoin Core requires at the start of the coinbase
// scriptSig: CScript() << nHeight. Heights 1-16 are a single opcode
// (OP_1..OP_16); others push their minimal little-endian CScriptNum, with
// an extra 0x00 byte when the top bit would otherwise read as a sign.
export function bip34Prefix(height) {
  if (!Number.isInteger(height) || height < 0 || height > 0x7fffffff) {
    throw new Error('Invalid height');
  }

  if (height === 0) return '00';                       // OP_0
  if (height <= 16) return (0x50 + height).toString(16); // OP_1..OP_16

  const bytes = [];
  for (let n = height; n > 0; n = Math.floor(n / 256)) {
    bytes.push(n % 256);
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(0);
  }

  return bytesToHex([bytes.length, ...bytes]);
}

// The height a coinbase scriptSig commits to: its first push read as a
// little-endian number, or null when it doesn't start with a small push.
// For display only; checkCoinbaseHeight() is the rule.
export function heightInScriptSig(scriptSigHex) {
  const bytes = hexToBytes(scriptSigHex);
  const len = bytes[0];

  if (!(len >= 1 && len <= 5) || bytes.length < 1 + len) {
    return null;
  }

  let n = 0;
  for (let i = len; i >= 1; i--) {
    n = n * 256 + bytes[i];
  }
  return n;
}

// Bitcoin Core's ContextualCheckBlock (bad-cb-height): does this raw
// coinbase commit to `height`? Returns
//   { ok, applies, coinbase, claimed }
// `applies` is false before BIP34_HEIGHT, where blocks carry no height.
export function checkCoinbaseHeight(rawHex, height) {
  const tx = parseTransaction(rawHex);
  const scriptSig = tx.coinbase ? tx.vin[0].scriptSig : null;

  if (height < BIP34_HEIGHT) {
    return { ok: true, applies: false, coinbase: tx.coinbase, claimed: null };
  }

  return {
    ok: scriptSig !== null && scriptSig.startsWith(bip34Prefix(height)),
    applies: true,
    coinbase: tx.coinbase,
    claimed: scriptSig === null ? null : heightInScriptSig(scriptSig)
  };
}

// =====================================================
// BIP141: THE WITNESS COMMITMENT
// =====================================================

// A transaction's witness (signatures) isn't covered by its txid, so a
// provider could swap it, changing the size, weight and fee rate shown.
// Since SegWit, each block's coinbase commits to every transaction's full
// bytes: the witness Merkle root over wtxids (the coinbase's counted as
// zero), hashed with a 32-byte reserved value from the coinbase's witness,
// in the last coinbase output whose script starts 6a24aa21a9ed.

const WITNESS_COMMITMENT_PREFIX = '6a24aa21a9ed';

// Parses a raw block (hex) and checks Bitcoin Core's witness rules
// (validation.cpp, CheckWitnessMalleation). Resolves to {
//   header,                       parsed 80-byte header
//   merkleRoot, mutated,          txids rebuilt from the block's bytes
//   txs: [{ txid, wtxid, size, weight, segwit }],
//   hasWitness,                   any transaction carries witness data
//   commitment: 'match' | 'mismatch' | 'malformed' | 'none',
//   ok                            witness data is committed (or absent)
// }
export async function checkWitnessCommitment(blockHex) {
  const bytes = hexToBytes(blockHex);
  if (bytes.length < 81) {
    throw new Error('Truncated block');
  }

  const header = parseHeader(blockHex.slice(0, 160));

  let offset = 80;
  const first = bytes[offset++];
  let count;
  if (first < 0xfd) count = first;
  else if (first === 0xfd) { count = bytes[offset] | (bytes[offset + 1] << 8); offset += 2; }
  else if (first === 0xfe) { count = readUInt32LE(bytes, offset); offset += 4; }
  else throw new Error('Too many transactions');

  if (count < 1) {
    throw new Error('A block has at least one transaction');
  }

  const parsed = [];
  for (let i = 0; i < count; i++) {
    const tx = readTransaction(bytes, offset);
    parsed.push(tx);
    offset = tx.end;
  }

  if (offset !== bytes.length) {
    throw new Error('Trailing bytes after the last transaction');
  }

  const txs = [];
  for (const [i, tx] of parsed.entries()) {
    txs.push({
      txid: reverseHex(await doubleSHA256(tx.legacyHex)),
      // The coinbase's wtxid is defined as zero.
      wtxid: i === 0 ? '00'.repeat(32) : reverseHex(await doubleSHA256(tx.fullHex)),
      size: tx.size,
      weight: tx.weight,
      segwit: tx.witness.some(stack => stack.length > 0)
    });
  }

  const { root: merkleRoot, mutated } = await computeMerkleRootChecked(txs.map(t => t.txid));
  const hasWitness = txs.some(t => t.segwit);

  const coinbase = parsed[0];
  let index = -1;
  coinbase.vout.forEach((o, i) => {
    if (o.scriptpubkey.length >= 76 && o.scriptpubkey.startsWith(WITNESS_COMMITMENT_PREFIX)) {
      index = i;
    }
  });

  let commitment;
  if (index === -1) {
    commitment = 'none';
  } else {
    const reserved = coinbase.witness[0];
    if (reserved.length !== 1 || reserved[0].length !== 64) {
      commitment = 'malformed';
    } else {
      const witnessRoot = reverseHex((await computeMerkleRootChecked(txs.map(t => t.wtxid))).root);
      const expected = await doubleSHA256(witnessRoot + reserved[0]);
      const committed = coinbase.vout[index].scriptpubkey.slice(12, 76);
      commitment = expected === committed ? 'match' : 'mismatch';
    }
  }

  return {
    header,
    merkleRoot,
    mutated,
    txs,
    hasWitness,
    commitment,
    ok: commitment === 'match' || (commitment === 'none' && !hasWitness)
  };
}
