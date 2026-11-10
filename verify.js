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
  getBlockHashFrom,
  getBlockHashFromEach,
  recordTipCheck
} from './api.js';

import {
  verifyHeaderPoW,
  computeMerkleRootChecked,
  checkMerkleProof,
  parseTransaction,
  txidFromRaw
} from './spv.js';

import { compareTips, checkTipHeaders } from './consensus.js';

import { parentTxids, checkSpentOutputs, isCoinbaseTx } from './inputs.js';

import { formatBtc, formatSats } from './format.js';

import { ApiError } from './api.js';

import {
  headersNeeded,
  checkDifficulty,
  checkDifficultyHistory,
  periodStart,
  RETARGET_INTERVAL,
  GENESIS_HASH
} from './difficulty.js';

import {
  periodStarts,
  chainWork,
  chainWorkHex,
  log2,
  yearsToRedo,
  formatRedoTime
} from './chainwork.js';

import { get, put } from './db.js';

import { historySeries } from './history.js';

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
  if (d === null) return '–';
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
    { label: 'Expected work', value: pow.expectedHashes === null ? '–' : `${formatBigPower(pow.expectedHashes)} hashes` }
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
        label: 'Displayed details match the header (time, Merkle root, previous block)',
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
    const { root, mutated } = await computeMerkleRootChecked(txids);

    const checks = [
      { label: `All ${txids.length.toLocaleString('en-US')} txids rebuild the header's Merkle root`, ok: root === merkleRoot },
      // CVE-2012-2459: repeating the last txid(s) rebuilds the same root.
      { label: 'No transaction is listed twice', ok: !mutated && new Set(txids).size === txids.length },
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

    // Every input, coinbase or not: a provider must not be able to flag
    // an ordinary input as "coinbase" to have it skipped.
    const inputsMatch =
      parsed.vin.length === tx.vin.length &&
      parsed.vin.every((v, i) =>
        v.txid === tx.vin[i].txid && v.vout === tx.vin[i].vout
      );

    // Coinbase by Bitcoin's rule (one input spending the null outpoint),
    // and the page's coinbase labels say the same.
    const coinbaseMatch =
      isCoinbaseTx(tx) === parsed.coinbase &&
      tx.vin.every(v => !!v.is_coinbase === parsed.coinbase);

    const checks = [
      { label: 'Raw transaction hashes to this txid', ok: txid === tx.txid },
      { label: 'Output amounts and scripts match what is shown', ok: outputsMatch },
      { label: 'Spent outputs (inputs) match what is shown', ok: inputsMatch },
      {
        label: parsed.coinbase
          ? 'It is a coinbase: its only input spends no earlier output'
          : 'It is not a coinbase: every input spends an earlier output',
        ok: coinbaseMatch
      }
    ];

    // The fee rate shown divides by the weight. The witness isn't covered
    // by the txid, so this only proves the weight matches the raw bytes.
    if (tx.weight !== undefined) {
      checks.push({ label: 'Weight matches the raw transaction (for the fee rate)', ok: parsed.weight === tx.weight });
    }

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
        outputTotal: ok ? parsed.vout.reduce((sum, o) => sum + o.value, 0) : null,
        // Coinbase or not, from the raw bytes; null unless verified.
        coinbase: ok ? parsed.coinbase : null
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
// `coinbase` is verifyTransactionContents' verdict (true, false or null when
// it couldn't run): a coinbase is only skipped once the raw bytes say so.
export async function verifyTransactionInputs(tx, { outputTotal = null, coinbase = null, force = false } = {}) {
  if (isCoinbaseTx(tx) || tx.vin?.some(v => v.is_coinbase)) {
    if (coinbase === true) {
      return result('na', 'Coinbase: it creates new coins, so there are no spent amounts to check.');
    }
    if (coinbase === null) {
      return result('error', "Couldn't confirm from the raw transaction that this is a coinbase");
    }
    return result('fail', 'Input amounts check FAILED', [
      { label: 'Inputs shown as "coinbase" really are one', ok: false }
    ], { note: 'The raw transaction spends earlier outputs, so it is not a coinbase.' });
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
      checks.push(
        {
          // Bitcoin Core: bad-txns-in-belowout.
          label: 'Inputs cover the outputs (the fee is not negative)',
          ok: computedFee >= 0
        },
        {
          label: `Fee = inputs − outputs = ${formatSats(computedFee)}, as shown`,
          ok: computedFee === tx.fee
        }
      );
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

// =====================================================
// CHAINWORK (total work behind the tip)
// =====================================================

// Number of period headers a full chainwork computation needs.
export function chainWorkHeaderCount(tipHeight) {
  return periodStarts(tipHeight).length;
}

// Adds up the work behind `tip` ({ id, height }) from one proof-of-work-
// checked header per difficulty period. Headers come from the local
// header store when deep enough, so after a first run only new periods
// cost a request. onProgress(done, total) reports header loading.
//
// The total is computed only from the period difficulties that the
// difficulty history (verifyDifficultyHistory) has traced back to the
// genesis block. A header's own proof of work is cheap at a low claimed
// difficulty, so on its own it can't vouch for a period's difficulty: a
// header saved under the wrong height, or made up by a provider, would
// otherwise change the total and still pass. The history result is
// returned as `history` so the caller can show it without a second run.
export async function verifyChainWork(tip, { onProgress = () => {}, onHistoryProgress = () => {} } = {}) {
  try {
    const { pow: tipPow } = await loadVerifiedHeader(tip.id, tip.height);

    if (!tipPow.ok) {
      return result('fail', 'Tip header failed its proof-of-work check', powChecks(tipPow));
    }

    const starts = periodStarts(tip.height);
    let done = 0;

    const load = async (h, useCache) =>
      h === tip.height
        ? { hash: tip.id, pow: tipPow }
        : loadHeaderAtHeight(h, tip.height, useCache);

    const loaded = await mapLimit(starts, INPUT_FETCH_CONCURRENCY, async h => {
      const r = await load(h, true);
      onProgress(++done, starts.length);
      return r;
    });

    // Never report a failure from a cached header without a fresh look.
    for (let i = 0; i < loaded.length; i++) {
      if (!loaded[i].pow.ok) {
        loaded[i] = await load(starts[i], false);
      }
    }

    const bits = {};
    starts.forEach((h, i) => { bits[h] = loaded[i].pow.header.bits; });

    const n = starts.length.toLocaleString('en-US');

    const checks = [
      {
        label: starts.length === 1
          ? 'The header of the only difficulty period so far passes proof-of-work checks'
          : `${n} headers, one per difficulty period, pass proof-of-work checks`,
        ok: loaded.every(l => l.pow.ok)
      },
      {
        label: "The tip's difficulty matches its period's first block",
        ok: tipPow.header.bits === bits[starts[starts.length - 1]]
      },
      {
        label: 'Starts from the genesis block',
        ok: loaded[0].hash === GENESIS_HASH
      }
    ];

    if (!checks.every(c => c.ok)) {
      return result('fail', 'Total work check FAILED', checks);
    }

    // Every period's difficulty, traced back to the genesis block.
    let history = null;

    if (starts.length > 1) {
      history = await verifyDifficultyHistory(tip.height, {
        tipHeight: tip.height,
        onProgress: onHistoryProgress
      });

      if (history.state === 'error') {
        return { ...result('error', "Couldn't add up the total work", checks, {
          note: "The difficulty history it relies on couldn't be checked."
        }), history };
      }

      const traced = history.state === 'ok';

      checks.push({
        label: "Every period's difficulty is traced back to the genesis block",
        ok: traced
      });

      if (!traced) {
        return { ...result('fail', 'Total work check FAILED', checks), history };
      }

      // Use exactly the difficulties the history check verified.
      Object.assign(bits, history.periodBits);

      checks[1].ok = tipPow.header.bits === bits[starts[starts.length - 1]];

      if (!checks[1].ok) {
        return { ...result('fail', 'Total work check FAILED', checks), history };
      }
    }

    const work = chainWork(bits, tip.height);
    const bitsOfWork = log2(work).toFixed(2);
    const years = yearsToRedo(work, tipPow.header.bits);

    return result(
      'ok',
      `Total work behind block ${tip.height.toLocaleString('en-US')}: 2^${bitsOfWork} hashes`,
      checks,
      {
        work,
        history,
        facts: [
          { label: 'Total work', value: `${formatBigPower(work)} hashes (2^${bitsOfWork})` },
          { label: 'To redo it', value: `${formatRedoTime(years)} of all miners' work at today's difficulty` },
          { label: 'chainwork', value: chainWorkHex(work) }
        ],
        note:
          'The same number Bitcoin Core reports as "chainwork": compare it with ' +
          'the output of "bitcoin-cli getblockchaininfo" on your own node. Each ' +
          "period's difficulty is traced back to the genesis block; it assumes each " +
          "period's blocks carry its first header's difficulty, as mainnet's " +
          'rules require, and does not link every header to the next.'
      }
    );
  } catch (err) {
    return errorResult("Couldn't add up the total work", err);
  }
}

// =====================================================
// DIFFICULTY HISTORY (every retarget back to genesis)
// =====================================================

// Headers needed to trace the difficulty of `height` back to genesis:
// every period start, and every period end before it.
export function historyHeaderCount(height) {
  const periods = periodStart(height) / RETARGET_INTERVAL + 1;
  return 2 * periods - 1;
}

const toCheckable = ({ hash, pow }) => ({
  hash,
  bits: pow.header.bits,
  timestamp: pow.header.timestamp,
  previousBlockHash: pow.header.previousBlockHash,
  powOk: pow.ok
});

// Loads the headers for checkDifficultyHistory. With cachedOnly, uses
// only the local header store (no network) and resolves to null if
// anything is missing. Period ends are fetched by the hash the next
// period start points back to, so their link is built in.
async function loadHistoryHeaders(lastStart, tipHeight, { cachedOnly, useCache, onProgress }) {
  const startHeights = periodStarts(lastStart);
  const total = startHeights.length * 2 - 1;
  let done = 0;
  const tick = () => onProgress(++done, total);

  const fromCache = async (height, hash = null) => {
    const c = await get('headers', height).catch(() => null);
    if (!c || (hash && c.hash !== hash)) return null;
    return { hash: c.hash, pow: await verifyHeaderPoW(c.hex, c.hash) };
  };

  const startsLoaded = await mapLimit(startHeights, INPUT_FETCH_CONCURRENCY, async h => {
    const r = cachedOnly
      ? await fromCache(h)
      : await loadHeaderAtHeight(h, tipHeight, useCache);
    tick();
    return r;
  });

  if (startsLoaded.some(r => !r)) return null;

  const endHeights = startHeights.slice(1).map(h => h - 1);

  const endsLoaded = await mapLimit(endHeights, INPUT_FETCH_CONCURRENCY, async (h, i) => {
    const hash = startsLoaded[i + 1].pow.header.previousBlockHash;
    const r = cachedOnly
      ? await fromCache(h, hash)
      : { hash, pow: (await loadVerifiedHeader(hash, h)).pow };
    tick();
    return r;
  });

  if (endsLoaded.some(r => !r)) return null;

  const starts = {};
  const ends = {};
  startHeights.forEach((h, i) => { starts[h] = toCheckable(startsLoaded[i]); });
  endHeights.forEach((h, i) => { ends[h] = toCheckable(endsLoaded[i]); });

  return { starts, ends, count: total };
}

// Traces the difficulty of block `height` back to the genesis block:
// every retarget on the way must follow from the previous period.
// With cachedOnly, resolves to null when headers would have to be
// downloaded (the caller can then offer to fetch them).
export async function verifyDifficultyHistory(height, {
  tipHeight = null,
  cachedOnly = false,
  onProgress = () => {}
} = {}) {
  const lastStart = periodStart(height);

  if (lastStart === 0) {
    return result('na', 'In the first difficulty period: nothing to trace back.');
  }

  try {
    let loaded = await loadHistoryHeaders(lastStart, tipHeight, { cachedOnly, useCache: true, onProgress });

    if (!loaded) {
      return null; // only when cachedOnly and something isn't cached
    }

    let r = checkDifficultyHistory(loaded.starts, loaded.ends, lastStart);

    // A period start cached by height could be from a replaced block;
    // never report a failure without fresh headers.
    if (!r.ok && !cachedOnly) {
      loaded = await loadHistoryHeaders(lastStart, tipHeight, { cachedOnly: false, useCache: false, onProgress });
      r = checkDifficultyHistory(loaded.starts, loaded.ends, lastStart);
    } else if (!r.ok && cachedOnly) {
      return null; // let the caller run a fresh check instead
    }

    const has = test => r.failures.some(f => test(f));
    const n = loaded.count.toLocaleString('en-US');
    const retargets = r.retargets.toLocaleString('en-US');

    const checks = [
      { label: 'Starts from the genesis block and its fixed difficulty (0x1d00ffff)', ok: !has(f => f.height === 0) },
      { label: `All ${retargets} retargets follow from the previous period's timestamps`, ok: !has(f => /retarget/.test(f.problem)) },
      { label: "Every period's last block has its period's difficulty", ok: !has(f => /period's first block/.test(f.problem)) },
      { label: "Every period builds on the previous period's last block", ok: !has(f => /build on/.test(f.problem)) },
      { label: `All ${n} headers pass proof-of-work checks`, ok: !has(f => /proof of work/.test(f.problem)) }
    ];

    const pct = c => `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(1)} %`;
    const at = h => `at block ${h.toLocaleString('en-US')}`;

    const facts = r.ok
      ? [
          { label: 'Retargets checked', value: retargets },
          { label: 'Largest increase', value: `${pct(r.stats.maxUp.change)} ${at(r.stats.maxUp.height)}` },
          { label: 'Largest decrease', value: `${pct(r.stats.maxDown.change)} ${at(r.stats.maxDown.height)}` },
          { label: 'Hit the 4× limit', value: `${r.stats.clamped.toLocaleString('en-US')} times` }
        ]
      : r.failures.slice(0, 3).map(f => ({ label: `Block ${f.height.toLocaleString('en-US')}`, value: f.problem }));

    return result(
      r.ok ? 'ok' : 'fail',
      r.ok
        ? `Difficulty traced back to the genesis block (${retargets} retargets)`
        : 'Difficulty history check FAILED',
      checks,
      {
        facts,
        // For the Charts page: one point per period, from exactly the
        // headers just checked. Never built from a failed check.
        series: r.ok ? historySeries(loaded.starts, loaded.ends, lastStart) : null,
        // For the total-work check: { [periodStart]: bits }, only when every
        // one of them was traced back to the genesis block.
        periodBits: r.ok
          ? Object.fromEntries(Object.entries(loaded.starts).map(([h, x]) => [h, x.bits]))
          : null,
        note: r.ok
          ? "This period's difficulty follows from the genesis block through every " +
            'retarget, using only proof-of-work-checked headers. Blocks inside a ' +
            'period are not linked one by one.'
          : undefined
      }
    );
  } catch (err) {
    return errorResult("Couldn't trace the difficulty history", err);
  }
}

// Do the other providers have this block at this height? A block's own
// proof of work is cheap at a low claimed difficulty, so a provider could
// invent a block for a made-up payment; it can't make independent
// providers report that block. Returns a check, or a `pending` reason when
// fewer than two providers could confirm it.
async function checkBlockAtHeight(height, hash) {
  const answers = await getBlockHashFromEach(height);
  const n = answers.length;
  const h = height.toLocaleString('en-US');

  const differing = answers.filter(a => a.ok && a.hash !== hash);
  const agreeing = answers.filter(a => a.ok && a.hash === hash);

  if (differing.length) {
    return {
      check: {
        label: `${differing.map(a => a.name).join(', ')} ${differing.length === 1 ? 'has' : 'have'} a different block at height ${h}`,
        ok: false
      }
    };
  }

  if (n === 1) {
    return {
      check: { label: `Your only provider has this block at height ${h} (no second provider to compare)`, ok: agreeing.length === 1 },
      single: true
    };
  }

  const check = {
    label: `${agreeing.length} of ${n} providers have this block at height ${h}`,
    ok: agreeing.length >= 2
  };

  return agreeing.length >= 2
    ? { check }
    : { check, pending: `Only ${agreeing.length} of ${n} providers could confirm block ${h} yet` };
}

// That the transaction is in a block whose proof of work checks out, and
// that independent providers have that block at that height.
export async function verifyTransactionInclusion(tx) {
  if (!tx.status?.confirmed) {
    return result('na', 'Not in a block yet, so there is nothing to prove.');
  }

  try {
    const [proof, { pow }] = await Promise.all([
      getMerkleProof(tx.txid),
      loadVerifiedHeader(tx.status.block_hash, tx.status.block_height)
    ]);

    const { root, mutated } = await checkMerkleProof(tx.txid, proof.merkle, proof.pos);

    const checks = [
      { label: 'Merkle proof leads from this txid to the block header', ok: root === pow.header.merkleRoot && !mutated },
      { label: 'Block header has valid proof of work', ok: pow.ok },
      { label: 'Proof is for the block shown', ok: proof.block_height === tx.status.block_height }
    ];

    const facts = [
      { label: 'Position in block', value: `#${(proof.pos + 1).toLocaleString('en-US')}` },
      { label: 'Proof size', value: `${proof.merkle.length} hashes` }
    ];

    if (!allOk(checks)) {
      return result('fail', 'Inclusion check FAILED', checks, { facts });
    }

    const height = tx.status.block_height;
    const atHeight = await checkBlockAtHeight(height, tx.status.block_hash);
    checks.push(atHeight.check);

    const h = height.toLocaleString('en-US');

    if (!atHeight.check.ok && !atHeight.pending) {
      return result('fail', 'Inclusion check FAILED', checks, {
        facts,
        note: 'Providers disagree about this block. It may have just been ' +
          'replaced, or a provider is showing you a block that is not on ' +
          'the chain.'
      });
    }

    if (atHeight.pending) {
      return result('error', `${atHeight.pending}; inclusion not confirmed`, checks, { facts });
    }

    return result('ok', `Inclusion in block ${h} verified`, checks, {
      facts,
      note: atHeight.single
        ? 'With only one provider, its word is all there is for which block is at this height.'
        : undefined
    });
  } catch (err) {
    return errorResult("Couldn't check inclusion", err);
  }
}

// =====================================================
// CHAIN TIP (across providers)
// =====================================================

export async function verifyTip() {
  try {
    // A tip only counts if its header carries valid proof of work. One
    // that fails is marked invalid: a provider sending a fake block is a
    // failure, never just "unreachable".
    const checked = await checkTipHeaders(await getTipFromEach());

    // For providers more than one block behind the leader, ask the leader
    // what it has at their height, to tell "behind on the same chain" from
    // "a different chain". One block behind is read from the leader's own
    // header instead.
    const responding = checked.filter(t => t.ok);
    const leader = responding.reduce((a, b) => (!a || b.height > a.height ? b : a), null);
    const leaderHashes = {};
    const retargetFirst = {};

    for (const t of responding) {
      if (t === leader || t.height >= leader.height) continue;

      if (leader.height - t.height > 1) {
        try {
          leaderHashes[t.height] = await getBlockHashFrom(leader.base, t.height);
        } catch {
          // unknown: compareTips reports "unconfirmed"
        }
      }

      // The leader's tip starts a new period: its difficulty must be the
      // retarget from this provider's own headers.
      const firstHeight = leader.height - RETARGET_INTERVAL;
      if (leader.height === t.height + 1 && leader.height === periodStart(leader.height) &&
          firstHeight >= 0 && !retargetFirst[firstHeight]) {
        try {
          const hash = await getBlockHashFrom(t.base, firstHeight);
          const { pow } = await loadVerifiedHeader(hash);
          if (pow.ok) retargetFirst[firstHeight] = { timestamp: pow.header.timestamp };
        } catch {
          // unknown: compareTips reports "unconfirmed"
        }
      }
    }

    const cmp = compareTips(checked, leaderHashes, retargetFirst);
    const tips = cmp.results;

    // Leave providers that sent an invalid tip out of lookups; let one
    // back in once its tip checks out again.
    recordTipCheck(tips);

    const invalidTitle = cmp.invalid.length === 1
      ? `${cmp.invalid[0]} sent an invalid chain tip`
      : `${cmp.invalid.length} providers sent invalid chain tips`;

    const titles = {
      invalid: invalidTitle,
      agree: `All ${cmp.responded} providers agree on the tip`,
      behind: 'Providers agree; one is catching up',
      unconfirmed: "A provider is ahead, but its newest block can't be checked yet",
      conflict: 'Providers DISAGREE on the chain',
      single: cmp.total === 1
        ? 'Only one provider configured: nothing to compare'
        : 'Only one provider answered: nothing to compare',
      unavailable: "Couldn't reach any provider"
    };

    const state = {
      invalid: 'fail',
      agree: 'ok',
      behind: 'ok',
      unconfirmed: 'na',
      conflict: 'fail',
      single: 'na',
      unavailable: 'error'
    }[cmp.state];

    const short = h => `${h.slice(0, 8)}…${h.slice(-6)}`;

    const checks = tips.map(t => {
      if (t.invalid) {
        return {
          label: `${t.name}: claimed block ${t.height.toLocaleString('en-US')} ` +
            `(${short(t.hash)}), but ${t.error}`,
          ok: false
        };
      }

      if (!t.ok) {
        return { label: `${t.name}: ${t.error}`, ok: false };
      }

      const lag = cmp.lagging.find(l => l.name === t.name);
      const unconfirmed = cmp.unconfirmed.find(l => l.name === t.name);
      const conflicting = cmp.conflicts.includes(t.name);

      return {
        label:
          `${t.name}: block ${t.height.toLocaleString('en-US')} (${short(t.hash)})` +
          (lag ? `, ${lag.by.toLocaleString('en-US')} behind on the same chain` : '') +
          (unconfirmed ? `, ${unconfirmed.by.toLocaleString('en-US')} behind; the newer blocks can't be checked against it yet` : '') +
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
      note: cmp.state === 'invalid'
        ? 'A tip that fails proof of work, or claims a difficulty Bitcoin ' +
          "doesn't allow after the other providers' tips, is not a real block: the provider " +
          'is broken, or is showing you a fake chain. Assay stops asking ' +
          (cmp.invalid.length === 1 ? 'it' : 'them') + ' for lookups until ' +
          'a tip passes this check again (at most 24 hours; you can let one ' +
          'back in sooner on the Providers page). If it is your own node, ' +
          'check that it runs Bitcoin mainnet.'
        : 'Each tip header is checked for proof of work, and a tip ahead of ' +
          "the others must build on their tips with the difficulty Bitcoin " +
          'requires next. Agreement between independent providers makes it ' +
          'much harder for one of them to show you a fake or stale chain.'
    };
  } catch (err) {
    return errorResult("Couldn't compare providers", err);
  }
}
