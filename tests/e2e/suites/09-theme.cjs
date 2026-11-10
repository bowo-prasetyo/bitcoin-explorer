// Light and dark themes: following the device, the footer choice, no
// flash on load, the logo, the title-bar colour and chart colours.
// Run with: npm run test:e2e (see tests/e2e/README.md)

const { routeLibs, shot } = require('../lib.cjs');

const BH = '00000000' + 'a'.repeat(56);
const NOW = Math.floor(Date.now() / 1000);
const BLOCK = { id: BH, height: 870000, timestamp: NOW - 600, tx_count: 2, size: 1500000, weight: 3990000, previousblockhash: '00000000' + 'b'.repeat(56) };

const mock = {
  '/blocks/tip/height': '870000',
  '/block-height/870000': BH,
  [`/block/${BH}`]: BLOCK,
  '/blocks': [BLOCK],
  '/mempool': { count: 4321, vsize: 2500000, total_fee: 1000000, fee_histogram: [[20, 500000], [5, 1500000], [1, 900000]] },
  '/fee-estimates': { 1: 20, 3: 10, 6: 5 }
};

async function setup(context) {
  await routeLibs(context);
  await context.route(/blockstream\.info|mempool\.space/, route => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const headers = { 'access-control-allow-origin': '*' };
    if (!(p in mock)) return route.fulfill({ status: 404, headers, body: 'not found' });
    const v = mock[p];
    route.fulfill({ status: 200, headers, body: typeof v === 'string' ? v : JSON.stringify(v) });
  });
  // The theme at the moment <body> is created: before the app (or any
  // paint of the page's content) runs.
  await context.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (document.body) {
        window.__themeAtBody = document.documentElement.getAttribute('data-theme');
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

// What the page looks like right now.
const look = page => page.evaluate(() => {
  const chart = Chart.getChart('histogramChart');
  const bar = chart?.getDatasetMeta(0).data[0]?.options.backgroundColor;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    atBody: window.__themeAtBody,
    bg: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.card')).backgroundColor,
    logo: document.querySelector('header .brand img').getAttribute('src'),
    bar,
    tick: chart?.scales.x.options.ticks.color,
    themeColor: document.querySelector('meta[name="theme-color"]').content,
    choice: document.querySelector('.theme-choice input:checked')?.value,
    stored: localStorage.getItem('assay_theme')
  };
});

const LIGHT_BG = 'rgb(243, 244, 246)';
const DARK_BG = 'rgb(17, 17, 17)';

module.exports = async function ({ chromium, BASE, check }) {
  const browser = await chromium.launch();
  const errors = [];

  // ---- A device set to light mode
  const lightCtx = await browser.newContext({ viewport: { width: 1100, height: 1300 }, colorScheme: 'light' });
  await setup(lightCtx);
  const page = await lightCtx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector('text=4,321');
  await page.waitForFunction(() => Chart.getChart('histogramChart')?.getDatasetMeta(0).data.length > 0);

  let s = await look(page);
  check('light device: light theme by default', s.theme === 'light' && s.bg === LIGHT_BG && s.card === 'rgb(255, 255, 255)', JSON.stringify(s));
  check('light device: theme set before <body> exists (no dark flash)', s.atBody === 'light', String(s.atBody));
  check('light device: logo for light backgrounds', s.logo === 'brand/assay-logo-on-light.svg', s.logo);
  check('light device: light title bar', s.themeColor === '#ffffff', s.themeColor);
  check('light device: chart drawn in the light palette', s.bar === '#0a6fb5' && s.tick === '#4a5159', `${s.bar} ${s.tick}`);
  check('light device: footer shows "System" chosen, nothing stored', s.choice === 'system' && s.stored === null, `${s.choice} ${s.stored}`);
  await shot(page, '09-light-home.png', true);

  // ---- Choose Dark in the footer: instant, charts included
  await page.check('.theme-choice input[value="dark"]');
  s = await look(page);
  check('choosing Dark switches at once', s.theme === 'dark' && s.bg === DARK_BG && s.logo === 'brand/assay-logo.svg' && s.themeColor === '#1f1f1f', JSON.stringify(s));
  check('choosing Dark recolours the chart without a reload', s.bar === '#4fc3f7' && s.tick === '#bdbdbd', `${s.bar} ${s.tick}`);
  check('the choice is remembered', s.stored === 'dark', String(s.stored));

  await page.reload();
  await page.waitForSelector('text=4,321');
  s = await look(page);
  check('Dark survives a reload on a light device, with no flash', s.theme === 'dark' && s.atBody === 'dark' && s.choice === 'dark', JSON.stringify(s));
  await shot(page, '09-dark-home.png');

  // ---- Back to System: follows the device again, live
  await page.check('.theme-choice input[value="system"]');
  s = await look(page);
  check('System follows the device again', s.theme === 'light' && s.stored === null, JSON.stringify(s));

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  s = await look(page);
  check('System: device switches to dark -> page follows live', s.theme === 'dark' && s.bg === DARK_BG && s.bar === '#4fc3f7', JSON.stringify(s));

  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  check('System: and back to light', (await look(page)).bg === LIGHT_BG);

  // ---- An explicit choice ignores the device
  await page.check('.theme-choice input[value="light"]');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  s = await look(page);
  check('Light chosen: stays light when the device turns dark', s.theme === 'light' && s.bg === LIGHT_BG, JSON.stringify(s));

  // ---- Badges and notices take the light palette
  await page.goto(BASE + '#/nope');
  await page.waitForSelector('text=Page not found');
  const notice = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'notice notice-error';
    document.querySelector('.card').append(el);
    const ok = document.createElement('div');
    ok.className = 'verify verify-ok';
    document.querySelector('.card').append(ok);
    return [getComputedStyle(el).backgroundColor, getComputedStyle(ok).backgroundColor];
  });
  check('light: error notices and verified badges use light state colours',
    notice[0] === 'rgb(253, 236, 236)' && notice[1] === 'rgb(233, 246, 236)', notice.join(' / '));

  // ---- A device set to dark mode, nothing chosen: dark, as before
  const darkCtx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: 'dark' });
  await setup(darkCtx);
  const dark = await darkCtx.newPage();
  dark.on('pageerror', e => errors.push(e.message));
  await dark.goto(BASE);
  await dark.waitForSelector('text=4,321');
  s = await look(dark);
  check('dark device: dark theme by default, before <body>', s.theme === 'dark' && s.atBody === 'dark' && s.bg === DARK_BG, JSON.stringify(s));

  // ---- Storage blocked (private modes): still works, follows the device
  const blockedCtx = await browser.newContext({ colorScheme: 'light' });
  await setup(blockedCtx);
  await blockedCtx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const blocked = await blockedCtx.newPage();
  const blockedErrors = [];
  blocked.on('pageerror', e => blockedErrors.push(e.message));
  await blocked.goto(BASE);
  await blocked.waitForTimeout(800);
  const blockedTheme = await blocked.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('storage blocked: theme still follows the device', blockedTheme === 'light', String(blockedTheme));

  check('no page errors', errors.length === 0, errors.join(' | '));
};
