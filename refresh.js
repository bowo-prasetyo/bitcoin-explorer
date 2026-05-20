// refresh.js
// Smart hybrid auto-refresh system for Bitcoin Explorer

import { get, put } from './db.js';

// =====================================================
// CONFIGURATION
// =====================================================

const REFRESH_CONFIG = {

  FAST_INTERVAL: 10000,      // 10 sec
  NORMAL_INTERVAL: 30000,    // 30 sec
  SLOW_INTERVAL: 120000,     // 2 min

  USER_ACTIVE_WINDOW: 30000, // 30 sec

  CACHE_TTL: {

    mempool: 10000,
    latestBlock: 15000,
    txPending: 15000,
    txConfirmed: 3600000,
    address: 60000

  }

};

// =====================================================
// USER ACTIVITY TRACKING
// =====================================================

let lastUserActivity = Date.now();

[
  'mousemove',
  'keydown',
  'click',
  'touchstart'
].forEach(event => {

  window.addEventListener(event, () => {

    lastUserActivity = Date.now();

  });

});

function isUserActive() {

  return (
    Date.now() - lastUserActivity <
    REFRESH_CONFIG.USER_ACTIVE_WINDOW
  );
}

// =====================================================
// PAGE VISIBILITY
// =====================================================

function isPageVisible() {

  return (
    document.visibilityState === 'visible'
  );
}

// =====================================================
// ADAPTIVE INTERVAL
// =====================================================

function getAdaptiveInterval() {

  if (!isPageVisible()) {

    return null;
  }

  if (isUserActive()) {

    return REFRESH_CONFIG.FAST_INTERVAL;
  }

  return REFRESH_CONFIG.NORMAL_INTERVAL;
}

// =====================================================
// CACHE HELPERS
// =====================================================

async function loadCached(cacheKey) {

  try {

    const cached =
      await get('cache', cacheKey);

    if (!cached) {
      return null;
    }

    return cached;

  } catch (err) {

    console.warn(
      'Cache load failed',
      err
    );

    return null;
  }
}

async function saveCached(
  cacheKey,
  data
) {

  try {

    await put('cache', {

      id: cacheKey,

      timestamp: Date.now(),

      data

    });

  } catch (err) {

    console.warn(
      'Cache save failed',
      err
    );
  }
}

function isCacheFresh(
  cached,
  ttl
) {

  if (!cached) {
    return false;
  }

  return (
    Date.now() - cached.timestamp <
    ttl
  );
}

// =====================================================
// GENERIC SMART REFRESHER
// =====================================================

export function createSmartRefresher({

  cacheKey,

  cacheTTL,

  fetchFn,

  onUpdate,

  shouldStop = () => false

}) {

  let timer = null;

  let destroyed = false;

  async function refresh() {

    if (destroyed) {
      return;
    }

    // Stop if condition met
    if (shouldStop()) {

      console.log(
        'Auto refresh stopped:',
        cacheKey
      );

      stop();

      return;
    }

    // Page hidden
    if (!isPageVisible()) {

      console.log(
        'Refresh paused (hidden tab)'
      );

      scheduleNext();

      return;
    }

    try {

      // =================================================
      // 1. Load cache instantly
      // =================================================

      const cached =
        await loadCached(cacheKey);

      if (
        cached &&
        isCacheFresh(
          cached,
          cacheTTL
        )
      ) {

        console.log(
          'Using cached data:',
          cacheKey
        );

        onUpdate(
          cached.data,
          true
        );
      }

      // =================================================
      // 2. Fetch fresh data
      // =================================================

      const fresh =
        await fetchFn();

      // =================================================
      // 3. Save cache
      // =================================================

      await saveCached(
        cacheKey,
        fresh
      );

      // =================================================
      // 4. Update UI
      // =================================================

      onUpdate(
        fresh,
        false
      );

      console.log(
        'Fresh data updated:',
        cacheKey
      );

    } catch (err) {

      console.error(
        'Refresh failed:',
        cacheKey,
        err
      );
    }

    scheduleNext();
  }

  function scheduleNext() {

    if (destroyed) {
      return;
    }

    const interval =
      getAdaptiveInterval();

    if (interval === null) {

      // Hidden tab
      timer = setTimeout(
        scheduleNext,
        REFRESH_CONFIG.SLOW_INTERVAL
      );

      return;
    }

    timer = setTimeout(
      refresh,
      interval
    );
  }

  function start() {

    refresh();
  }

  function stop() {

    destroyed = true;

    if (timer) {

      clearTimeout(timer);
    }
  }

  return {

    start,
    stop

  };
}
