// api.js
// Multi-provider Bitcoin API client with failover and health scoring.
//
// Every provider here speaks the Esplora REST API. Providers are listed
// only when their operator is known: a verifying explorer should be able
// to say exactly whom it asked.

const API_NODES = [
  {
    name: 'Blockstream',
    base: 'https://blockstream.info/api'
  },
  {
    name: 'Mempool.space',
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
export class ApiError extends Error {

  constructor(kind, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.details = details;
  }
}

// =====================================================
// RUNTIME STATE
// =====================================================

const nodeState = new Map();

const STORAGE_KEY = 'btc_explorer_best_node';

const REQUEST_TIMEOUT = 8000;

const BENCHMARK_INTERVAL = 5 * 60 * 1000;

const SCORE_SUCCESS = 5;
const SCORE_FAILURE = -15;
const SCORE_TIMEOUT = -20;

for (const node of API_NODES) {
  nodeState.set(node.base, {
    score: 100,
    success: 0,
    failure: 0,
    latency: null,
    lastSuccess: 0
  });
}

// Give the provider that worked last session a head start.
try {
  const cachedNode = localStorage.getItem(STORAGE_KEY);

  if (cachedNode && nodeState.has(cachedNode)) {
    nodeState.get(cachedNode).score += 50;
  }
} catch {
  // localStorage unavailable (private mode, blocked storage)
}

function getRankedNodes() {
  return [...API_NODES].sort(
    (a, b) =>
      nodeState.get(b.base).score -
      nodeState.get(a.base).score
  );
}

function cacheBestNode(base) {
  try {
    localStorage.setItem(STORAGE_KEY, base);
  } catch {
    // ignore
  }
}

function markSuccess(base, latency) {
  const state = nodeState.get(base);

  state.score += SCORE_SUCCESS;
  state.success++;
  state.latency = latency;
  state.lastSuccess = Date.now();
}

function markFailure(base, timeout = false) {
  const state = nodeState.get(base);

  state.score += timeout ? SCORE_TIMEOUT : SCORE_FAILURE;
  state.failure++;
}

async function fetchWithTimeout(url, timeoutMs) {
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

  const errors = [];

  for (const node of getRankedNodes()) {

    const start = performance.now();

    let response;

    try {
      response = await fetchWithTimeout(
        node.base + path,
        REQUEST_TIMEOUT
      );
    } catch (err) {
      const isTimeout = err.name === 'AbortError';

      markFailure(node.base, isTimeout);

      errors.push({
        node: node.name,
        error: isTimeout ? 'timeout' : err.message
      });

      continue;
    }

    const latency = performance.now() - start;

    if (response.ok) {
      markSuccess(node.base, latency);
      cacheBestNode(node.base);
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

    markFailure(node.base);

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
  return await r.text();
}

export async function getBlock(hash) {
  const r = await apiFetch(`/block/${hash}`);
  return await r.json();
}

export async function getBlockTxs(hash) {
  const r = await apiFetch(`/block/${hash}/txs`);
  return await r.json();
}

export async function getTx(txid) {
  const r = await apiFetch(`/tx/${txid}`);
  return await r.json();
}

export async function getAddress(address) {
  const r = await apiFetch(`/address/${address}`);
  return await r.json();
}

export async function getMempool() {
  const r = await apiFetch('/mempool');
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
// PROVIDER HEALTH
// =====================================================

export function getNodeHealth() {
  return API_NODES.map(node => {
    const state = nodeState.get(node.base);

    return {
      name: node.name,
      base: node.base,
      score: state.score,
      success: state.success,
      failure: state.failure,
      latency:
        state.latency === null
          ? null
          : Math.round(state.latency),
      lastSuccess: state.lastSuccess
    };
  });
}

// =====================================================
// BACKGROUND BENCHMARKING
// =====================================================

export async function benchmarkNodes() {
  await Promise.all(
    API_NODES.map(async node => {
      const start = performance.now();

      try {
        const r = await fetchWithTimeout(
          node.base + '/blocks/tip/height',
          5000
        );

        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }

        markSuccess(node.base, performance.now() - start);
      } catch (err) {
        markFailure(node.base, err.name === 'AbortError');
      }
    })
  );
}

// Re-rank providers periodically, but only while someone is looking.
setInterval(() => {
  if (document.visibilityState === 'visible') {
    benchmarkNodes();
  }
}, BENCHMARK_INTERVAL);
