// db.js
// IndexedDB wrapper.
//
// Stores:
//   cache   - everything the refreshers show: { id, timestamp, data }.
//             Pruned by age and size at startup (pruneCache).
//   headers - reserved for block headers used by in-browser verification
//             (VISION.md, phase 3).

// Named before the project became Assay; renaming it would discard every
// visitor's cache.
const DB_NAME = 'btc-explorer';
const DB_VERSION = 3;

export const CACHE_LIMITS = {
  maxAgeMs: 7 * 24 * 3600 * 1000, // a week
  maxEntries: 500
};

let db;

export async function initDB() {
  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = e => {
      db = e.target.result;
      const tx = e.target.transaction;

      // v1-v2 wrote every viewed block and transaction here but never read
      // them back; the cache store already holds what views need.
      for (const legacy of ['blocks', 'txs']) {
        if (db.objectStoreNames.contains(legacy)) {
          db.deleteObjectStore(legacy);
        }
      }

      if (!db.objectStoreNames.contains('headers')) {
        db.createObjectStore('headers', { keyPath: 'height' });
      }

      const cache = db.objectStoreNames.contains('cache')
        ? tx.objectStore('cache')
        : db.createObjectStore('cache', { keyPath: 'id' });

      if (!cache.indexNames.contains('timestamp')) {
        cache.createIndex('timestamp', 'timestamp');
      }
    };

    request.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, 'readwrite')
      .objectStore(storeName)
      .put(value);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, 'readonly')
      .objectStore(storeName)
      .get(key);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Deletes cache entries older than maxAgeMs, then the oldest entries
// beyond maxEntries. Resolves to the number of entries deleted.
export async function pruneCache({
  maxAgeMs = CACHE_LIMITS.maxAgeMs,
  maxEntries = CACHE_LIMITS.maxEntries,
  now = Date.now()
} = {}) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    const store = tx.objectStore('cache');

    let deleted = 0;

    const countReq = store.count();

    countReq.onsuccess = () => {
      let remaining = countReq.result;
      const cutoff = now - maxAgeMs;

      // Oldest first.
      const cursorReq = store.index('timestamp').openCursor();

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;

        if (!cursor) {
          return;
        }

        const expired = !(cursor.value.timestamp >= cutoff);

        if (!expired && remaining <= maxEntries) {
          return; // everything after this is newer and within limits
        }

        cursor.delete();
        deleted++;
        remaining--;
        cursor.continue();
      };
    };

    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
  });
}
