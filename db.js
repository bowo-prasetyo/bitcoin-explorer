const DB_NAME = 'btc-explorer';
const DB_VERSION = 2;

let db;

export async function initDB() {
  return new Promise((resolve, reject) => {
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = e => {
      db = e.target.result;

      if (!db.objectStoreNames.contains('blocks')) {
        db.createObjectStore('blocks', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('txs')) {
        db.createObjectStore('txs', { keyPath: 'txid' });
      }

      if (!db.objectStoreNames.contains('headers')) {
        db.createObjectStore('headers', { keyPath: 'height' });
      }

      if (!db.objectStoreNames.contains('cache')) {
      
        db.createObjectStore(
          'cache',
          { keyPath: 'id' }
        );
      }
      
    };

    request.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = reject;
  });
}

export async function put(store, value) {

  return new Promise((resolve, reject) => {

    const tx =
      db.transaction(
        store,
        'readwrite'
      );

    const objectStore =
      tx.objectStore(store);

    // Remove Vue proxies / reactive wrappers
    const safeValue =
      structuredClone(value);

    const request =
      objectStore.put(safeValue);

    request.onsuccess =
      () => resolve();

    request.onerror =
      err => reject(err);
  });
}

export async function get(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);

    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}
