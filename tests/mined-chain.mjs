// A test header chain mined at regtest's easy proof-of-work limit, with
// Bitcoin's retargets applied, for tests that need many valid headers.
// Not a test file itself (no .test. in the name).

import { doubleSha256Into } from '../sha256.js';
import { targetFromBits } from '../spv.js';
import { nextBits, RETARGET_INTERVAL } from '../difficulty.js';

export const EASY_BITS = 0x207fffff;
export const LIMIT = targetFromBits(EASY_BITS);

// `n` consecutive raw headers from a genesis block, 600 s apart.
export function mineChain(n) {
  const buf = new Uint8Array(n * 80);
  const view = new DataView(buf.buffer);
  const hash = new Uint8Array(32);
  let prev = new Uint8Array(32);
  let time = 1_700_000_000;
  let bits = EASY_BITS;
  let periodStart = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 80;
    time += 600;
    if (i > 0 && i % RETARGET_INTERVAL === 0) bits = nextBits(bits, periodStart, time - 600, LIMIT).bits;
    if (i % RETARGET_INTERVAL === 0) periodStart = time;
    const target = targetFromBits(bits);

    view.setInt32(o, 0x20000000, true);
    buf.set(prev, o + 4);
    buf.fill(i & 0xff, o + 36, o + 68);
    view.setUint32(o + 68, time, true);
    view.setUint32(o + 72, bits, true);

    for (let nonce = 0; ; nonce++) {
      view.setUint32(o + 76, nonce, true);
      doubleSha256Into(buf, o, 80, hash);
      if (BigInt('0x' + Buffer.from(hash).reverse().toString('hex')) <= target) break;
    }
    prev = hash.slice();
  }
  return buf;
}

// Display-order hash of header `h` in `chain`.
export function hashAt(chain, h) {
  const out = new Uint8Array(32);
  doubleSha256Into(chain, h * 80, 80, out);
  return Buffer.from(out).reverse().toString('hex');
}

// headerchain.js parameters for a chain from mineChain().
export function paramsFor(chain) {
  return { genesisHash: hashAt(chain, 0), powLimit: LIMIT, minVersions: [] };
}
