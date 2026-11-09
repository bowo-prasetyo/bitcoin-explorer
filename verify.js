// verify.js
// Checks what providers tell us, in the browser, using spv.js.
//
// Every check fetches *raw* data (an 80-byte header, raw transaction
// bytes, a merkle branch, txid lists) and recomputes the facts the UI
// shows from it. A provider can still refuse to answer or answer with
// different raw data, but it cannot make a check pass with data that
// doesn't hash correctly.
//
// Each verifier resolves to a result the <verify-badge> renders:
//   {
//     state:   'ok'    every check passed
//              'fail'  a check failed: the provider's data is inconsistent
//              'error' the check couldn't run (network, missing data)
//              'na'    nothing to check (e.g. unconfirmed transaction)
//     title:   one line for the badge
//     checks:  [{ label, ok }]           what was checked
//     facts:   [{ label, value }]        extra numbers worth showing
//     note:    optional sentence on what this does NOT prove
//   }

import {
  getBlockHash,
  getBlockHeader,
  getBlockTxids,
  getTxHex,
  getMerkleProof,
  getTipFromEach,
  getBlockHashFrom
} from './api.js';

import {
  verifyHeaderPoW,
  computeMerkleRoot,
  merkleRootFromProof,
  parseTransaction,
  txidFromRaw
} from './spv.js';

import { compareTips } from './consensus.js';

import { parentTxids, checkSpentOutputs } from './inputs.js';

import { formatBtc, formatSats } from './format.js';

import { ApiError } from './api.js';

import { headersNeeded, checkDifficulty } from './difficulty.js';

import { get, put } from './db.js';

// =====================================================
// HELPERS
// =====================================================

function result(state, title, checks = [], extra = {}) {
  return { state, title, checks, facts: [], ...extra };
}

function errorResult(title, err) {
  return result('error', title, [], {
    note: err?.message || String(err)
  });
}

function allOk(checks) {
  return checks.every(c => c.ok);
}

// 1.23e23 -> "1.2 × 10²³"
const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

export function formatBigPower(big) {
  const digits = big.toString();
  if (digits.length <= 6) {
    return Number(big).toLocaleString('en-US');
  }
  const exponent = digits.length - 1;
  const mantissa = `${digits[0]}.${digits[1]}`;
  const sup = String(exponent).split('').map(d => SUPERSCRIPT[d]).join('');
  return `${mantissa} × 10${sup}`;
}

function formatDifficulty(d) {
  if (d >= 1e12) return `${(d / 1e12).toFixed(2)} T`;
  if (d >= 1e9) return `${(d / 1e9).toFixed(2)} G`;
  if (d >= 1e6) return `${(d / 1e6).toFixed(2)} M`;
  return d.toLocaleString('en-US');
}

const ZERO_HASH = '0'.repeat(64);

// =====================================================
// HEADERS (cached raw, always re-verified)
// =====================================================

// Fetches (or reuses) a raw header and verifies its proof of work.
// The cached copy is only raw bytes; the verdict is recomputed every time.
export async function loadVerifiedHeader(hash, height = null) {
  let hex = null;

  if (height !== null) {
    const cached = await get('headers', height).catch(() => null);
    if (cached?.hash === hash) {
      hex = cached.hex;
    }
  }

  if (!hex) {
    hex = await getBlockHeader(hash);
  }

  const pow = await verifyHeaderPoW(hex, hash);

  if (pow.ok && height !== null) {
    await put('headers', { height, hash, hex }).catch(() => {});
  }

  return { hex, pow };
}

function powChecks(pow) {
  return [
    { label: 'Header hashes to this block id', ok: pow.checks.hashMatches },
    { label: 'Hash meets the difficulty target in the header', ok: pow.checks.meetsTarget },
    { label: 'Target is within mainnet limits', ok: pow.checks.withinPowLimit }
  ];
}

function powFacts(pow) {
  return [
    { label: 'Difficulty', value: formatDifficulty(pow.difficulty) },
    { label: 'Expected work', value: `${formatBigPower(pow.expectedHashes)} hashes` }
  ];
}

// =====================================================
// BLOCKS
// =====================================================

// Proof of work, and that the displayed block matches its header.
export async function verifyBlockHeader(block) {
  try {
    const { pow } = await loadVerifiedHeader(block.id, block.height);
    const h = pow.header;

    const checks = [
      ...powChecks(pow),
      {
        label: 'Displayed details match the header (time, merkle root, previous block)',
        ok:
          h.timestamp === block.timestamp &&
          h.merkleRoot === block.merkle_root &&
          h.previousBlockHash === (block.previousblockhash || ZERO_HASH) &&
          (block.bits === undefined || h.bits === block.bits) &&
          (block.nonce === undefined || h.nonce === block.nonce)
      }
    ];

    const ok = allOk(checks);

    return result(
      ok ? 'ok' : 'fail',
      ok ? 'Proof of work verified' : 'Proof of work check FAILED',
      checks,
      {
        facts: powFacts(pow),
        merkleRoot: h.merkleRoot,
        header: ok ? h : null,
        note: ok
          ? 'Checks this block on its own. It does not prove the block is on the ' +
            'chain with the most work; see the tip check on the home page.'
          : undefined
      }
    );
  } catch (err) {
    return errorResult("Couldn't check proof of work", err);
  }
}

// Header at `height`, proof of work verified. Headers at least six blocks
// below the tip are reused from the local cache by height (no request);
// they are re-verified every time all the same.
const DEEP = 6;

async function loadHeaderAtHeight(height, tipHeight, useCache) {
  if (useCache && tipHeight !== null && tipHeight - height >= DEEP) {
    const cached = await get('headers', height).catch(() => null);

    if (cached) {
      const pow = await verifyHeaderPoW(cached.hex, cached.hash);
      if (pow.ok) {
        return { hash: cached.hash, pow };
      }
    }
  }

  const hash = await getBlockHash(height);
  const { pow } = await loadVerifiedHeader(hash, height);
  return { hash, pow };
}

async function runDifficultyCheck(block, header, tipHeight, useCache) {
  const heights = headersNeeded(block.height);

  const loaded = await Promise.all(
    heights.map(h => loadHeaderAtHeight(h, tipHeight, useCache))
  );

  const headers = {};
  heights.forEach((h, i) => {
    const { hash, pow } = loaded[i];
    headers[h] = {
      hash,
      bits: pow.header.bits,
      timestamp: pow.header.timestamp,
      previousBlockHash: pow.header.previousBlockHash,
      powOk: pow.ok
    };
  });

  return checkDifficulty(
    {
      height: block.height,
      hash: block.id,
      // From the verified header, not the provider's JSON.
      bits: header.bits,
      previousBlockHash: header.previousBlockHash
    },
    headers
  );
}

// That the block's difficulty is the one Bitcoin's rules require at its
// height. `header` is the block's own header from verifyBlockHeader.
export async function verifyBlockDifficulty(block, header, tipHeight = null) {
  if (!header) {
    return result('error', 'Difficulty needs a checked block header first');
  }

  try {
    let r = await runDifficultyCheck(block, header, tipHeight, true);

    // A cached header could be from a since-replaced block at the tip;
    // never report a failure without checking against fresh headers.
    if (!r.ok) {
      r = await runDifficultyCheck(block, header, tipHeight, false);
    }

    const height = block.height.toLocaleString('en-US');

    return result(
      r.ok ? 'ok' : 'fail',
      r.ok
        ? `Difficulty is correct for block ${height}`
        : 'Difficulty check FAILED',
      r.checks,
      {
        facts: r.facts,
        note: block.height < 2016
          ? 'Every block in the first period has difficulty 1.'
          : 'Checks one retarget step, from proof-of-work-checked headers. ' +
            "The previous period's difficulty is taken from its headers rather " +
            'than re-derived back to the genesis block, and blocks between the ' +
            "period's start and this one aren't linked header by header."
      }
    );
  } catch (err) {
    return errorResult("Couldn't check the difficulty", err);
  }
}

// That the full transaction list rebuilds the header's merkle root, and
// that the transactions on screen are in it, in position.
export async function verifyBlockTransactions(block, merkleRoot, shown = [], firstIndex = 0) {
  try {
    const txids = await getBlockTxids(block.id);
    const root = await computeMerkleRoot(txids);

    const checks = [
      { label: `All ${txids.length.toLocaleString('en-US')} txids rebuild the header's merkle root`, ok: root === merkleRoot },
      { label: 'Transaction count matches', ok: txids.length === block.tx_count },
      {
        label: 'Transactions on this page are in that list, in order',
        ok: shown.every((tx, i) => txids[firstIndex + i] === tx.txid)
      }
    ];

    const ok = allOk(checks);

    return result(
      ok ? 'ok' : 'fail',
      ok ? 'Transaction list verified' : 'Transaction list check FAILED',
      checks
    );
  } catch (err) {
    return errorResult("Couldn't check the transaction list", err);
  }
}

// =====================================================
// TRANSACTIONS
// =====================================================

// That the raw transaction hashes to its txid and contains the outputs
// (and spends the inputs) shown on screen.
export async function verifyTransactionContents(tx) {
  try {
    const raw = await getTxHex(tx.txid);
    const parsed = parseTransaction(raw);
    const txid = await txidFromRaw(raw);

    const outputsMatch =
      parsed.vout.length === tx.vout.length &&
      parsed.vout.every((o, i) =>
        o.value === tx.vout[i].value &&
        o.scriptpubkey === tx.vout[i].scriptpubkey
      );

    const inputsMatch =
      parsed.vin.length === tx.vin.length &&
      parsed.vin.every((v, i) =>
        tx.vin[i].is_coinbase ||
        (v.txid === tx.vin[i].txid && v.vout === tx.vin[i].vout)
      );

    const checks = [
      { label: 'Raw transaction hashes to this txid', ok: txid === tx.txid },
      { label: 'Output amounts and scripts match what is shown', ok: outputsMatch },
      { label: 'Spent outputs (inputs) match what is shown', ok: inputsMatch }
    ];

    const ok = allOk(checks);

    return result(
      ok ? 'ok' : 'fail',
      ok ? 'Contents verified' : 'Contents check FAILED',
      checks,
      {
        note: ok
          ? 'Input amounts and the fee are checked separately, against the ' +
            'transactions whose outputs are being spent.'
          : undefined,
        // Verified output total, for the fee check.
        outputTotal: ok ? parsed.vout.reduce((sum, o) => sum + o.value, 0) : null
      }
    );
  } catch (err) {
    return errorResult("Couldn't check the transaction contents", err);
  }
}

// Above this many parent transactions, checking waits for the user.
export const INPUT_CHECK_AUTO_LIMIT = 25;
const INPUT_FETCH_CONCURRENCY = 6;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );

  return out;
}

// That every input's amount (and script) is what the transaction it
// spends from says, by hashing each parent's raw bytes; then, with the
// outputs verified by verifyTransactionContents, that the fee adds up.
export async function verifyTransactionInputs(tx, { outputTotal = null, force = false } = {}) {
  if (tx.vin?.[0]?.is_coinbase) {
    return result('na', 'Coinbase: it creates new coins, so there are no spent amounts to check.');
  }

  const parents = parentTxids(tx);

  if (parents.length > INPUT_CHECK_AUTO_LIMIT && !force) {
    return result(
      'na',
      `Spends from ${parents.length.toLocaleString('en-US')} earlier transactions; not checked automatically`,
      [],
      { needsConfirm: true, parentCount: parents.length }
    );
  }

  try {
    const raws = {};
    let unreachable = 0;

    await mapLimit(parents, INPUT_FETCH_CONCURRENCY, async txid => {
      try {
        raws[txid] = await getTxHex(txid);
      } catch (err) {
        // "Not found" for a transaction the provider itself listed as an
        // input is an inconsistency, checked as a failure below. Anything
        // else means we couldn't check.
        if (!(err instanceof ApiError && err.kind === 'not_found')) {
          unreachable++;
        }
      }
    });

    if (unreachable) {
      return result(
        'error',
        `Couldn't download ${unreachable} of ${parents.length} spent transactions`
      );
    }

    const r = await checkSpentOutputs(tx, raws);

    const checks = [
      {
        label: parents.length === 1
          ? 'The spent transaction hashes to its txid'
          : `All ${parents.length.toLocaleString('en-US')} spent transactions hash to their txids`,
        ok: r.parentsOk
      },
      {
        label: 'Each input amount and address matches the output it spends',
        ok: r.amountsOk
      }
    ];

    const feeCheckable = r.ok && outputTotal !== null;
    const computedFee = feeCheckable ? r.totalIn - outputTotal : null;

    if (feeCheckable) {
      checks.push({
        label: `Fee = inputs − outputs = ${formatSats(computedFee)}, as shown`,
        ok: computedFee === tx.fee
      });
    }

    const ok = checks.every(c => c.ok);

    const facts = r.ok
      ? [
          { label: 'Inputs total', value: formatBtc(r.totalIn) },
          ...(feeCheckable ? [{ label: 'Fee (recomputed)', value: formatBtc(computedFee) }] : [])
        ]
      : [];

    return result(
      ok ? 'ok' : 'fail',
      ok
        ? (feeCheckable ? 'Input amounts and fee verified' : 'Input amounts verified')
        : 'Input amounts check FAILED',
      checks,
      {
        facts,
        perInput: r.perInput,
        note: ok
          ? (feeCheckable ? '' : 'The fee needs verified outputs, which the contents check above could not provide. ') +
            'This proves each amount from the transaction that created it, not that ' +
            'those outputs were still unspent; that takes the full set of unspent ' +
            'outputs, which only full nodes keep.'
          : undefined
      }
    );
  } catch (err) {
    return errorResult("Couldn't check the input amounts", err);
  }
}

// That the transaction is in a block whose proof of work checks out.
export async function verifyTransactionInclusion(tx) {
  if (!tx.status?.confirmed) {
    return result('na', 'Not in a block yet, so there is nothing to prove.');
  }

  try {
    const [proof, { pow }] = await Promise.all([
      getMerkleProof(tx.txid),
      loadVerifiedHeader(tx.status.block_hash, tx.status.block_height)
    ]);

    const root = await merkleRootFromProof(tx.txid, proof.merkle, proof.pos);

    const checks = [
      { label: 'Merkle proof leads from this txid to the block header', ok: root === pow.header.merkleRoot },
      { label: 'Block header has valid proof of work', ok: pow.ok },
      { label: 'Proof is for the block shown', ok: proof.block_height === tx.status.block_height }
    ];

    const ok = allOk(checks);

    return result(
      ok ? 'ok' : 'fail',
      ok
        ? `Inclusion in block ${tx.status.block_height.toLocaleString('en-US')} verified`
        : 'Inclusion check FAILED',
      checks,
      {
        facts: [
          { label: 'Position in block', value: `#${(proof.pos + 1).toLocaleString('en-US')}` },
          { label: 'Proof size', value: `${proof.merkle.length} hashes` }
        ]
      }
    );
  } catch (err) {
    return errorResult("Couldn't check inclusion", err);
  }
}

// =====================================================
// CHAIN TIP (across providers)
// =====================================================

export async function verifyTip() {
  try {
    const tips = await getTipFromEach();

    // A tip only counts if its header carries valid proof of work.
    for (const t of tips) {
      if (!t.ok) continue;

      try {
        const pow = await verifyHeaderPoW(t.header, t.hash);
        if (!pow.ok) {
          Object.assign(t, { ok: false, error: 'tip header failed proof-of-work check' });
        }
      } catch {
        Object.assign(t, { ok: false, error: 'invalid tip header' });
      }
    }

    // For providers behind the leader, ask the leader what it has at their
    // height, to tell "behind on the same chain" from "a different chain".
    const responding = tips.filter(t => t.ok);
    const leader = responding.reduce((a, b) => (!a || b.height > a.height ? b : a), null);
    const leaderHashes = {};

    for (const t of responding) {
      if (t !== leader && t.height < leader.height) {
        try {
          leaderHashes[t.height] = await getBlockHashFrom(leader.base, t.height);
        } catch {
          // unknown: compareTips reports "behind"
        }
      }
    }

    const cmp = compareTips(tips, leaderHashes);

    const titles = {
      agree: `All ${cmp.responded} providers agree on the tip`,
      behind: 'Providers agree; one is catching up',
      conflict: 'Providers DISAGREE on the chain',
      single: cmp.total === 1
        ? 'Only one provider configured: nothing to compare'
        : 'Only one provider answered: nothing to compare',
      unavailable: "Couldn't reach any provider"
    };

    const state = {
      agree: 'ok',
      behind: 'ok',
      conflict: 'fail',
      single: 'na',
      unavailable: 'error'
    }[cmp.state];

    const short = h => `${h.slice(0, 8)}…${h.slice(-6)}`;

    const checks = tips.map(t => {
      if (!t.ok) {
        return { label: `${t.name}: ${t.error}`, ok: false };
      }

      const lag = cmp.lagging.find(l => l.name === t.name);
      const conflicting = cmp.conflicts.includes(t.name);

      return {
        label:
          `${t.name}: block ${t.height.toLocaleString('en-US')} (${short(t.hash)})` +
          (lag ? `, ${lag.by.toLocaleString('en-US')} behind on the same chain` : '') +
          (conflicting ? ', on a DIFFERENT chain' : ''),
        ok: !conflicting
      };
    });

    return {
      ...result(state, titles[cmp.state], checks),
      comparison: cmp,
      providers: tips.map(t => ({
        name: t.name,
        ok: t.ok,
        height: t.height,
        hash: t.hash,
        error: t.error
      })),
      note:
        'Each tip header is checked for proof of work. Agreement between ' +
        'independent providers makes it much harder for one of them to show ' +
        'you a fake or stale chain.'
    };
  } catch (err) {
    return errorResult("Couldn't compare providers", err);
  }
}
