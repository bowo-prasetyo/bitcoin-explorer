# Glossary

Plain explanations of the terms used in Assay and its docs.

- **Address**: A destination for bitcoin, such as `1A1zP1…` (legacy), `bc1q…`
  (SegWit) or `bc1p…` (Taproot). Assay accepts mainnet addresses only.
- **Block**: A batch of transactions added to the blockchain, roughly every 10
  minutes.
- **Block hash / block id**: The block's unique fingerprint: 64 hexadecimal characters. On mainnet
  it always starts with many zeros, because of proof of work.
- **Block header**: The block's 80-byte summary. It includes the previous block's hash,
  the Merkle root, the time and the difficulty target. Hashing it gives
  the block hash.
- **Block height**: A block's position in the chain. The genesis block is height 0.
- **BTC, sat**: Bitcoin's unit. 1 BTC = 100,000,000 sat (satoshis).
- **Chain tip**: The newest block on the chain.
- **Chainwork**: The total proof of work behind a block, added up from the genesis
  block. Bitcoin Core reports it in hexadecimal. Nodes follow the chain
  with the most of it.
- **Coinbase transaction**: The first transaction in each block. It creates new bitcoin for the
  miner, so it has no real inputs. (Unrelated to the company with the
  same name.)
- **Confirmations**: How many blocks have been mined since a block, counting that block
  itself. The more there are, the harder it is to reverse.
- **CORS**: A web security rule. A server must send an `Access-Control-Allow-Origin`
  header before a browser lets a page on another site read its answers.
  Your own endpoint needs it.
- **Difficulty**: How hard it is to find a valid block, relative to the easiest
  difficulty that Bitcoin allows.
- **Difficulty period**: 2,016 blocks, about two weeks. The difficulty stays the same for the
  whole period.
- **Endpoint / provider**: A server that answers Assay's questions about the blockchain. By
  default these are Blockstream and mempool.space. You can add your own.
- **Esplora**: A widely used web API for Bitcoin data. Blockstream, mempool.space,
  electrs and the mempool backend all speak it.
- **electrs**: Open-source server software that adds an Esplora API to your own
  Bitcoin node.
- **Fee rate (sat/vB)**: The fee divided by the transaction's size in virtual bytes. Miners
  prefer higher fee rates.
- **Genesis block**: The first Bitcoin block, mined by Satoshi Nakamoto on 3 January 2009.
- **Hex (hexadecimal)**: Base-16 numbers, written with `0`–`9` and `a`–`f`.
- **Input / output**: A transaction spends *outputs* of earlier transactions (its inputs)
  and creates new outputs, each with an amount and a script that says
  who can spend it.
- **Mainnet / testnet**: Mainnet is the real Bitcoin network. Testnet is a practice network
  with worthless coins. Assay shows mainnet only.
- **Mempool**: Transactions waiting to be included in a block. Every node keeps its
  own, so they can differ slightly.
- **Merkle root / Merkle proof**: The Merkle root is a single hash in the block header that summarises
  every transaction in the block. A Merkle proof is a short list of
  hashes showing that one transaction is part of that summary, without
  downloading the whole block.
- **OP_RETURN**: An output that carries a small piece of data instead of paying anyone.
- **Proof of work**: Evidence of computing spent to produce a block: its hash is
  at or below the target. Anyone can check it instantly. The work proved is only
  as much as the block's difficulty demands, so a block also needs the
  difficulty Bitcoin requires at its height.
- **Retarget**: The difficulty adjustment at the start of each period. If the last
  2,016 blocks came faster than two weeks, difficulty goes up. If slower,
  it goes down, by at most 4× either way.
- **Target**: The number a block hash must not exceed. A lower target means a
  higher difficulty.
- **Tor / .onion**: Tor is a network that hides where requests come from. `.onion`
  addresses can only be reached through it, for example in Tor Browser.
- **Transaction id (txid)**: A transaction's fingerprint: 64 hexadecimal
  characters. Practically unique, though two early coinbase transactions were
  each repeated once (BIP 30).
- **UTXO set**: The set of all unspent transaction outputs: every coin that exists
  right now. Only full nodes keep it, which is why balances can't be
  proved in a browser.
- **vB (virtual bytes), WU (weight units)**: Measures of transaction and block size since SegWit. 1 vB = 4 WU. A
  block holds at most 4,000,000 WU.
