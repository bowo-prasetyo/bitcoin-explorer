const API = 'https://blockstream.info/api';

export async function getTipHeight() {
  const r = await fetch(`${API}/blocks/tip/height`);
  return parseInt(await r.text());
}

export async function getBlockHash(height) {
  const r = await fetch(`${API}/block-height/${height}`);
  return await r.text();
}

export async function getBlock(hash) {
  const r = await fetch(`${API}/block/${hash}`);
  return await r.json();
}

export async function getBlockTxs(hash) {
  const r = await fetch(`${API}/block/${hash}/txs`);
  return await r.json();
}

export async function getTx(txid) {
  const r = await fetch(`${API}/tx/${txid}`);
  return await r.json();
}

export async function getAddress(addr) {
  const r = await fetch(`${API}/address/${addr}`);
  return await r.json();
}

export async function getMempool() {
  const r = await fetch(`${API}/mempool`);
  return await r.json();
}
