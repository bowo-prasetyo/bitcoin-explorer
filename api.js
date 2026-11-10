// api.js
// Multi-provider Bitcoin API client with failover and health scoring.
//
// Every provider here speaks the Esplora REST API. Default providers are
// listed only when their operator is known: a verifying explorer should be
// able to say exactly whom it asked. Users can add their own endpoint
// (a self-hosted Esplora, or one reached over Tor), and optionally use it
// exclusively so no lookup leaves their own infrastructure.

import {
  parseDistrust,
  isDistrusted,
  lookupNodes,
  applyTipCheck
} from './distrust.js';

const DEFAULT_PROVIDERS = [
  {
    name: 'Blockstream',
    base: 'https://blockstream.info/api'
  },
  {
    name: 'mempool.space',
    base: 'https://mempool.space/api'
  }
];

// =====================================================
// ERRORS
// =====================================================

// kind:
//   'not_found'   - a provider answered definitively that the
//                   requested object does not exist (or the query
//                   is malformed). Retrying elsewhere won't help.
//   'unavailable' - no provider could be reached or answered.
//   'distrusted'  - every provider is left out of lookups for having
//                   sent an invalid chain tip (distrust.js).
//   'offline'     - the device has no network connection, so nothing was
//                   sent (and no provider is marked as failing).
export class ApiError extends Error {

  constructor(kind, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.details = details;
  }
}

// =====================================================
// SETTINGS (custom provider)
// =====================================================

// Storage keys predate the name Assay; renaming them would silently drop
// visitors' saved settings (e.g. their own endpoint).
const BEST_NODE_KEY = 'btc_explorer_best_node';
const CUSTOM_KEY = 'btc_explorer_custom_provider';
const DISTRUST_KEY = 'btc_explorer_distrusted';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode, blocked storage
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
}

// Normalises and validates an Esplora base URL, e.g.
// "https://my.node/api/" -> "https://my.node/api".
// Throws with a user-facing message.
export function normalizeEndpoint(input) {
  let url;

  try {
    url = new URL((input || '').trim());
  } catch {
    throw new Error('Enter a full URL, e.g. https://my-node.example/api');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The endpoint must start with https:// or http://');
  }

  if (url.username || url.password) {
    throw new Error("Don't put credentials in the URL.");
  }

  if (url.search || url.hash) {
    throw new Error('Remove the ?query or #fragment from the URL.');
  }

  return (url.origin + url.pathname).replace(/\/+$/, '');
}

function loadCustom() {
  try {
    const parsed = JSON.parse(readStorage(CUSTOM_KEY) || 'null');

    if (parsed?.base) {
      return {
        base: normalizeEndpoint(parsed.base),
        exclusive: !!parsed.exclusive
      };
    }
  } catch {
    // corrupted or invalid setting: ignore it
  }
  return null;
}

let custom = loadCustom();

// The providers requests may go to, in no particular order.
function activeProviders() {
  if (!custom) {
    return DEFAULT_PROVIDERS;
  }

  const mine = { name: 'Your endpoint', base: custom.base, custom: true };

  return custom.exclusive
    ? [mine]
    : [mine, ...DEFAULT_PROVIDERS.filter(p => p.base !== custom.base)];
}

export function getProviderSettings() {
  return {
    custom: custom ? { ...custom } : null,
    defaults: DEFAULT_PROVIDERS.map(p => ({ ...p }))
  };
}

export function setCustomProvider({ base, exclusive }) {
  custom = { base: normalizeEndpoint(base), exclusive: !!exclusive };
  writeStorage(CUSTOM_KEY, JSON.stringify(custom));
  ensureState(custom.base);
}

export function clearCustomProvider() {
  custom = null;
  writeStorage(CUSTOM_KEY, null);
}

// =====================================================
// RUNTIME STATE
// =====================================================

const nodeState = new Map();

const REQUEST_TIMEOUT = 8000;

const BENCHMARK_INTERVAL = 5 * 60 * 1000;

const SCORE_SUCCESS = 5;
const SCORE_FAILURE = -15;
const SCORE_TIMEOUT = -20;

// The user's own endpoint is tried first while it stays healthy.
const CUSTOM_PRIORITY = 1000;

function ensureState(base) {
  if (!nodeState.has(base)) {
    nodeState.set(base, {
      score: 100,
      success: 0,
      failure: 0,
      latency: null,
      lastSuccess: 0,
      lastError: null
    });
  }
  return nodeState.get(base);
}

for (const node of activeProviders()) {
  ensureState(node.base);
}

// Give the provider that worked last session a head start.
{
  const best = readStorage(BEST_NODE_KEY);

  if (best && nodeState.has(best)) {
    nodeState.get(best).score += 50;
  }
}

function rankScore(node) {
  return ensureState(node.base).score + (node.custom ? CUSTOM_PRIORITY : 0);
}

function getRankedNodes() {
  return [...activeProviders()].sort((a, b) => rankScore(b) - rankScore(a));
}

function markSuccess(base, latency) {
  const state = ensureState(base);

  state.score += SCORE_SUCCESS;
  state.success++;
  state.latency = latency;
  state.lastSuccess = Date.now();
  state.lastError = null;
}

function markFailure(base, timeout = false, message = '') {
  const state = ensureState(base);

  state.score += timeout ? SCORE_TIMEOUT : SCORE_FAILURE;
  state.failure++;
  state.lastError = timeout ? 'timeout' : message;
}

// =====================================================
// DISTRUSTED PROVIDERS
// =====================================================

// Stored, so a provider caught faking stays out of lookups after a reload,
// before any page has re-checked the tip.
let distrust = parseDistrust(readStorage(DISTRUST_KEY));

function saveDistrust(next) {
  distrust = next;
  writeStorage(DISTRUST_KEY, Object.keys(next).length ? JSON.stringify(next) : null);
}

// Called with every chain-tip check (verify.js verifyTip): providers whose
// tip was invalid are left out of lookups; a valid tip lets one back in.
export function recordTipCheck(tips) {
  const next = applyTipCheck(distrust, tips);
  if (next !== distrust) saveDistrust(next);
}

// The user's override on the Providers page.
export function trustProviderAgain(base) {
  if (!distrust[base]) return;
  const next = { ...distrust };
  delete next[base];
  saveDistrust(next);
}

// No connection at all: say so, without trying (and failing) every
// provider, which would wreck their health scores for when it comes back.
// navigator.onLine is only trusted when it says "offline".
function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('offline', "You're offline.");
  }
}

// Requests made to providers this session, for the Providers page.
const networkStats = { requests: 0, since: Date.now() };

export function getNetworkStats() {
  return { ...networkStats };
}

async function fetchWithTimeout(url, timeoutMs) {
  networkStats.requests++;

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A 4xx answer (other than rate limiting) is the provider telling us the
// request itself is wrong: the object doesn't exist or the id is invalid.
// That is an answer, not a provider failure.
function isDefinitiveAnswer(status) {
  return status >= 400 && status < 500 && status !== 429;
}

// =====================================================
// CORE FAILOVER FETCH
// =====================================================

async function apiFetch(path) {

  assertOnline();

  const errors = [];
  const nodes = lookupNodes(getRankedNodes(), distrust);

  if (!nodes.length) {
    throw new ApiError(
      'distrusted',
      'Every data provider sent an invalid chain tip, so Assay is not ' +
      'asking them for anything until one passes the check again.'
    );
  }

  for (const node of nodes) {

    const start = performance.now();

    let response;

    try {
      response = await fetchWithTimeout(
        node.base + path,
        REQUEST_TIMEOUT
      );
    } catch (err) {
      const isTimeout = err.name === 'AbortError';

      markFailure(node.base, isTimeout, err.message);

      errors.push({
        node: node.name,
        error: isTimeout ? 'timeout' : err.message
      });

      continue;
    }

    const latency = performance.now() - start;

    if (response.ok) {
      markSuccess(node.base, latency);
      writeStorage(BEST_NODE_KEY, node.base);
      return response;
    }

    if (isDefinitiveAnswer(response.status)) {
      // The provider is healthy; the query is not.
      markSuccess(node.base, latency);

      const body = (await response.text().catch(() => '')).trim();

      throw new ApiError(
        'not_found',
        body || `Not found (HTTP ${response.status})`,
        [{ node: node.name, error: `HTTP ${response.status}` }]
      );
    }

    markFailure(node.base, false, `HTTP ${response.status}`);

    errors.push({
      node: node.name,
      error: `HTTP ${response.status}`
    });
  }

  console.warn('All API providers failed', errors);

  throw new ApiError(
    'unavailable',
    'No Bitcoin data provider could be reached.',
    errors
  );
}

// =====================================================
// API METHODS
// =====================================================

export async function getTipHeight() {
  const r = await apiFetch('/blocks/tip/height');
  return parseInt(await r.text(), 10);
}

export async function getBlockHash(height) {
  const r = await apiFetch(`/block-height/${height}`);
  return (await r.text()).trim();
}

export async function getBlock(hash) {
  const r = await apiFetch(`/block/${hash}`);
  return await r.json();
}

// Raw 80-byte header as hex.
export async function getBlockHeader(hash) {
  const r = await apiFetch(`/block/${hash}/header`);
  return (await r.text()).trim().toLowerCase();
}

// Every txid in the block, in block order.
export async function getBlockTxids(hash) {
  const r = await apiFetch(`/block/${hash}/txids`);
  return await r.json();
}

// The txid at `index` in the block (0 is the coinbase).
export async function getBlockTxidAt(hash, index) {
  const r = await apiFetch(`/block/${hash}/txid/${index}`);
  return (await r.text()).trim().toLowerCase();
}

// Esplora returns block transactions 25 at a time; startIndex must be a
// multiple of 25.
export const BLOCK_TXS_PAGE_SIZE = 25;

export async function getBlockTxs(hash, startIndex = 0) {
  const r = await apiFetch(`/block/${hash}/txs/${startIndex}`);
  return await r.json();
}

export async function getTx(txid) {
  const r = await apiFetch(`/tx/${txid}`);
  return await r.json();
}

// Raw transaction as hex.
export async function getTxHex(txid) {
  const r = await apiFetch(`/tx/${txid}/hex`);
  return (await r.text()).trim().toLowerCase();
}

// { block_height, merkle: [sibling hashes], pos }
export async function getMerkleProof(txid) {
  const r = await apiFetch(`/tx/${txid}/merkle-proof`);
  return await r.json();
}

export async function getAddress(address) {
  const r = await apiFetch(`/address/${address}`);
  return await r.json();
}

// Up to 50 unconfirmed transactions plus the newest 25 confirmed ones.
export async function getAddressTxs(address) {
  const r = await apiFetch(`/address/${address}/txs`);
  return await r.json();
}

// The next 25 confirmed transactions after lastSeenTxid.
export async function getAddressTxsChain(address, lastSeenTxid) {
  const r = await apiFetch(`/address/${address}/txs/chain/${lastSeenTxid}`);
  return await r.json();
}

export async function getMempool() {
  const r = await apiFetch('/mempool');
  return await r.json();
}

// The whole block, raw (hex). Up to ~4 MB.
export async function getBlockRaw(hash) {
  const r = await apiFetch(`/block/${hash}/raw`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// Blocks at `height` and just below it, newest first (Esplora returns 10;
// some servers more). With `base`, asks that provider only.
export async function getBlocksFrom(height, base = null) {
  if (base) {
    return JSON.parse(await fetchTextFrom(base, `/blocks/${height}`));
  }
  const r = await apiFetch(`/blocks/${height}`);
  return await r.json();
}

export async function getRecentBlocks() {
  const r = await apiFetch('/blocks');
  return await r.json();
}

export async function getFeeEstimates() {
  const r = await apiFetch('/fee-estimates');
  return await r.json();
}

// Returns the block, or null if no such block exists.
// Provider outages are still thrown so callers can tell them apart.
export async function tryGetBlock(hash) {
  try {
    return await getBlock(hash);
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'not_found') {
      return null;
    }
    throw err;
  }
}

// =====================================================
// ASKING EACH PROVIDER SEPARATELY (no failover)
// =====================================================

async function fetchTextFrom(base, path, timeoutMs = REQUEST_TIMEOUT) {
  assertOnline();

  const start = performance.now();

  let r;
  try {
    r = await fetchWithTimeout(base + path, timeoutMs);
  } catch (err) {
    const timeout = err.name === 'AbortError';
    markFailure(base, timeout, err.message);
    throw new Error(timeout ? 'timed out' : 'unreachable (network or CORS error)');
  }

  if (!r.ok) {
    markFailure(base, false, `HTTP ${r.status}`);
    throw new Error(`HTTP ${r.status}`);
  }

  markSuccess(base, performance.now() - start);
  return (await r.text()).trim();
}

// Asks every active provider for its chain tip, independently.
// Resolves to [{ name, base, ok, height, hash } | { name, base, ok: false, error }].
export async function getTipFromEach() {
  return Promise.all(
    activeProviders().map(async p => {
      try {
        const hash = (await fetchTextFrom(p.base, '/blocks/tip/hash')).toLowerCase();
        // Header and height of that exact block, so they can't straddle a
        // new block arriving between requests.
        const [headerText, statusText] = await Promise.all([
          fetchTextFrom(p.base, `/block/${hash}/header`),
          fetchTextFrom(p.base, `/block/${hash}/status`)
        ]);
        const header = headerText.toLowerCase();
        const height = JSON.parse(statusText).height;

        if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isInteger(height)) {
          throw new Error('unexpected response');
        }

        return { name: p.name, base: p.base, ok: true, height, hash, header };
      } catch (err) {
        return { name: p.name, base: p.base, ok: false, error: err.message };
      }
    })
  );
}

// Hash at `height` according to one specific provider.
export async function getBlockHashFrom(base, height) {
  return (await fetchTextFrom(base, `/block-height/${height}`)).toLowerCase();
}

// Hash at `height` according to every provider that lookups may use,
// asked separately (no failover).
// Resolves to [{ name, ok: true, hash } | { name, ok: false, error }].
export async function getBlockHashFromEach(height) {
  return Promise.all(
    lookupNodes(getRankedNodes(), distrust).map(async p => {
      try {
        const hash = await getBlockHashFrom(p.base, height);
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('unexpected response');
        return { name: p.name, ok: true, hash };
      } catch (err) {
        return { name: p.name, ok: false, error: err.message };
      }
    })
  );
}

// Checks that an endpoint looks like a working Esplora API.
export async function testEndpoint(input) {
  const base = normalizeEndpoint(input);
  const start = performance.now();

  try {
    const r = await fetchWithTimeout(base + '/blocks/tip/height', REQUEST_TIMEOUT);

    if (!r.ok) {
      return { ok: false, base, error: `It answered HTTP ${r.status}. Is this the Esplora API path (often ending in /api)?` };
    }

    const height = parseInt((await r.text()).trim(), 10);

    if (!Number.isFinite(height)) {
      return { ok: false, base, error: "It answered, but not with a block height. Is this an Esplora API?" };
    }

    return { ok: true, base, height, latency: Math.round(performance.now() - start) };

  } catch (err) {
    return {
      ok: false,
      base,
      error: err.name === 'AbortError'
        ? 'No answer within 8 seconds.'
        : "Couldn't connect. Check the URL, that the server sends CORS headers " +
          '(Access-Control-Allow-Origin), and that an https page may load it ' +
          '(browsers block plain http except localhost and .onion in Tor Browser).'
    };
  }
}

// =====================================================
// PROVIDER HEALTH
// =====================================================

export function getNodeHealth() {
  const ranked = getRankedNodes();
  const preferred = lookupNodes(ranked, distrust)[0]?.base;

  return ranked.map(node => {
    const state = ensureState(node.base);

    return {
      name: node.name,
      base: node.base,
      custom: !!node.custom,
      preferred: node.base === preferred,
      // { reason, since } while left out of lookups, else null.
      distrusted: isDistrusted(distrust, node.base) ? { ...distrust[node.base] } : null,
      score: state.score,
      success: state.success,
      failure: state.failure,
      latency: state.latency === null ? null : Math.round(state.latency),
      lastSuccess: state.lastSuccess,
      lastError: state.lastError
    };
  });
}

// =====================================================
// BACKGROUND BENCHMARKING
// =====================================================

export async function benchmarkNodes() {
  await Promise.all(
    activeProviders().map(node =>
      fetchTextFrom(node.base, '/blocks/tip/height', 5000).catch(() => {})
    )
  );
}

// Re-rank providers periodically, but only while someone is looking.
setInterval(() => {
  if (document.visibilityState === 'visible') {
    benchmarkNodes();
  }
}, BENCHMARK_INTERVAL);
