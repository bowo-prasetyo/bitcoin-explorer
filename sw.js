// sw.js
// Service worker: lets Assay open without a network connection.
//
// - The app's own files are fetched from the network first and saved, so
//   an online visit always runs the latest version (there's no build step
//   to stamp versions into file names), and an offline one runs the copy
//   saved last time. A network that hangs falls back after a few seconds.
// - The pinned libraries (exact versions, checked with Subresource
//   Integrity by the page) never change, so they are served from the cache.
// - Bitcoin data requests are never touched: the app keeps its own offline
//   copy of what you viewed, with its age (refresh.js), and a second copy
//   here would only hold your lookups twice. That includes the header
//   files the site itself serves under headers/ (tools/headers).
//
// Written as a plain script with `var` and function declarations so that
// tests/sw.test.mjs can load it in Node and check the file list.

var VERSION = 'v1';
var APP_CACHE = 'assay-app-' + VERSION;
var LIB_CACHE = 'assay-libs-' + VERSION;

// Everything the app needs to start, relative to this file. A test fails
// when a module, component or icon is missing here.
var APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles.css',
  'app.js',
  'router.js',
  'api.js',
  'chainwork.js',
  'chart-theme.js',
  'consensus.js',
  'connection.js',
  'db.js',
  'difficulty.js',
  'distrust.js',
  'format.js',
  'glossary.js',
  'headerchain.js',
  'headersync.js',
  'headerworker.js',
  'history.js',
  'inputs.js',
  'live.js',
  'refresh.js',
  'search.js',
  'sha256.js',
  'spv.js',
  'summary.js',
  'theme.js',
  'titles.js',
  'verify.js',
  'components/AddressView.js',
  'components/BlockView.js',
  'components/ChartsView.js',
  'components/CopyButton.js',
  'components/DataStatus.js',
  'components/GlossaryTerm.js',
  'components/GlossaryView.js',
  'components/HeaderChainCard.js',
  'components/Home.js',
  'components/NotFound.js',
  'components/ProviderNote.js',
  'components/ProvidersView.js',
  'components/SearchBox.js',
  'components/TxView.js',
  'components/VerifyBadge.js',
  'components/VerifySummary.js',
  'brand/assay-logo.svg',
  'brand/assay-logo-on-light.svg',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

// Must match the <script> URLs in index.html exactly (a test checks).
var LIBRARIES = [
  'https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js',
  'https://unpkg.com/vue-router@4.5.0/dist/vue-router.global.prod.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.js'
];

// How long to wait for the network before using the saved copy.
var NETWORK_TIMEOUT = 4000;

// 'app' for this site's own files, 'library' for the pinned libraries,
// 'pass' for everything else (Bitcoin data, links elsewhere).
function strategyFor(url, ownOrigin, method) {
  if (method !== 'GET') return 'pass';
  // Header files (tools/headers): Bitcoin data, up to ~78 MB, kept by
  // the app itself; never copied into the app cache or timed out here.
  if (url.origin === ownOrigin && /\/headers\//.test(url.pathname)) return 'pass';
  if (url.origin === ownOrigin) return 'app';
  if (LIBRARIES.indexOf(url.href) !== -1) return 'library';
  return 'pass';
}

self.addEventListener('install', function (event) {
  event.waitUntil(Promise.all([
    caches.open(APP_CACHE).then(function (cache) {
      return cache.addAll(APP_FILES.map(function (f) { return new Request(f, { cache: 'no-cache' }); }));
    }),
    caches.open(LIB_CACHE).then(function (cache) {
      return cache.addAll(LIBRARIES.map(function (u) { return new Request(u, { mode: 'cors', credentials: 'omit' }); }));
    })
  ]).then(function () {
    // Safe to take over at once: the app's files are network-first, so
    // nothing older than what the network has is ever preferred.
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('assay-') === 0 && key !== APP_CACHE && key !== LIB_CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromNetwork(request) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('timeout')); }, NETWORK_TIMEOUT);
    fetch(request).then(function (response) {
      clearTimeout(timer);
      resolve(response);
    }, function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function appFile(event) {
  var request = event.request;
  // Every page is the same document (routes live after the #).
  var key = request.mode === 'navigate' ? './' : request;

  return fromNetwork(request).then(function (response) {
    if (response.ok) {
      var copy = response.clone();
      event.waitUntil(caches.open(APP_CACHE).then(function (cache) { return cache.put(key, copy); }));
    }
    return response;
  }).catch(function () {
    return caches.open(APP_CACHE).then(function (cache) {
      return cache.match(key, { ignoreSearch: true });
    }).then(function (saved) {
      return saved || Response.error();
    });
  });
}

function library(request) {
  return caches.open(LIB_CACHE).then(function (cache) {
    return cache.match(request).then(function (saved) {
      return saved || fetch(request).then(function (response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  var strategy = strategyFor(url, self.location.origin, event.request.method);

  if (strategy === 'app') event.respondWith(appFile(event));
  else if (strategy === 'library') event.respondWith(library(event.request));
  // 'pass': the browser handles it as if there were no service worker.
});
