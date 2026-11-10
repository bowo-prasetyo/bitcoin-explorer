import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

// Load sw.js as a browser would, with just enough of `self` to define it.
const sandbox = { self: { addEventListener() {}, location: { origin: 'https://example.org' } }, URL };
vm.runInNewContext(read('sw.js'), sandbox);
const { APP_FILES, LIBRARIES, strategyFor } = sandbox;

test('every module, component and icon the app loads is saved for offline use', () => {
  const expected = [
    ...readdirSync(root).filter(f => f.endsWith('.js') && f !== 'sw.js'),
    ...readdirSync(new URL('components/', root)).filter(f => f.endsWith('.js')).map(f => 'components/' + f),
    'index.html', 'styles.css', 'manifest.webmanifest'
  ];
  for (const f of expected) assert.ok(APP_FILES.includes(f), `${f} is missing from APP_FILES in sw.js`);
});

test('everything in the list exists', () => {
  for (const f of APP_FILES) {
    if (f === './') continue;
    assert.ok(existsSync(new URL(f, root)), `sw.js lists ${f}, which doesn't exist`);
  }
});

test('the manifest icons and index.html links are in the list', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(APP_FILES.includes(icon.src), icon.src);

  const html = read('index.html');
  for (const [, href] of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    assert.ok(APP_FILES.includes(href), `index.html links ${href}, not saved for offline use`);
  }
});

test('the libraries match the pinned <script> URLs in index.html', () => {
  const scripts = [...read('index.html').matchAll(/<script[^>]+src="(https:[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...LIBRARIES].sort(), scripts.sort());
});

test('strategyFor: own files, pinned libraries, and nothing else', () => {
  const own = 'https://example.org';
  const s = (u, m = 'GET') => strategyFor(new URL(u), own, m);

  assert.equal(s('https://example.org/bitcoin-explorer/app.js'), 'app');
  assert.equal(s('https://example.org/bitcoin-explorer/'), 'app');
  assert.equal(s(LIBRARIES[0]), 'library');

  // Bitcoin data is never cached by the service worker.
  assert.equal(s('https://blockstream.info/api/blocks/tip/height'), 'pass');
  assert.equal(s('https://mempool.space/api/tx/abc'), 'pass');
  // A different version of a library is not trusted from the cache.
  assert.equal(s('https://unpkg.com/vue@3.5.14/dist/vue.global.prod.js'), 'pass');
  // Only reads.
  assert.equal(s('https://example.org/bitcoin-explorer/app.js', 'POST'), 'pass');
});

test('the manifest makes the app installable', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  assert.match(read('index.html'), /<link rel="manifest" href="manifest.webmanifest">/);
});
