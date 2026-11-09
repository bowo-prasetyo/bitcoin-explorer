// format.js
// Display formatting shared by all views. No framework dependencies, so it
// can be unit-tested in Node (tests/format.test.mjs).

const SATS_PER_BTC = 100000000;

// 12345678 -> "12,345,678"
export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) {
    return '–';
  }
  return Number(n).toLocaleString('en-US');
}

// 12345 -> "0.00012345 BTC". Exact: works on integer sats, no float math.
export function formatBtc(sats, { sign = false } = {}) {
  if (sats === null || sats === undefined || Number.isNaN(sats)) {
    return '–';
  }

  const negative = sats < 0;
  const abs = Math.abs(Math.trunc(sats));

  const whole = Math.floor(abs / SATS_PER_BTC);
  const frac = String(abs % SATS_PER_BTC).padStart(8, '0');

  const prefix = negative ? '−' : (sign && abs > 0 ? '+' : '');

  return `${prefix}${formatNumber(whole)}.${frac} BTC`;
}

export function formatSats(sats) {
  return `${formatNumber(sats)} sats`;
}

// Esplora gives weight in weight units; vsize is weight / 4, rounded up.
export function vsizeFromWeight(weight) {
  return Math.ceil(weight / 4);
}

// sat/vB with one decimal, e.g. "12.3 sat/vB".
export function formatFeeRate(feeSats, weight) {
  if (!weight || feeSats === undefined || feeSats === null) {
    return '–';
  }
  const rate = feeSats / vsizeFromWeight(weight);
  return `${rate.toFixed(1)} sat/vB`;
}

// Unix seconds -> "2024-10-27 03:33 UTC"
export function formatTime(unixSeconds) {
  if (!unixSeconds) {
    return '–';
  }
  const iso = new Date(unixSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// Milliseconds timestamp -> "just now", "42s ago", "5 min ago", "3 h ago",
// "12 days ago".
export function formatAgo(timestampMs, nowMs = Date.now()) {
  const s = Math.max(0, Math.round((nowMs - timestampMs) / 1000));

  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;

  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;

  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;

  const d = Math.round(h / 24);
  if (d < 365) return `${d} days ago`;

  const y = Math.floor(d / 365);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

// 1234567 vB -> "1.23 MvB"
export function formatVsize(vbytes) {
  if (vbytes === null || vbytes === undefined) {
    return '–';
  }
  if (vbytes >= 1e6) return `${(vbytes / 1e6).toFixed(2)} MvB`;
  if (vbytes >= 1e3) return `${(vbytes / 1e3).toFixed(1)} kvB`;
  return `${vbytes} vB`;
}

// Net effect of a transaction on one address, in sats:
// outputs paying the address minus inputs spending from it.
export function addressNetValue(tx, address) {
  let received = 0;
  let sent = 0;

  for (const vout of tx.vout || []) {
    if (vout.scriptpubkey_address === address) {
      received += vout.value || 0;
    }
  }

  for (const vin of tx.vin || []) {
    if (vin.prevout?.scriptpubkey_address === address) {
      sent += vin.prevout.value || 0;
    }
  }

  return received - sent;
}

export function sumValues(items, pick = x => x.value) {
  return (items || []).reduce((acc, x) => acc + (pick(x) || 0), 0);
}
