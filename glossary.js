// glossary.js
// The glossary shown in the app (#/glossary and the terms you can tap).
// It must match docs/glossary.md word for word: tests/glossary.test.mjs
// fails when they drift apart, so edit both together.
// Text uses three bits of Markdown: **bold**, *italics* and `code`.

export const GLOSSARY = [
  {
    id: 'address',
    term: "Address",
    text: "A destination for bitcoin, such as `1A1zP1…` (legacy), `bc1q…` (SegWit) or `bc1p…` (Taproot). Assay accepts mainnet addresses only."
  },
  {
    id: 'block',
    term: "Block",
    text: "A batch of transactions added to the blockchain, roughly every 10 minutes."
  },
  {
    id: 'block-hash-block-id',
    term: "Block hash / block id",
    text: "The block's unique fingerprint: 64 hexadecimal characters. On mainnet it always starts with many zeros, because of proof of work."
  },
  {
    id: 'block-header',
    term: "Block header",
    text: "The block's 80-byte summary. It includes the previous block's hash, the Merkle root, the time and the difficulty target. Hashing it gives the block hash."
  },
  {
    id: 'block-height',
    term: "Block height",
    text: "A block's position in the chain. The genesis block is height 0."
  },
  {
    id: 'btc-sat',
    term: "BTC, sat",
    text: "Bitcoin's unit. 1 BTC = 100,000,000 sat (satoshis)."
  },
  {
    id: 'chain-tip',
    term: "Chain tip",
    text: "The newest block on the chain."
  },
  {
    id: 'chainwork',
    term: "Chainwork",
    text: "The total proof of work behind a block, added up from the genesis block. Bitcoin Core reports it in hexadecimal. Nodes follow the chain with the most of it."
  },
  {
    id: 'coinbase-transaction',
    term: "Coinbase transaction",
    text: "The first transaction in each block. It creates new bitcoin for the miner, so it has no real inputs. (Unrelated to the company with the same name.)"
  },
  {
    id: 'confirmations',
    term: "Confirmations",
    text: "How many blocks have been mined since a block, counting that block itself. The more there are, the harder it is to reverse."
  },
  {
    id: 'cors',
    term: "CORS",
    text: "A web security rule. A server must send an `Access-Control-Allow-Origin` header before a browser lets a page on another site read its answers. Your own endpoint needs it."
  },
  {
    id: 'difficulty',
    term: "Difficulty",
    text: "How hard it is to find a valid block, relative to the easiest difficulty that Bitcoin allows."
  },
  {
    id: 'difficulty-period',
    term: "Difficulty period",
    text: "2,016 blocks, about two weeks. The difficulty stays the same for the whole period."
  },
  {
    id: 'endpoint-provider',
    term: "Endpoint / provider",
    text: "A server that answers Assay's questions about the blockchain. By default these are Blockstream and mempool.space. You can add your own."
  },
  {
    id: 'esplora',
    term: "Esplora",
    text: "A widely used web API for Bitcoin data. Blockstream, mempool.space, electrs and the mempool backend all speak it."
  },
  {
    id: 'electrs',
    term: "electrs",
    text: "Open-source server software that adds an Esplora API to your own Bitcoin node."
  },
  {
    id: 'fee-rate',
    term: "Fee rate (sat/vB)",
    text: "The fee divided by the transaction's size in virtual bytes. Miners prefer higher fee rates."
  },
  {
    id: 'genesis-block',
    term: "Genesis block",
    text: "The first Bitcoin block, mined by Satoshi Nakamoto on 3 January 2009."
  },
  {
    id: 'hex',
    term: "Hex (hexadecimal)",
    text: "Base-16 numbers, written with `0`–`9` and `a`–`f`."
  },
  {
    id: 'input-output',
    term: "Input / output",
    text: "A transaction spends *outputs* of earlier transactions (its inputs) and creates new outputs, each with an amount and a script that says who can spend it."
  },
  {
    id: 'mainnet-testnet',
    term: "Mainnet / testnet",
    text: "Mainnet is the real Bitcoin network. Testnet is a practice network with worthless coins. Assay shows mainnet only."
  },
  {
    id: 'mempool',
    term: "Mempool",
    text: "Transactions waiting to be included in a block. Every node keeps its own, so they can differ slightly."
  },
  {
    id: 'merkle-root-merkle-proof',
    term: "Merkle root / Merkle proof",
    text: "The Merkle root is a single hash in the block header that summarises every transaction in the block. A Merkle proof is a short list of hashes showing that one transaction is part of that summary, without downloading the whole block."
  },
  {
    id: 'op-return',
    term: "OP_RETURN",
    text: "An output that carries a small piece of data instead of paying anyone."
  },
  {
    id: 'proof-of-work',
    term: "Proof of work",
    text: "Evidence that a lot of computing was spent to produce a block: its hash is below the target. Anyone can check it instantly."
  },
  {
    id: 'retarget',
    term: "Retarget",
    text: "The difficulty adjustment at the start of each period. If the last 2,016 blocks came faster than two weeks, difficulty goes up. If slower, it goes down, by at most 4× either way."
  },
  {
    id: 'target',
    term: "Target",
    text: "The number a block hash must be below. A lower target means a higher difficulty."
  },
  {
    id: 'tor-onion',
    term: "Tor / .onion",
    text: "Tor is a network that hides where requests come from. `.onion` addresses can only be reached through it, for example in Tor Browser."
  },
  {
    id: 'transaction-id',
    term: "Transaction id (txid)",
    text: "A transaction's unique fingerprint: 64 hexadecimal characters."
  },
  {
    id: 'utxo-set',
    term: "UTXO set",
    text: "The set of all unspent transaction outputs: every coin that exists right now. Only full nodes keep it, which is why balances can't be proved in a browser."
  },
  {
    id: 'vb-wu',
    term: "vB (virtual bytes), WU (weight units)",
    text: "Measures of transaction and block size since SegWit. 1 vB = 4 WU. A block holds at most 4,000,000 WU."
  }
];

const BY_ID = new Map(GLOSSARY.map(e => [e.id, e]));

export function glossaryEntry(id) {
  return BY_ID.get(id) || null;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The little Markdown the glossary uses, as safe HTML.
export function glossaryHtml(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
