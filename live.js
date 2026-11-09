// live.js
// Live "new block" notifications over WebSocket, used as a hint only.
//
// One shared connection to a mempool-style WebSocket API subscribed to
// new blocks and nothing else. A message never reaches the screen: it
// only tells the refreshers to fetch (and verify) the new tip through the
// normal REST path now, instead of polling for it every few seconds.
//
// Etiquette: open only while a visible page needs it, close when hidden
// or unused, ping to detect dead connections, back off exponentially
// with jitter, and fall back to polling when no socket is available.
//
// The protocol helpers are pure and touch no browser globals at import;
// they're covered by tests/live.test.mjs.

export const MEMPOOL_WS = 'wss://mempool.space/api/v1/ws';

// =====================================================
// PURE HELPERS
// =====================================================

// "https://node.example/api" -> "wss://node.example/api/v1/ws"
// (the path mempool's backend serves its WebSocket on).
export function wsUrlFromBase(base) {
  return base.replace(/^http/, 'ws').replace(/\/+$/, '') + '/v1/ws';
}

// Where to connect, best first. Blockstream's API has no WebSocket, so
// without a custom endpoint mempool.space is the only candidate. An
// exclusive custom endpoint means no one else is ever contacted.
export function liveCandidates(settings) {
  const custom = settings?.custom;
  const list = [];

  if (custom) {
    list.push(wsUrlFromBase(custom.base));
    if (custom.exclusive) {
      return list;
    }
  }

  if (!list.includes(MEMPOOL_WS)) {
    list.push(MEMPOOL_WS);
  }

  return list;
}

// The subscription message: blocks only.
export const WANT_BLOCKS = JSON.stringify({ action: 'want', data: ['blocks'] });
export const PING = JSON.stringify({ action: 'ping' });

const isBlock = b =>
  b && /^[0-9a-f]{64}$/.test(b.id) && Number.isInteger(b.height) && b.height >= 0;

// One WebSocket message -> list of events we care about:
//   { type: 'block', height, id }   (from "block" or the "blocks" snapshot)
//   { type: 'pong' }
// Anything else (other topics, malformed data) is ignored.
export function parseMessage(text) {
  let msg;

  try {
    msg = JSON.parse(text);
  } catch {
    return [];
  }

  if (!msg || typeof msg !== 'object') {
    return [];
  }

  const events = [];

  if (msg.pong) {
    events.push({ type: 'pong' });
  }

  const blocks = [
    ...(Array.isArray(msg.blocks) ? msg.blocks : []),
    ...(msg.block ? [msg.block] : [])
  ];

  for (const b of blocks.filter(isBlock)) {
    events.push({ type: 'block', height: b.height, id: b.id });
  }

  return events;
}

// Exponential back-off with jitter: 2 s, 4 s, 8 s ... capped at 5 min,
// each scaled by 0.75-1.25 so many clients don't reconnect in lockstep.
export function backoffDelay(attempt, random = Math.random()) {
  const base = Math.min(300000, 2000 * 2 ** attempt);
  return Math.round(base * (0.75 + 0.5 * random));
}

// =====================================================
// THE SHARED CONNECTION
// =====================================================

const ENABLED_KEY = 'btc_explorer_live';
const PING_INTERVAL = 30000;
const STALE_AFTER = 75000;      // no message at all for this long: reconnect
const HIDDEN_GRACE = 30000;     // keep the socket briefly across tab switches
const UNUSED_GRACE = 10000;     // ...and across page navigation
const UNAVAILABLE_AFTER = 5;    // failed attempts before saying "unavailable"

class LiveFeed {

  constructor() {
    this.getCandidates = () => [MEMPOOL_WS];
    this.blockListeners = new Set();
    this.statusListeners = new Set();
    this.status = 'off';            // off | connecting | live | unavailable | disabled
    this.enabled = true;
    this.ws = null;
    this.failures = 0;
    this.candidateIndex = 0;
    this.lastHeight = null;
    this.timers = {};
    this.stats = { messages: 0, bytes: 0, blocks: 0, connects: 0, url: null };
    this.started = false;
  }

  // Called once by app.js, in the browser.
  start({ getCandidates }) {
    if (this.started) return;
    this.started = true;
    this.getCandidates = getCandidates;

    try {
      this.enabled = localStorage.getItem(ENABLED_KEY) !== '0';
    } catch {
      this.enabled = true;
    }

    if (!this.enabled) this.setStatus('disabled');

    document.addEventListener('visibilitychange', () => this.ensure());
  }

  isLive() {
    return this.status === 'live';
  }

  // fn({ height, id }) on each new block. Returns an unsubscribe function.
  onBlock(fn) {
    this.blockListeners.add(fn);
    this.ensure();
    return () => {
      this.blockListeners.delete(fn);
      this.ensure();
    };
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.close();
    this.failures = 0;
    this.setStatus(on ? 'off' : 'disabled');
    this.ensure();
  }

  // Provider settings changed: reconnect to the new candidates.
  reconfigure() {
    this.close();
    this.failures = 0;
    this.candidateIndex = 0;
    if (this.enabled) this.setStatus('off');
    this.ensure();
  }

  // ---------------------------------------------------

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  clearTimer(name) {
    clearTimeout(this.timers[name]);
    clearInterval(this.timers[name]);
    delete this.timers[name];
  }

  // Open or close the socket to match what's needed right now.
  ensure() {
    const visible = document.visibilityState === 'visible';
    const wanted = this.enabled && this.blockListeners.size > 0 && visible;

    if (wanted) {
      this.clearTimer('closeLater');
      if (!this.ws && !this.timers.reconnect) this.connect();
      return;
    }

    if (this.ws && !this.timers.closeLater) {
      const grace = visible ? UNUSED_GRACE : HIDDEN_GRACE;
      this.timers.closeLater = setTimeout(() => {
        delete this.timers.closeLater;
        this.close();
        if (this.enabled) this.setStatus('off');
      }, grace);
    }

    if (!wanted && this.timers.reconnect) {
      this.clearTimer('reconnect');
      if (this.enabled) this.setStatus('off');
    }
  }

  connect() {
    const candidates = this.getCandidates();

    if (!candidates.length) {
      this.setStatus('unavailable');
      return;
    }

    const url = candidates[this.candidateIndex % candidates.length];

    this.setStatus(this.failures >= UNAVAILABLE_AFTER ? 'unavailable' : 'connecting');

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;
    this.stats.url = url;

    ws.onopen = () => {
      this.failures = 0;
      this.stats.connects++;
      this.setStatus('live');
      ws.send(WANT_BLOCKS);
      this.touch();
      this.timers.ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(PING);
      }, PING_INTERVAL);
    };

    ws.onmessage = e => {
      const text = typeof e.data === 'string' ? e.data : '';
      this.stats.messages++;
      this.stats.bytes += text.length;
      this.touch();

      // A snapshot lists several blocks; only the highest one matters.
      const newest = parseMessage(text)
        .filter(ev => ev.type === 'block')
        .reduce((a, b) => (!a || b.height > a.height ? b : a), null);

      if (newest) this.handleBlock(newest);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // closed on purpose and already replaced
      this.ws = null;
      this.clearTimer('ping');
      this.clearTimer('stale');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows; nothing else to do here.
    };
  }

  // Any message proves the connection is alive.
  touch() {
    this.clearTimer('stale');
    this.timers.stale = setTimeout(() => this.ws?.close(), STALE_AFTER);
  }

  handleBlock({ height, id }) {
    // The first snapshot after connecting sets a baseline; after a
    // reconnect, anything newer than what we'd seen is reported.
    if (this.lastHeight !== null && height > this.lastHeight) {
      this.stats.blocks++;
      for (const fn of this.blockListeners) fn({ height, id });
    }

    if (this.lastHeight === null || height > this.lastHeight) {
      this.lastHeight = height;
    }
  }

  scheduleReconnect() {
    this.failures++;
    this.candidateIndex++; // try the next candidate, if there is one
    this.setStatus(this.failures >= UNAVAILABLE_AFTER ? 'unavailable' : 'connecting');

    const delay = backoffDelay(this.failures - 1);
    this.timers.reconnect = setTimeout(() => {
      delete this.timers.reconnect;
      if (this.enabled && this.blockListeners.size > 0 && document.visibilityState === 'visible') {
        this.connect();
      } else {
        this.setStatus(this.enabled ? 'off' : 'disabled');
      }
    }, delay);
  }

  close() {
    for (const name of Object.keys(this.timers)) this.clearTimer(name);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      try { ws.close(); } catch { /* ignore */ }
    }
  }
}

export const liveFeed = new LiveFeed();
