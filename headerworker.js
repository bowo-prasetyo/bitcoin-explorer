// headerworker.js
// Runs a header-chain sync (headersync.js) off the main thread, so
// checking ~1 million headers never makes the page stutter.
//
// Messages in:  { type: 'sync', base, fetchNew }
//                 base: absolute URL of headers/; fetchNew false only
//                 re-checks what is stored
//               { type: 'stop' }
// Messages out: { type: 'progress', phase, done, total }
//               { type: 'done', result }   (result as syncHeaderFiles,
//                                           or { status: 'busy' } when
//                                           another tab is syncing)

import { initDB } from './db.js';
import { syncHeaderFiles, idbStore, withSyncLock } from './headersync.js';

let controller = null;

self.onmessage = async e => {
  const msg = e.data;

  if (msg.type === 'stop') {
    controller?.abort();
    return;
  }

  if (msg.type !== 'sync' || controller) return;

  controller = new AbortController();

  try {
    await initDB();

    // One sync at a time across tabs: they would write the same records.
    const result = await withSyncLock(() => syncHeaderFiles({
      base: msg.base,
      store: idbStore,
      signal: controller.signal,
      fetchNew: msg.fetchNew !== false,
      onProgress: p => self.postMessage({ type: 'progress', ...p })
    }));

    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'done', result: { status: 'error', message: err?.message || String(err) } });
  } finally {
    controller = null;
  }
};
