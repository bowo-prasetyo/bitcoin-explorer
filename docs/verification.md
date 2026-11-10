# What your browser verifies

Assay downloads raw Bitcoin data (block headers, raw transactions,
*Merkle proofs*) and checks the cryptography in your browser before it
shows a result. This page lists every check, exactly what it proves, and,
just as important, what it **doesn't**.

For how to read the badges on screen, see the
[user guide](user-guide.md#3-reading-the-verification-badges). Terms in
*italics* are explained in the [glossary](glossary.md).

**At a glance**

| Check | Where | Runs |
|---|---|---|
| [Block proof of work](#block-proof-of-work) | Block pages | Always |
| [Block difficulty](#block-difficulty) | Block pages | Always |
| [Difficulty history](#difficulty-history) | Block pages; home page | Automatically once headers are saved; otherwise on request |
| [Block transactions](#block-transactions) | Block pages | Always |
| [Transaction contents](#transaction-contents) | Transaction pages | Always |
| [Input amounts and fee](#input-amounts-and-fee) | Transaction pages | Automatically up to 25 spent transactions; above that, on request |
| [Transaction inclusion](#transaction-inclusion) | Transaction pages | Confirmed transactions |
| [Chain tip agreement](#chain-tip-agreement) | Home page; Providers page | Always |
| [Total work behind the tip](#total-work-behind-the-tip) | Home page | On request the first time, then automatically |
| [Not verified](#not-verified) | Addresses, mempool, fees | Never: shown as reported |

A failing check is red and names the check that failed. A check that
couldn't run, for example because no provider answered, is grey and is
**never** shown as a pass.

---

## Block proof of work

**Checks**

- The 80-byte block header hashes to the block id.
- That hash meets the difficulty *target* written in the header.
- The target is within mainnet's limits.
- The time, Merkle root and previous block shown on the page match the
  header.

**Doesn't prove** that the block is on the chain with the most work. A
valid but abandoned block would also pass. See
[total work](#total-work-behind-the-tip) and
[chain tip agreement](#chain-tip-agreement).

On its own it also doesn't prove that **much** work was done: a header
proves only the work its own difficulty demands. At the easiest mainnet
difficulty that is about 2³² hashes, seconds on ordinary hardware. That
is why the next check ties the difficulty to the block's height, and why
transaction and tip checks compare providers.

## Block difficulty

**Checks** that the block's difficulty is the one Bitcoin's rules require
at its height:

- Inside a 2,016-block *difficulty period*, every block has the same
  difficulty as the period's first block.
- At the start of a period, the difficulty is the *retarget* computed
  from the previous period's first and last headers. This uses the
  two-week target, the 4× limit in either direction and the network's
  minimum difficulty, with the same arithmetic as Bitcoin Core.
- Every header used passes the proof-of-work checks above, and the
  period's first block builds on the previous period's last block.

**Doesn't prove** anything beyond one retarget step: the next check
traces the rest. The blocks between the period's start and this block
aren't linked header by header.

## Difficulty history

**Checks** every retarget from the *genesis block* up to this block's
period:

- It starts from the genesis block's known hash and fixed difficulty.
- Each period's last block has that period's difficulty.
- Each period builds on the previous period's last block.
- Each new difficulty is the retarget computed from that period's
  timestamps.
- All headers used (about two per period) pass the proof-of-work checks.

On block pages it runs automatically once the headers are saved in your
browser. Otherwise a button offers it and shows how many headers it
needs. On the home page it runs together with the total-work check.

The **Charts** page draws difficulty, average block time and estimated
hashrate from exactly the headers this check has just verified, and only
when it passes. The hashrate is derived (difficulty × 2³² hashes per
block, divided by the average block time), not measured, and block times
are set by miners, so single periods are approximate.

**Doesn't prove** that blocks inside a period are linked one by one. That
would need every header ever mined: about 80 bytes for each block in the
chain.

## Block transactions

**Checks**

- The block's full list of transaction ids rebuilds the *Merkle root* in
  its header.
- No transaction is listed twice. Repeating the last ids of a list
  rebuilds the same Merkle root (CVE-2012-2459), so this is checked
  separately, as Bitcoin Core does.
- The number of transactions matches.
- The transactions on the current page are in that list, in that order.

**Doesn't prove** that the transactions themselves are valid (signatures,
scripts): that takes a full node. A block's transaction list can't be
hidden, added to or reordered without failing this check.

## Transaction contents

**Checks**

- The raw transaction hashes to its *txid*.
- The output amounts and scripts match what's shown.
- The spent outputs (inputs) match what's shown, every one of them.
- Whether it's a *coinbase transaction* comes from the raw bytes, by
  Bitcoin's rule (one input that spends no earlier output), not from the
  provider's label. A provider can't hide an input by calling it
  "coinbase".
- The weight, used for the fee rate, matches the raw transaction.

**Doesn't prove** the input amounts: those are covered by the next check.
The witness (signatures) isn't covered by the txid, so the weight check
only shows that the weight matches the bytes the provider sent.

## Input amounts and fee

**Checks**

- Each earlier transaction that this one spends from is downloaded raw
  and hashes to its own txid.
- The output that each input spends holds the amount and address shown.
  Each input gets its own ✓ or ✗.
- The inputs cover the outputs: the fee isn't negative.
- Fee = inputs − verified outputs, and it equals the fee shown.
- A coinbase is skipped only once the contents check has confirmed it
  from the raw transaction.

It runs automatically when there are up to 25 earlier transactions to
download. Above that, a button starts it.

**Doesn't prove** that the spent outputs were still unspent. That needs
the full *UTXO set*, which only full nodes keep.

## Transaction inclusion

**Checks**

- A Merkle proof leads from the txid to a block header, without pairing
  a hash with a copy of itself on the wrong side (a leaf that isn't
  there).
- That header passes the [proof-of-work checks](#block-proof-of-work).
- The proof is for the block shown.
- Every provider has that block at that height. Each is asked
  separately. A provider with a different block there makes the check
  **fail**. If no second provider can confirm it yet, for example
  because the block is seconds old, the check is grey.

The last point matters because a block's own proof of work can be cheap
(see [block proof of work](#block-proof-of-work)): one provider could
invent a block holding an invented payment. It can't make independent
providers report that block.

**Doesn't prove:** the same limits as the block check. With only one
provider (for example your own node, used exclusively) its word decides
which block is at that height. Unconfirmed transactions show "nothing to
prove" until they are in a block.

## Chain tip agreement

**Checks**

- Every provider is asked for its newest block (the *chain tip*)
  separately.
- Each tip's header passes the proof-of-work checks: it hashes to the
  tip the provider named, meets its own target, and that target is within
  mainnet limits.
- The tips are compared. The check tells "one block behind on the same
  chain" apart from "a different chain".
- A provider that is ahead must have built on the others' tips with the
  difficulty Bitcoin requires next. One block ahead, its own header must
  point to the other tip. Within a difficulty period it must have the
  same difficulty. At the start of a new one it must have the
  [retarget](#block-difficulty) computed from the other provider's
  headers. A tip that is ahead with any other difficulty was mined at a
  made-up difficulty, which can be cheap, and **fails** like a fake
  header.
- When the newer blocks can't be checked this way (more than one block
  ahead across a difficulty change), the check is grey ("can't be checked
  yet"), never a pass.

A provider whose tip header fails, or isn't a header at all, has sent
data that isn't a real block. The check then **fails** (red ✗), naming
that provider, even if every other provider agrees. It is never counted
as a provider that couldn't be reached: those make the check grey, as
they prove nothing either way.

A provider that fails is then **left out of lookups**: Assay can't check
balances, the mempool or fees, so it stops asking a provider that has
sent a fake block. It is used again when its tip passes this check, after
24 hours, or when you click **Use it again** on the Providers page. It is
still asked for its tip meanwhile, so the check can clear it.

**Doesn't prove** anything with a single provider: there is nothing to
compare.

## Total work behind the tip

**Checks**

- Adds up the chain's total proof of work exactly, from one
  proof-of-work-checked header per difficulty period, starting at the
  genesis block.
- Every period's difficulty is the one the
  [difficulty history](#difficulty-history) traced back to the genesis
  block. A header's own proof of work can't vouch for its period's
  difficulty: it can be cheap.
- The tip's difficulty matches its period's first block.
- The result is shown in the same hexadecimal form as Bitcoin Core's
  `chainwork`, so you can compare it with your own node
  (`bitcoin-cli getblockchaininfo`).

The first run downloads about two headers per difficulty period (80
bytes each) for this check and the difficulty history together. The
button shows the exact number. After that, the headers are saved and
only new ones are fetched.

**Doesn't prove** that every block in a period really has its first
header's difficulty. Mainnet's rules require it, but this check doesn't
link every header to the next.

## Not verified

These come straight from the data provider. Each panel says so with a
grey **Not verified** note.

| Data | Why it can't be checked in a browser |
|---|---|
| Address balance and history | Needs the full set of unspent outputs (UTXO set), which only full nodes keep. |
| Mempool size and fees, fee histogram | Every node keeps its own mempool. There is no single right answer to check. |
| Fee estimates | A prediction, not a fact. |
| Recent-blocks list on the home page | The list itself isn't checked. Open a block to check it. |
| Mempool chart | Built from the provider's mempool numbers. |

To avoid trusting a public provider for these, point Assay at
[your own node](user-guide.md#5-use-your-own-node).
