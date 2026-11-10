// Runs the browser tests: serves the site from the repository root on a
// local port, runs every suite in tests/e2e/suites (or the ones named on
// the command line), and exits non-zero if any check fails.
//
//   npm run test:e2e                      all suites
//   npm run test:e2e -- 03 08             suites whose names contain 03 or 08
//   E2E_SCREENSHOTS=shots npm run test:e2e   also save screenshots

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, isolate } = require('./lib.cjs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));

    if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const filters = process.argv.slice(2);
  const dir = path.join(__dirname, 'suites');
  const suites = fs.readdirSync(dir)
    .filter(f => f.endsWith('.cjs'))
    .filter(f => !filters.length || filters.some(x => f.includes(x)))
    .sort();

  const server = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}/`;

  let passed = 0;
  let failed = 0;

  for (const file of suites) {
    console.log(`\n${file}`);

    const browsers = [];
    const isolatedChromium = {
      launch: async options => {
        const browser = await chromium.launch(options);
        browsers.push(browser);
        return isolate(browser, BASE);
      }
    };

    const check = (name, ok, detail = '') => {
      ok ? passed++ : failed++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
    };

    const started = Date.now();
    try {
      await require(path.join(dir, file))({ chromium: isolatedChromium, BASE, check });
    } catch (err) {
      failed++;
      console.log(`  FAIL  suite stopped: ${String(err?.message || err).split('\n')[0]}`);
    } finally {
      await Promise.all(browsers.map(b => b.close().catch(() => {})));
    }
    console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }

  server.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
