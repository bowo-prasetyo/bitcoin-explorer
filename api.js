// api.js
// Advanced multi-node Bitcoin API failover system

// Public Bitcoin API nodes
// Only APIs with reasonably compatible REST behavior are included.

const API_NODES = [

  // Blockstream
  {
    name: 'Blockstream',
    base: 'https://blockstream.info/api'
  },

  // Mempool.space
  {
    name: 'Mempool.space',
    base: 'https://mempool.space/api'
  },

  // Blockstream mirror
  {
    name: 'Blockstream Mirror',
    base: 'https://blockstream.jonasschnelli.ch/api'
  },

  // Additional public endpoints
  {
    name: 'Mempool EU',
    base: 'https://mempool.space/api'
  }

];

// Runtime state
const nodeState = new Map();

// Cache key
const STORAGE_KEY = 'btc_explorer_best_node';

// Timeout configuration
const REQUEST_TIMEOUT = 8000;

// Health scoring configuration
const SCORE_SUCCESS = 5;
const SCORE_FAILURE = -15;
const SCORE_TIMEOUT = -20;

// Initialize health state
for (const node of API_NODES) {

  nodeState.set(node.base, {

    score: 100,
    success: 0,
    failure: 0,
    latency: 999999,
    lastSuccess: 0

  });
}

// Load cached preferred node
const cachedNode = localStorage.getItem(STORAGE_KEY);

if (cachedNode) {

  const node = API_NODES.find(
    n => n.base === cachedNode
  );

  if (node) {

    // Give cached node temporary boost
    nodeState.get(node.base).score += 50;
  }
}

// Sort nodes by score
function getRankedNodes() {

  return [...API_NODES].sort((a, b) => {

    return (
      nodeState.get(b.base).score -
      nodeState.get(a.base).score
    );

  });
}

// Save successful node
function cacheBestNode(base) {

  localStorage.setItem(
    STORAGE_KEY,
    base
  );
}

// Update node score
function markSuccess(base, latency) {

  const state = nodeState.get(base);

  state.score += SCORE_SUCCESS;

  state.success++;

  state.latency = latency;

  state.lastSuccess = Date.now();

  cacheBestNode(base);
}

function markFailure(base, timeout = false) {

  const state = nodeState.get(base);

  state.score += timeout
    ? SCORE_TIMEOUT
    : SCORE_FAILURE;

  state.failure++;
}

// Fetch with timeout
async function fetchWithTimeout(url, timeoutMs) {

  const controller = new AbortController();

  const timer = setTimeout(() => {

    controller.abort();

  }, timeoutMs);

  try {

    const response = await fetch(url, {

      signal: controller.signal

    });

    clearTimeout(timer);

    return response;

  } catch (err) {

    clearTimeout(timer);

    throw err;
  }
}

// Core failover fetch
async function apiFetch(path) {

  const rankedNodes = getRankedNodes();

  const errors = [];

  for (const node of rankedNodes) {

    const start = performance.now();

    try {

      console.log(
        'Trying API:',
        node.name
      );

      const response = await fetchWithTimeout(
        node.base + path,
        REQUEST_TIMEOUT
      );

      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const latency =
        performance.now() - start;

      markSuccess(
        node.base,
        latency
      );

      console.log(
        'API success:',
        node.name,
        `${Math.round(latency)}ms`
      );

      return response;

    } catch (err) {

      const isTimeout =
        err.name === 'AbortError';

      markFailure(
        node.base,
        isTimeout
      );

      console.warn(
        'API failed:',
        node.name,
        err.message
      );

      errors.push({
        node: node.name,
        error: err.message
      });
    }
  }

  throw new Error(
    'All API nodes failed: ' +
    JSON.stringify(errors, null, 2)
  );
}

// =====================================================
// API METHODS
// =====================================================

export async function getTipHeight() {

  const r = await apiFetch(
    '/blocks/tip/height'
  );

  return parseInt(await r.text());
}

export async function getBlockHash(height) {

  const r = await apiFetch(
    `/block-height/${height}`
  );

  return await r.text();
}

export async function getBlock(hash) {

  const r = await apiFetch(
    `/block/${hash}`
  );

  return await r.json();
}

export async function getBlockTxs(hash) {

  const r = await apiFetch(
    `/block/${hash}/txs`
  );

  return await r.json();
}

export async function getTx(txid) {

  const r = await apiFetch(
    `/tx/${txid}`
  );

  return await r.json();
}

export async function getAddress(address) {

  const r = await apiFetch(
    `/address/${address}`
  );

  return await r.json();
}

export async function getMempool() {

  const r = await apiFetch(
    '/mempool'
  );

  return await r.json();
}

export async function getRecentBlocks() {

  return apiFetch(
    '/blocks'
  );
}

// =====================================================
// NODE STATUS API
// =====================================================

export function getNodeHealth() {

  return API_NODES.map(node => {

    const state =
      nodeState.get(node.base);

    return {

      name: node.name,
      base: node.base,

      score: state.score,

      success: state.success,

      failure: state.failure,

      latency:
        Math.round(state.latency),

      lastSuccess:
        state.lastSuccess

    };
  });
}

// =====================================================
// OPTIONAL: Background node benchmarking
// =====================================================

export async function benchmarkNodes() {

  console.log(
    'Benchmarking API nodes...'
  );

  await Promise.all(

    API_NODES.map(async node => {

      const start = performance.now();

      try {

        const r = await fetchWithTimeout(
          node.base + '/blocks/tip/height',
          5000
        );

        if (!r.ok) {
          throw new Error(
            `HTTP ${r.status}`
          );
        }

        const latency =
          performance.now() - start;

        markSuccess(
          node.base,
          latency
        );

      } catch (err) {

        markFailure(node.base);
      }
    })
  );
}

// =====================================================
// OPTIONAL: Auto benchmark every 5 minutes
// =====================================================

setInterval(() => {

  benchmarkNodes();

}, 5 * 60 * 1000);
