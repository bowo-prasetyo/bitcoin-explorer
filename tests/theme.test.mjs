import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function block(selector) {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, `${selector} block missing`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])
  );
}

const dark = block(':root');
const light = block(':root[data-theme="light"]');

// WCAG 2 relative luminance and contrast ratio, for #rgb / #rrggbb.
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum]: 4.5 for text, 3 for borders, focus
// rings and chart lines (WCAG 1.4.3 and 1.4.11).
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5], ['text', 'header', 4.5],
  ['text-2', 'surface', 4.5], ['text-2', 'surface-2', 4.5],
  ['muted', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'neutral-bg', 4.5],
  ['link', 'surface', 4.5], ['link', 'bg', 4.5], ['link', 'header', 4.5], ['link-hover', 'surface', 4.5],
  ['primary-text', 'primary', 4.5],
  ['ok-text', 'ok-bg', 4.5], ['pos', 'ok-bg', 4.5], ['pos', 'surface', 4.5], ['pos', 'header', 4.5],
  ['fail-text', 'fail-bg', 4.5], ['neg', 'surface', 4.5],
  ['warn-text', 'warn-bg', 4.5],
  ['tag-text', 'tag-bg', 4.5],
  ['chart-text', 'surface', 4.5],
  ['focus', 'surface', 3], ['focus', 'bg', 3], ['focus', 'header', 3],
  ['input-border', 'surface', 3],
  ['ok-border', 'surface', 3], ['fail-border', 'surface', 3], ['warn-border', 'warn-bg', 3],
  ['neutral-border', 'surface', 3],
  ['chart-1', 'surface', 3], ['chart-target', 'surface', 3]
];

for (const [name, palette] of [['dark', dark], ['light', light]]) {
  test(`${name} palette keeps WCAG contrast`, () => {
    const low = PAIRS
      .map(([fg, bg, min]) => [fg, bg, min, contrast(palette[fg], palette[bg])])
      .filter(([, , min, ratio]) => ratio < min)
      .map(([fg, bg, min, ratio]) => `--${fg} on --${bg}: ${ratio.toFixed(2)}:1 (needs ${min}:1)`);
    assert.deepEqual(low, []);
  });
}

test('both palettes define exactly the same tokens', () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

test('no colour is hard-coded outside the palettes', () => {
  const rest = css.slice(css.indexOf('color-scheme: light;'));
  const literal = rest.split('\n').filter(l => /#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(l));
  assert.deepEqual(literal, []);
});

// theme.js: load it as a browser would, with no document (logic only).
const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../theme.js', import.meta.url), 'utf8'), sandbox);

test('resolveTheme: a choice wins, "system" follows the device', () => {
  const { resolveTheme } = sandbox;
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
});

test('readThemeChoice: only known choices, "system" otherwise', () => {
  const { readThemeChoice } = sandbox;
  const store = v => ({ getItem: () => v });
  assert.equal(readThemeChoice(store('light')), 'light');
  assert.equal(readThemeChoice(store('dark')), 'dark');
  assert.equal(readThemeChoice(store(null)), 'system');
  assert.equal(readThemeChoice(store('purple')), 'system');
  assert.equal(readThemeChoice({ getItem() { throw new Error('blocked'); } }), 'system');
  // Private modes where merely reaching localStorage throws.
  assert.equal(readThemeChoice(() => { throw new Error('SecurityError'); }), 'system');
  assert.equal(readThemeChoice(() => store('dark')), 'dark');
});

test('title-bar colours match each palette\'s header', () => {
  assert.equal(sandbox.THEME_BAR.dark, dark.header);
  assert.equal(sandbox.THEME_BAR.light, light.header);
});
