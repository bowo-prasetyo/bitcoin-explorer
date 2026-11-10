// titles.js
// The browser tab title for each page, so tabs and history can be told
// apart. Pure; covered by tests/titles.test.mjs. Views with better names
// once their data loads (a block's height) call setPageTitle() in app.js.

export const SITE = 'Assay';

// "000000000019d6…a8ce26f" style: enough to recognise, short enough for a tab.
export function shortId(id, head = 6, tail = 6) {
  const s = String(id || '');
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function titleFor(route) {
  const p = route.params || {};
  const name = {
    '/': null,
    '/charts': 'Charts',
    '/providers': 'Providers',
    '/glossary': 'Glossary'
  };

  if (route.path in name) {
    return name[route.path] ? `${name[route.path]} · ${SITE}` : `${SITE} · Bitcoin explorer`;
  }
  if (p.hash) return `Block ${shortId(p.hash)} · ${SITE}`;
  if (p.txid) return `Transaction ${shortId(p.txid)} · ${SITE}`;
  if (p.addr) return `Address ${shortId(p.addr)} · ${SITE}`;

  return `Page not found · ${SITE}`;
}

// Once a block page knows the height: "Block 840,000 · Assay".
export function blockTitle(height) {
  return `Block ${Number(height).toLocaleString('en-US')} · ${SITE}`;
}
