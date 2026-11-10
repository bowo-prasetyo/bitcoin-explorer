// Synthetic SegWit blocks for the BIP141 tests, built here with Node's
// own SHA-256 rather than spv.js, so the tests don't check the code
// against itself. Not a test file itself.
import { createHash } from 'node:crypto';

const sha = buf => createHash('sha256').update(buf).digest();
const dsha = hex => sha(sha(Buffer.from(hex, 'hex'))).toString('hex'); // internal order
export const rev = hex => hex.match(/../g).reverse().join('');
export const le = (n, bytes) => {
  let h = '';
  for (let i = 0; i < bytes; i++) h += Number((BigInt(n) >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0');
  return h;
};
const push = hex => le(hex.length / 2, 1) + hex;

// A transaction: inputs [[prevTxidDisplay, vout, scriptSig]], outputs
// [[value, script]], witness: per input, a list of hex items (or null).
export function tx(inputs, outputs, witness = null) {
  const body =
    le(inputs.length, 1) +
    inputs.map(([t, v, ss]) => rev(t) + le(v, 4) + push(ss) + 'ffffffff').join('') +
    le(outputs.length, 1) +
    outputs.map(([v, spk]) => le(v, 8) + push(spk)).join('');
  const legacy = '02000000' + body + '00000000';
  const full = witness
    ? '02000000' + '0001' + body + witness.map(items => le(items.length, 1) + items.map(push).join('')).join('') + '00000000'
    : legacy;
  return {
    hex: full,
    txid: rev(dsha(legacy)),
    wtxid: rev(dsha(full)),
    size: full.length / 2,
    weight: (legacy.length / 2) * 3 + full.length / 2
  };
}

// Merkle root (internal order) of internal-order hashes.
function root(hashes) {
  let layer = hashes;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(dsha(layer[i] + (layer[i + 1] ?? layer[i])));
    layer = next;
  }
  return layer[0];
}

const NULL = '00'.repeat(32);
export const RESERVED = 'ab'.repeat(32);

// The commitment a coinbase must carry for these (non-coinbase) txs.
export const witnessCommitment = others =>
  dsha(root([NULL, ...others.map(t => rev(t.wtxid))]) + RESERVED);

// A block: a coinbase plus `others`. commit: true writes the BIP141
// commitment for these transactions; a hex string writes that instead.
// coinbaseWitness overrides the coinbase's witness stack; earlier, if set,
// is another commitment written before the real one.
export function block(others, { commit = true, coinbaseWitness = [[RESERVED]], earlier = null } = {}) {
  const commitment = typeof commit === 'string' ? commit : witnessCommitment(others);
  const outputs = [[312_500_000, '51']];
  if (earlier) outputs.push([0, '6a24aa21a9ed' + earlier]);
  if (commit) outputs.push([0, '6a24aa21a9ed' + commitment]);
  const cb = tx([[NULL, 0xffffffff, '03' + le(900123, 3)]], outputs, commit ? coinbaseWitness : null);

  const all = [cb, ...others];
  const merkleRoot = root(all.map(t => rev(t.txid)));
  const header = '00000020' + '11'.repeat(32) + merkleRoot + le(1762000000, 4) + 'ffff001d' + '00000000';
  const hex = header + le(all.length, 1) + all.map(t => t.hex).join('');

  return { hex, header, merkleRoot: rev(merkleRoot), hash: rev(dsha(header)), coinbase: cb, txs: all };
}

// A SegWit spend with one witness item.
export const segwitSpend = (sig = 'cd'.repeat(72)) =>
  tx([['22'.repeat(32), 0, '']], [[50_000, '0014' + 'aa'.repeat(20)]], [[sig, '02' + 'bb'.repeat(32)]]);
export const legacySpend = () =>
  tx([['33'.repeat(32), 1, '51']], [[40_000, '0014' + 'cc'.repeat(20)]]);
