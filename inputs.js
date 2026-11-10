// inputs.js
// Checks a transaction's inputs against the raw transactions they spend.
// Pure (no network); covered by tests/inputs.test.mjs.
//
// Each input names an output of an earlier transaction (txid:vout). Given
// that earlier transaction's raw bytes we can check, without trusting
// anyone, that the bytes hash to that txid and that the output it names
// holds the amount and script the page shows for the input.

import {
  parseTransaction,
  txidFromRaw,
  COINBASE_PREV_TXID,
  COINBASE_PREV_VOUT
} from './spv.js';

// Is this transaction a coinbase, by Bitcoin's own rule rather than the
// provider's `is_coinbase` flag: exactly one input, spending the null
// outpoint. verifyTransactionContents checks these fields against the raw
// transaction, so a provider can't flag an ordinary input as "coinbase"
// to have it skipped.
export function isCoinbaseTx(tx) {
  const vin = tx.vin || [];
  return (
    vin.length === 1 &&
    vin[0].txid === COINBASE_PREV_TXID &&
    vin[0].vout === COINBASE_PREV_VOUT
  );
}

// Distinct parent txids the inputs spend from, in first-seen order.
export function parentTxids(tx) {
  if (isCoinbaseTx(tx)) {
    return [];
  }

  const seen = new Set();
  for (const vin of tx.vin || []) {
    seen.add(vin.txid);
  }
  return [...seen];
}

// tx:         the transaction as shown (Esplora JSON)
// rawByTxid:  { [parentTxid]: rawHex } for every parentTxids(tx)
// Resolves to {
//   ok,                         every non-coinbase input verified
//   perInput: [{ index, ok, coinbase?, value?, reason? }],
//                               `coinbase` only for a real coinbase
//                               (isCoinbaseTx), never from `is_coinbase`
//   parentsOk,                  every parent hashed to its txid
//   amountsOk,                  every amount and script matched
//   totalIn                     sum of verified input values (null if !ok)
// }
export async function checkSpentOutputs(tx, rawByTxid) {
  const parents = {};

  for (const txid of parentTxids(tx)) {
    const raw = rawByTxid[txid];

    if (!raw) {
      parents[txid] = { error: 'parent transaction not available' };
      continue;
    }

    try {
      const parsed = parseTransaction(raw);
      const hashOk = (await txidFromRaw(raw)) === txid;
      parents[txid] = { parsed, hashOk };
    } catch (err) {
      parents[txid] = { error: `parent transaction unreadable (${err.message})` };
    }
  }

  const coinbase = isCoinbaseTx(tx);

  const perInput = (tx.vin || []).map((vin, index) => {
    if (coinbase) {
      return { index, ok: true, coinbase: true };
    }

    const parent = parents[vin.txid];

    if (!parent || parent.error) {
      return { index, ok: false, reason: parent?.error || 'parent transaction not available' };
    }

    if (!parent.hashOk) {
      return { index, ok: false, reason: 'parent transaction does not hash to its txid' };
    }

    const out = parent.parsed.vout[vin.vout];

    if (!out) {
      return { index, ok: false, reason: `parent has no output ${vin.vout}` };
    }

    if (out.value !== vin.prevout?.value) {
      const fmt = n => (n ?? 0).toLocaleString('en-US');
      return { index, ok: false, value: out.value, reason: `amount is ${fmt(out.value)} sats in the parent, not ${fmt(vin.prevout?.value)}` };
    }

    if (out.scriptpubkey !== vin.prevout?.scriptpubkey) {
      return { index, ok: false, value: out.value, reason: 'script (address) differs from the parent' };
    }

    return { index, ok: true, value: out.value };
  });

  const spending = perInput.filter(p => !p.coinbase);

  const parentsOk = Object.values(parents).every(p => !p.error && p.hashOk);
  const amountsOk = spending.every(p => p.ok);
  const ok = parentsOk && amountsOk;

  return {
    ok,
    perInput,
    parentsOk,
    amountsOk,
    totalIn: ok ? spending.reduce((sum, p) => sum + p.value, 0) : null
  };
}
