// theme.js
// Light or dark. A plain script loaded in <head> before the stylesheet, so
// the right colours are there on the very first paint (no dark flash for
// light-mode users). The stylesheet holds both palettes (styles.css: :root
// is dark, [data-theme="light"] is light); this only picks one.
//
// The choice is 'system' (default: follow the device, live), 'light' or
// 'dark'. Written with `var` and function declarations so that
// tests/theme.test.mjs can load it in Node.

var THEME_KEY = 'assay_theme';
var THEME_CHOICES = ['system', 'light', 'dark'];

// Browser and installed-app title bar, per theme (match --header).
var THEME_BAR = { dark: '#1f1f1f', light: '#ffffff' };

function resolveTheme(choice, systemPrefersLight) {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemPrefersLight ? 'light' : 'dark';
}

// `storage` is a function returning localStorage: in some private modes
// merely touching window.localStorage throws, so it's only touched inside
// the try. (A plain storage object works too, for tests.)
function readThemeChoice(storage) {
  try {
    var store = typeof storage === 'function' ? storage() : storage;
    var saved = store.getItem(THEME_KEY);
    return THEME_CHOICES.indexOf(saved) !== -1 ? saved : 'system';
  } catch (e) {
    return 'system'; // private mode, blocked storage
  }
}

(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var listeners = [];
  var storage = function () { return window.localStorage; };
  var choice = readThemeChoice(storage);

  function apply() {
    var theme = resolveTheme(choice, !!(media && media.matches));
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);

    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute('content', THEME_BAR[theme]);

    for (var i = 0; i < listeners.length; i++) listeners[i](theme, choice);
  }

  // Following the device: switch live when it changes (e.g. at sunset).
  if (media) {
    var onSystemChange = function () { if (choice === 'system') apply(); };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  window.AssayTheme = {
    choice: function () { return choice; },
    theme: function () { return document.documentElement.getAttribute('data-theme'); },

    set: function (next) {
      choice = THEME_CHOICES.indexOf(next) !== -1 ? next : 'system';
      try {
        if (choice === 'system') storage().removeItem(THEME_KEY);
        else storage().setItem(THEME_KEY, choice);
      } catch (e) { /* not remembered, still applied */ }
      apply();
    },

    // fn(theme, choice) after every change.
    onChange: function (fn) { listeners.push(fn); },

    // A colour token from styles.css, as currently applied, for canvas
    // drawing (Chart.js can't read CSS variables itself).
    color: function (name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
  };

  apply();
})();
