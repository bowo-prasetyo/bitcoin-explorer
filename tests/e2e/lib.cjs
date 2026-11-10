// Shared helpers for the browser tests (see tests/e2e/README.md).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// The pinned libraries index.html loads, served from node_modules (same
// versions, pinned in package.json) so tests run offline and the page's
// Subresource Integrity hashes are checked against them.
const LIBS = {
  'https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js': 'vue/dist/vue.global.prod.js',
  'https://unpkg.com/vue-router@4.5.0/dist/vue-router.global.prod.js': 'vue-router/dist/vue-router.global.prod.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.js': 'chart.js/dist/chart.umd.js'
};

function libBody(url) {
  const file = LIBS[url];
  return file ? fs.readFileSync(path.join(ROOT, 'node_modules', file)) : null;
}

// Suites call this from their own context setup.
async function routeLibs(context) {
  await context.route(/unpkg\.com|cdn\.jsdelivr\.net/, route => {
    const body = libBody(route.request().url());
    if (!body) return route.abort();
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
      body
    });
  });
}

// Every context starts isolated: nothing but the local test server is
// reachable unless a suite routes it, and WebSockets are refused unless a
// suite mocks them. Routes registered later take precedence, so suites'
// own mocks override these.
function isolate(browser, base) {
  const local = new URL(base).host;

  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async options => {
          const context = await target.newContext(options);
          await context.route(url => url.host !== local, route => route.abort('blockedbyclient'));
          await context.routeWebSocket(/.*/, ws => ws.close());
          return context;
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

// Saves a screenshot when E2E_SCREENSHOTS names a directory.
async function shot(page, name, fullPage = false) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage });
}

module.exports = { ROOT, LIBS, libBody, routeLibs, isolate, shot };
