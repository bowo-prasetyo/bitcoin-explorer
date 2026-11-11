// sha256.js
// Synchronous SHA-256, for hashing many small inputs fast: checking a
// full header chain means about a million double hashes of 80 bytes, and
// crypto.subtle costs a promise and a copy per call. Pure; covered by
// tests/sha256.test.mjs, which compares it with crypto.subtle.
//
// FIPS 180-4. The implementation is the plain textbook one over 32-bit
// integers; nothing here is secret, so constant time doesn't matter.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const IV = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

// Scratch space, reused: these functions are synchronous, so calls can't
// interleave.
const W = new Int32Array(64);
const H = new Int32Array(8);
const BLOCK = new Uint8Array(64);
const MID = new Uint8Array(32);

// One 64-byte block of `bytes` at `offset` into the state H.
function compress(bytes, offset) {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }

  for (let i = 16; i < 64; i++) {
    const a = W[i - 15];
    const b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }

  let a = H[0], b = H[1], c = H[2], d = H[3];
  let e = H[4], f = H[5], g = H[6], h = H[7];

  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;

    h = g; g = f; f = e;
    e = (d + t1) | 0;
    d = c; c = b; b = a;
    a = (t1 + t2) | 0;
  }

  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
  H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
  H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
}

function writeState(out, outOffset) {
  for (let i = 0; i < 8; i++) {
    const v = H[i];
    const j = outOffset + i * 4;
    out[j] = v >>> 24;
    out[j + 1] = (v >>> 16) & 0xff;
    out[j + 2] = (v >>> 8) & 0xff;
    out[j + 3] = v & 0xff;
  }
}

// SHA-256 of bytes[offset, offset + length) into out[outOffset, +32).
function hashInto(bytes, offset, length, out, outOffset) {
  H.set(IV);

  let pos = 0;
  for (; pos + 64 <= length; pos += 64) {
    compress(bytes, offset + pos);
  }

  // Padding: 0x80, zeros, then the length in bits as 64-bit big-endian.
  const rest = length - pos;
  BLOCK.fill(0);
  for (let i = 0; i < rest; i++) BLOCK[i] = bytes[offset + pos + i];
  BLOCK[rest] = 0x80;

  if (rest >= 56) {
    compress(BLOCK, 0);
    BLOCK.fill(0);
  }

  const bits = length * 8;
  BLOCK[59] = bits / 0x100000000 >>> 24; // lengths here never exceed 2^32 bits
  BLOCK[60] = bits >>> 24;
  BLOCK[61] = (bits >>> 16) & 0xff;
  BLOCK[62] = (bits >>> 8) & 0xff;
  BLOCK[63] = bits & 0xff;
  compress(BLOCK, 0);

  writeState(out, outOffset);
}

// SHA-256 of a Uint8Array; returns a new 32-byte Uint8Array.
export function sha256(bytes) {
  const out = new Uint8Array(32);
  hashInto(bytes, 0, bytes.length, out, 0);
  return out;
}

// SHA256(SHA256(bytes[offset, offset + length))) into out[outOffset, +32),
// in internal byte order (reverse it for a block hash or txid as shown).
export function doubleSha256Into(bytes, offset, length, out, outOffset = 0) {
  hashInto(bytes, offset, length, MID, 0);
  hashInto(MID, 0, 32, out, outOffset);
}

// SHA256(SHA256(bytes)); returns a new 32-byte Uint8Array.
export function doubleSha256(bytes) {
  const out = new Uint8Array(32);
  doubleSha256Into(bytes, 0, bytes.length, out, 0);
  return out;
}
