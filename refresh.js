// refresh.js
// Cache-first auto-refresh for Assay.
//
// Each refresher:
//   1. shows whatever is cached in IndexedDB immediately, however old,
//      so the page is never blank when the network is down;
//   2. skips the network while the cache is younger than its TTL;
//   3. otherwise fetches, caches and shows fresh data;
//   4. reports loading / error / last-updated state through a reactive
//      `status` object so views can say how current their data is;
//   5. polls faster while the user is active, pauses in hidden tabs and
//      refreshes as soon as the tab becomes visible again.

import { get, put } from './db.js';
import { liveFeed } from './live.js';

// =====================================================
// CONFIGURATION
// =====================================================

const REFRESH_CONFIG = {
  FAST_INTERVAL: 10000,      // user active
  NORMAL_INTERVAL: 30000,    // user idle
  HIDDEN_RECHECK: 120000,    // hidden tab: only re-check visibility
  LIVE_SAFETY: 300000,       // live updates on: slow safety-net poll
  USER_ACTIVE_WINDOW: 30000
};

// How long cached data counts as fresh (ms). Fresh cache is used without
// a network request.
export const CACHE_TTL = {
  mempool: 10000,
  latestBlock: 15000,
  recentBlocks: 15000,
  feeEstimates: 30000,
  block: 30000,
  blockDeep: 600000,         // >= 6 confirmations: only the count changes
  blockTxs: 86400000,        // a block's transactions never change
  txPending: 15000,
  txConfirmed: 3600000,
  address: 30000
};

// =====================================================
// USER ACTIVITY & VISIBILITY
// =====================================================

let lastUserActivity = Date.now();

['mousemove', 'keydown', 'click', 'touchstart'].forEach(event => {
  window.addEventListener(
    event,
    () => { lastUserActivity = Date.now(); },
    { passive: true }
  );
});

function isUserActive() {
  return (
    Date.now() - lastUserActivity <
    REFRESH_CONFIG.USER_ACTIVE_WINDOW
  );
}

function isPageVisible() {
  return document.visibilityState === 'visible';
}

function getAdaptiveInterval() {
  if (!isPageVisible()) {
    return null;
  }

  return isUserActive()
    ? REFRESH_CONFIG.FAST_INTERVAL
    : REFRESH_CONFIG.NORMAL_INTERVAL;
}

// =====================================================
// STATUS
// =====================================================

// Create in a component's data() so it is reactive, then pass it to
// createSmartRefresher and to <data-status>.
export function createStatus() {
  return {
    loading: true,     // nothing to show yet
    refreshing: false, // a network request is in flight
    error: null,       // last error, cleared on success
    updatedAt: null,   // when the shown data was fetched (ms)
    cached: false      // shown data came from the local cache
  };
}

// =====================================================
// CACHE HELPERS
// =====================================================

async function loadCached(cacheKey) {
  try {
    return (await get('cache', cacheKey)) || null;
  } catch (err) {
    console.warn('Cache load failed', cacheKey, err);
    return null;
  }
}

async function saveCached(cacheKey, data, timestamp) {
  try {
    await put('cache', { id: cacheKey, timestamp, data });
  } catch (err) {
    console.warn('Cache save failed', cacheKey, err);
  }
}

// =====================================================
// SMART REFRESHER
// =====================================================

export function createSmartRefresher({
  cacheKey,

  // number, or (cachedData) => number
  cacheTTL,

  fetchFn,

  // (data, { cached: boolean, timestamp: ms }) => void
  onUpdate,

  // optional reactive object from createStatus()
  status = createStatus(),

  shouldStop = () => false,

  // false: load once (cache-first, network if stale) and never poll.
  // For data that doesn't change, such as a page of block transactions.
  poll = true,

  // How live "new block" notifications (live.js) affect this refresher:
  //   'replace' - the data only changes with a new block: while live,
  //               poll only as a slow safety net and refresh on each block
  //   'refresh' - keep polling as usual, and also refresh on each block
  //   null      - ignore them
  live = null
}) {

  let timer = null;
  let destroyed = false;
  let inFlight = false;
  let shownTimestamp = 0;

  function ttlFor(data) {
    return typeof cacheTTL === 'function'
      ? cacheTTL(data)
      : cacheTTL;
  }

  function show(data, cached, timestamp) {
    shownTimestamp = timestamp;

    status.loading = false;
    status.cached = cached;
    status.updatedAt = timestamp;

    onUpdate(data, { cached, timestamp });
  }

  let again = false;
  let unsubscribeBlock = null;
  let unsubscribeStatus = null;

  async function refresh(force = false) {
    if (inFlight && force) {
      again = true; // a block arrived mid-request: go again afterwards
      return;
    }

    if (destroyed || inFlight) {
      return;
    }

    if (shouldStop()) {
      stop();
      return;
    }

    if (poll && !isPageVisible()) {
      scheduleNext();
      return;
    }

    inFlight = true;

    try {
      // 1. Cache first: show it if it is newer than what's on screen.
      const cached = await loadCached(cacheKey);

      if (destroyed) {
        return;
      }

      if (cached && cached.timestamp > shownTimestamp) {
        show(cached.data, true, cached.timestamp);
      }

      // 2. Fresh enough? Skip the network.
      if (
        cached &&
        !force &&
        Date.now() - cached.timestamp < ttlFor(cached.data)
      ) {
        return;
      }

      // 3. Fetch, cache, show.
      status.refreshing = true;

      const fresh = await fetchFn();
      const timestamp = Date.now();

      if (destroyed) {
        return;
      }

      await saveCached(cacheKey, fresh, timestamp);

      status.error = null;
      show(fresh, false, timestamp);

    } catch (err) {

      console.error('Refresh failed:', cacheKey, err);

      if (destroyed) {
        return;
      }

      status.error = err;
      status.loading = false;

      // The provider said this object doesn't exist; polling won't
      // change that.
      if (err?.kind === 'not_found') {
        stop();
      }

    } finally {
      inFlight = false;
      status.refreshing = false;

      if (again && !destroyed) {
        again = false;
        refresh(true);
      } else if (poll) {
        scheduleNext();
      }
    }
  }

  function scheduleNext() {
    if (destroyed) {
      return;
    }

    clearTimeout(timer);

    let interval = getAdaptiveInterval();

    if (interval !== null && live === 'replace' && liveFeed.isLive()) {
      interval = REFRESH_CONFIG.LIVE_SAFETY;
    }

    timer = interval === null
      ? setTimeout(scheduleNext, REFRESH_CONFIG.HIDDEN_RECHECK)
      : setTimeout(refresh, interval);
  }

  function onVisibilityChange() {
    if (isPageVisible() && !destroyed) {
      clearTimeout(timer);
      refresh();
    }
  }

  // Back online: refresh now rather than at the next poll.
  function onOnline() {
    if (!destroyed) {
      clearTimeout(timer);
      refresh();
    }
  }

  function start() {
    if (poll) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    window.addEventListener('online', onOnline);

    refresh();

    if (live) {
      unsubscribeBlock = liveFeed.onBlock(() => {
        if (!destroyed) {
          clearTimeout(timer);
          refresh(true);
        }
      });
    }

    if (live === 'replace') {
      // Socket up: stretch the interval. Socket down: back to polling now.
      unsubscribeStatus = liveFeed.onStatus(() => {
        if (!destroyed && !inFlight) scheduleNext();
      });
    }
  }

  function stop() {
    destroyed = true;
    clearTimeout(timer);
    unsubscribeBlock?.();
    unsubscribeStatus?.();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
  }

  return { start, stop, refresh, status };
}
