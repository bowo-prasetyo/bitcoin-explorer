# Assay user guide

Assay is a Bitcoin explorer: you can look up blocks, transactions and
addresses. Unlike most explorers, your browser **checks** much of what it
shows instead of simply trusting the server that sent it. This guide
explains how to use it and how to read what it tells you.

You don't need to install anything or run a Bitcoin node. Open the
[live site](https://bowo-prasetyo.github.io/bitcoin-explorer/) in any
modern browser. Assay shows **Bitcoin mainnet** only, not testnet.

Words in *italics* on first use are explained in the [glossary](glossary.md).

**Contents**

1. [A quick tour](#1-a-quick-tour)
2. [Search](#2-search)
3. [Reading the verification badges](#3-reading-the-verification-badges)
4. [Common tasks](#4-common-tasks)
5. [Use your own node](#5-use-your-own-node)
6. [How fresh is the data?](#6-how-fresh-is-the-data)
7. [Privacy: who sees your lookups](#7-privacy-who-sees-your-lookups)
8. [Data stored in your browser](#8-data-stored-in-your-browser)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. A quick tour

The header is the same on every page:

| Item | What it does |
|---|---|
| **Assay** logo | Back to the home page. |
| **Search box** | On every page except home, which has its own larger one. See [Search](#2-search). |
| **Charts** | Bitcoin's difficulty, block times and estimated hashrate since 2009, checked by your browser; and how many transactions are waiting right now. See [task 4.7](#47-see-bitcoins-history). |
| **Providers** | Which servers Assay asks for data, whether they agree, and where to add your own node. |
| **Help** | Opens this guide. |
| **● Live** / **Polling** | How Assay learns about new blocks. See [Live and polling](#live-and-polling). |

The footer links to the **Glossary**, this guide, [What your browser
verifies](verification.md) and the source code.

The home page has these cards. On a wide screen they sit side by side,
two to a row; on a phone, one below the other:

| Card | What it shows |
|---|---|
| **Search** | Look up a block, transaction or address. **Try:** links open the very first block, its transaction and Satoshi Nakamoto's address. |
| **Chain tip** | The newest block, and a badge saying whether the data providers agree on it. If the check fails or can't run, **Check again** asks them all once more. |
| **Work behind the tip** | An optional check of all the work behind the chain. See [task 4.4](#44-check-the-whole-chain). |
| **Recent blocks** | The latest blocks. Click a height to open the block. |
| **Mempool** | Transactions waiting to be confirmed, and their total size and fees. |
| **Fee estimates** | The fee rate likely to get a transaction confirmed within a given number of blocks. |
| **Fee histogram** | How much is waiting at each fee rate, in MvB. Each bar is a range, for example *5–10* sat/vB; *50+* has no upper limit. **Show as a table** lists every range. |

Every page has its own browser tab title, such as *Block 840,000 · Assay*,
so open tabs and your history are easy to tell apart.

Times are shown in UTC, for example *2009-01-03 18:15 UTC*. When your own
time zone differs, the time there is shown underneath, followed by *your
time*.

On a phone, wide tables (a block's transactions, an address's history,
the providers) show each row as a small card, so no column is cut off.

## 2. Search

Type into the search box and press **Enter** (or click **Search**). It's
on the home page and at the top of every other page. Press **Esc** to
clear it. You can enter:

| You type | Example | Assay opens |
|---|---|---|
| A block height (a number) | `840000` | That block |
| A block hash (64 hex characters) | `000000000019d6…` | That block |
| A transaction id (64 hex characters) | `4a5e1e4baab8…` | That transaction |
| A mainnet address | `1A1zP1…`, `bc1q…`, `bc1p…` | That address |
| A payment link from a wallet or QR code | `bitcoin:bc1q…?amount=0.1` | The address in it |

Assay checks what you typed **before** sending anything, and tells you
what is wrong instead of failing silently:

| Message | What it means |
|---|---|
| *That looks like a testnet address.* | Assay only shows mainnet. Use a testnet explorer instead. |
| *Block hashes and transaction ids are 64 hex characters; this one has N.* | A character is missing or extra. Copy it again. |
| *N is too large to be a block height.* | Heights are much smaller numbers. |
| *There is no block at height N yet.* | That block hasn't been mined yet. |
| *Not a block height, block hash, transaction id or Bitcoin address.* | Check for typos. A `bc1` address must be all lower case or all upper case, not mixed. |
| *That bitcoin: link has no valid address in it.* | Some links carry only a Lightning invoice, or a damaged address. Copy the address on its own. |

A link to a page that doesn't exist, for example one that was cut short
when it was copied, shows **Page not found**. Use the search box from
there.

### Copying

Next to each block hash, transaction id and address at the top of its
page is a **Copy** button. It changes to *Copied* for a moment.

### Unfamiliar words

Labels with a dotted underline, such as **Confirmations**, **Size** or
**Fee rate**, explain themselves: tap or click one to see what it
means. **All terms** opens the full glossary inside Assay. Press **Esc**
or tap elsewhere to close the explanation.

## 3. Reading the verification badges

Block and transaction pages show **badges**. Each badge is the result of
one check that your browser ran itself, using raw data and cryptography.

### The summary line

A **summary line** in bold, at the top of each block and transaction
page, sums up every badge on the page so you don't have to read them all:

| Summary | Meaning |
|---|---|
| ✓ *All 3 checks passed in your browser* | Every check passed. |
| ✗ *1 of 3 checks FAILED: this data doesn't add up.* | At least one check failed. Read the red badge below it. |
| ! *2 of 3 checks passed · 1 couldn't run* | Some checks couldn't run. That isn't a pass, and it isn't a failure. |
| – *… · 1 waiting for you to start it* | A check that downloads a lot waits for your click, for example **Trace back to the genesis block**. |
| … *Checking in your browser… (1 of 3 done)* | Checks are still running. |

Checks that don't apply, such as spent amounts on a *coinbase
transaction*, are listed as *not applicable* and don't count. Screen
readers announce the summary once the checks finish, rather than each
badge.

### Each badge

| Badge | Colour | Meaning |
|---|---|---|
| **✓** | Green | **Verified.** Every part of the check passed. |
| **✗** | Red | **Failed.** The data doesn't add up. The title says which check failed. Treat this data with suspicion. |
| **!** | Grey | **Couldn't check.** For example, no provider answered. This is never a pass, and it doesn't mean the data is wrong. |
| **–** | Grey | **Nothing to check.** For example, a transaction that isn't in a block yet can't have an inclusion proof. |
| **…** | Grey | **Checking.** The check is still running. |

Click **What was checked** under a badge to see each individual check
(with its own ✓ or ✗), the numbers involved, and a short note on what the
check does **not** prove.

### "Not verified" notes

Some information can't be checked in a browser. Those panels carry a grey
note with a dashed border that starts with **Not verified**. This
includes:

- address balances and history,
- the mempool and fee estimates,
- the recent-blocks list (open a block to check it).

The note means the numbers are exactly what the data provider reported.

### What a green ✓ does not mean

A ✓ proves that the data is internally consistent and backed by real
*proof of work*. It does **not** prove everything. For example, Assay
can't prove that a block is on the chain with the most work, or that an
address's coins are still unspent. The full list is in
[What your browser verifies](verification.md).

## 4. Common tasks

### 4.1 Check that a payment was confirmed

1. Search for the **transaction id**. Your wallet usually calls it
   "transaction ID", "txid" or "hash".
2. Look at **Status**:
   - *in block 870,123* means it is confirmed. The block number is a link.
   - *waiting in the mempool* means it is not confirmed yet. The page
     updates by itself when it confirms.
3. Read **Confirmations**: how many blocks have been mined since, counting
   its own block. Many people wait for 6. The count goes up by itself
   while the page is open.
4. Check the **Transaction inclusion** badge. A green ✓ ("Inclusion in
   block N verified") means your browser proved that this exact
   transaction is inside that block, that the block has valid proof of
   work, and that every data provider has that block at that height. If
   only one provider could confirm the block so far, the badge is grey:
   wait a minute and reload.
5. Check the **Confirmations** badge under it. A green ✓ ("6 confirmations
   verified") means your browser linked every block on top, header by
   header, up to the newest block the providers agree on, so the count
   isn't just the provider's word. It is checked again with every new
   block while the page is open. For older transactions it checks the
   first 144 and says "at least 144".

### 4.2 Check a transaction's amounts and fee

On a transaction page:

- The **transaction contents** badge proves that the raw transaction
  matches its id, and that the outputs and inputs shown are really in it.
- The **input amounts** badge downloads each earlier transaction that
  this one spends from. It then checks each input's amount and address
  and recalculates the fee. Each input gets its own ✓ or ✗. Hover over a
  mark to see why.
- For transactions that spend from more than **25** earlier transactions,
  this check doesn't start by itself. Click **Check all inputs (N
  downloads)** to run it.
- The **witness data** badge downloads the transaction's block and checks
  that the block commits to its signatures (BIP141), so the size, weight
  and fee rate shown are proved, not just reported. For blocks over
  500 kB it waits: click **Check witness data** (the button shows the
  download size).

### 4.3 Check a block

On a block page:

- **Proof of work.** The header is real, it carries the work its
  difficulty demands, and the details shown match it.
- **Difficulty.** The block's difficulty follows Bitcoin's rules for its
  height, so the proof of work above was as hard as Bitcoin requires. If the earlier headers are already saved in your browser, the
  difficulty is also traced all the way back to the first block. If not,
  click **Trace back to the genesis block (N headers)**.
- **Height.** From block 227,931 on, the block's height is the one the
  block itself records in its first transaction, so it can't be shown
  under the wrong number.
- **Transaction list.** Shown above each page of 25 transactions. It
  proves that the complete list matches the block header, so no
  transaction is missing, added or out of order.

Use **‹ Block N** and **Block N ›** to step through neighbouring blocks.
Use **« First**, **‹ Previous**, **Next ›** and **Last »** to page
through the transactions.

### 4.4 Check the whole chain

The **Work behind the tip** card on the home page adds up all the proof
of work behind the newest block.

1. Click **Add up the total work**. The card shows how many headers this
   downloads (about 80 bytes each, one or two per two weeks of history).
2. Wait for the progress bar. Next time only new headers are downloaded,
   and the check runs by itself.
3. Two badges appear:
   - **Total work behind block N** gives the work in hashes, how long all
     miners would take to redo it, and a `chainwork` value.
   - **Difficulty traced back to the genesis block** says every
     difficulty change since 2009 followed the rules.

If you run Bitcoin Core, compare the `chainwork` value with the output of
`bitcoin-cli getblockchaininfo`. They should be identical for the same
block.

### 4.5 Check that the data providers agree

Assay asks more than one *provider* for the newest block. The **Chain
tip** card on the home page and **Do they agree?** on the **Providers**
page show the result:

| Title | Meaning |
|---|---|
| *All N providers agree on the tip* | Everyone reports the same newest block. |
| *Providers agree; one is catching up* | One is a block or so behind on the same chain. This is normal. |
| *A provider is ahead, but its newest block can't be checked yet* | One is more than a block ahead across a difficulty change, so its newest block can't be checked against the others yet. Usually clears with the next block. |
| *Providers DISAGREE on the chain* | They report different chains. Be careful until this clears. |
| *mempool.space sent an invalid chain tip* (or *N providers sent invalid chain tips*) | That provider named a newest block whose header fails proof of work, or that is ahead of the others with a difficulty Bitcoin doesn't allow there: it is broken, or showing you a fake chain. Assay stops using it for lookups (see below). |

**A provider that sends an invalid tip is not used for lookups.** The
**Providers** page marks it *not used*, with the reason. Your lookups go
to the other providers instead. Balances, the mempool and fees can't be
checked, so Assay doesn't ask a provider that has already sent a fake
block. It is used again:

- as soon as its tip passes the check, which runs on the home page with
  every new block and on the **Providers** page (**Check again**);
- after 24 hours at most, even if the check hasn't run since;
- or when you click **Use it again** next to it. If its tip is still
  invalid, the next check leaves it out again.

If every provider is left out, for example your own node set as the
only endpoint, pages say *Every data provider sent an invalid chain tip,
so Assay has stopped asking them* instead of loading anything.
| *Only one provider configured / answered: nothing to compare* | There is nothing to compare. This is expected if you use only your own node. |

### 4.6 Look up an address

Search for the address. You see its balance, pending changes from
unconfirmed transactions, totals received and sent, and its history with
each transaction's effect on the balance (`+` received, `−` sent). Click
**Load older transactions** to go further back.

Address data is **not verified**. Proving a balance needs a full list of
every unspent coin, which only a full node has. To avoid trusting a
public provider, [use your own node](#5-use-your-own-node).

### 4.7 See Bitcoin's history

Click **Charts** in the header. **Bitcoin since 2009** draws three charts,
one point per *difficulty period* (2,016 blocks, about two weeks):

| Chart | What it shows |
|---|---|
| **Difficulty** | How much harder than the first blocks it is to find a block. Log scale: each line up is ten times harder. |
| **Average time between blocks** | Per period, against Bitcoin's 10-minute target (dashed line). Faster periods are followed by a higher difficulty, and slower ones by a lower one. |
| **Estimated hashrate** | The computing power the difficulty and pace imply. An estimate: miners set block times, which can be off by up to about two hours. |

Everything comes from the first and last block header of each period,
the same headers as the difficulty check in [task 4.4](#44-check-the-whole-chain).
Your browser checks them all first: the charts appear only under a green
✓ *Difficulty traced back to the genesis block*. If that check fails,
no charts are drawn.

The first time, click **Download and check N headers** (about 75 KB).
If you have already used **Add up the total work**, the headers are
saved and the charts appear straight away. After that, only new headers
are downloaded.

**Show as a table** lists every period with a link to its first block,
and **Download as CSV** saves the numbers.

Below, **Mempool transaction count** is recorded by your browser while
the page is open. It isn't history: Assay can't check past mempool
contents, so it doesn't show a provider's.

### 4.8 Install Assay and use it offline

Assay can be installed like an app, with its own icon and window, and it
opens without a connection.

**Install it**

- **Chrome, Edge and other Chromium browsers** (computer or Android):
  click **Install app** at the bottom of any page, or use the install
  icon in the address bar.
- **Safari on iPhone or iPad:** tap **Share**, then **Add to Home Screen**.
- **Safari on a Mac:** **File**, then **Add to Dock**.
- **Firefox** on a computer can't install sites as apps. Assay still
  works offline in a normal tab.

**Offline**

After one visit with a connection, Assay opens with none. An amber bar
says *You're offline*, and:

- pages you opened in the last 7 days show what was saved, with its age,
  for example *You're offline. Showing what was saved 2 h ago*;
- a page you never opened says it loads by itself once you're back
  online;
- transactions and addresses you opened before still open from search,
  but looking up a block by height or hash needs a connection;
- the glossary works fully; checks that need new data can't run, and
  their badges show **!**.

When the connection returns, the bar disappears and every panel
refreshes by itself.

Online, Assay always loads its newest version; the saved copy is only
used when there's no connection.

## 5. Use your own node

You can point Assay at an *Esplora* API that you run or trust. Common
choices are [electrs](https://github.com/Blockstream/electrs) or a
self-hosted mempool backend. Your lookups then go to your own server.

**Before you start**, your endpoint must:

- **answer from the browser.** It must send the
  `Access-Control-Allow-Origin` (*CORS*) header.
- **use `https://`.** Browsers block plain `http://` from the live site.
  The only exceptions are `localhost` and `.onion` addresses opened in
  Tor Browser.
- **be the API path itself**, which often ends in `/api`, for example
  `https://node.example.org/api`.

**Steps**

1. Click **Providers** in the header.
2. In **Use your own endpoint**, enter the URL.
3. Optional: tick **Use only my endpoint** so that no lookup is sent to
   Blockstream or mempool.space.
4. Click **Test**. On success you see *Works: it reports block N in X ms*.
5. Click **Save**.

Without "only my endpoint", your node is tried first and the public
providers are the fallback. To undo, click **Stop using my endpoint**.

**If the test fails:**

| Message | Fix |
|---|---|
| *Enter a full URL, e.g. https://my-node.example/api* | Include `https://` and the host name. |
| *The endpoint must start with https:// or http://* | Other schemes aren't supported. |
| *Don't put credentials in the URL.* | Remove `user:password@`. |
| *Remove the ?query or #fragment from the URL.* | Use only the base path. |
| *It answered HTTP N. Is this the Esplora API path…?* | The server is reachable, but the path is wrong. Try adding `/api`. |
| *It answered, but not with a block height.* | This isn't an Esplora API. |
| *No answer within 8 seconds.* | The server is down or very slow. |
| *Couldn't connect…* | Most often missing CORS headers, or `http://` blocked by the browser. Your browser's developer console shows which. |

## 6. How fresh is the data?

Every panel says how current its data is:

| You see | Meaning |
|---|---|
| *Loading…* | First load, nothing saved yet. |
| *Updated 2 min ago* | Fresh from a provider. Hover for the exact time. |
| *Updated 2 min ago (cached) · refreshing…* | Saved data shown instantly while a fresh copy loads. |
| Amber: *Couldn't refresh. Showing data from 5 min ago.* | No provider answered, so you see the last saved copy. |
| Red: *Couldn't reach any Bitcoin data provider. Retrying automatically.* | No provider answered and nothing is saved. |
| Red: *This transaction was not found.* | The providers answered: it doesn't exist (or they haven't seen it yet). |

Pages refresh by themselves: about every 10 seconds while you're using
the page, and every 30 seconds when idle. Refreshing pauses while the tab
is in the background, and stops once there's nothing left to change, for
example after a transaction confirms. While **● Live** is on, new blocks
are announced instead, so the newest block and pending transactions are
only re-checked every 5 minutes as a safety net.

### Live and polling

The indicator in the header shows how Assay learns about new blocks:

- **● Live**: a connection to mempool.space (or to your own endpoint)
  announces each new block the moment it is found. Assay then fetches and
  checks the block the usual way. The announcement is only a hint.
- **Connecting…**: opening that connection.
- **Polling**: Assay asks for new blocks regularly instead. This happens
  when live updates are turned off, unavailable, or not needed by the
  current page.

Hover over the indicator for details, or click it to open the **Providers**
page. There you can turn live updates on or off, and see how many
requests were made this session.

## 7. Privacy: who sees your lookups

Assay has no server of its own. Your browser talks directly to the data
providers, which means **they can see what you look up**.

| Who | What they receive |
|---|---|
| The best-ranked provider (Blockstream or mempool.space by default) | Every lookup: addresses, transactions, blocks. |
| The next provider | Your lookup, if the first one fails. |
| Every provider | Requests for the newest block only, to compare them. |
| mempool.space live connection | Only "new block" notices. Never your lookups. |
| The site host (GitHub Pages) and the CDNs (unpkg, jsDelivr) | Ordinary page loads, as for any website. |

To keep lookups private, [use your own node](#5-use-your-own-node) with
**Use only my endpoint** ticked. Then lookups and the live connection go
only to your server.

Offline support saves only Assay's own files and its three libraries.
It never saves or forwards your lookups.

## 8. Data stored in your browser

Assay saves a few things in your browser so that pages load instantly
and work offline. Nothing is sent anywhere.

| What | Kept for |
|---|---|
| Recently viewed data (blocks, transactions, addresses, mempool) | Up to 7 days, at most 500 entries |
| Block headers used by the difficulty and total-work checks and the history charts (about 80 bytes each) | Until you clear them |
| The last 50 mempool-chart samples | Until pruned with the rest of the cache |
| Your endpoint, live updates on/off, total-work opt-in, the last provider that worked | Until you change or clear them |
| Providers left out of lookups for sending an invalid chain tip, with the reason | Until a tip check passes, or 24 hours |
| Assay's own files and the three libraries it uses (about 650 KB), so it opens offline | Replaced by newer copies whenever you're online |

To erase everything, clear the site data for the Assay site in your
browser's settings. This is usually under *Privacy*, then *Cookies and
site data*. Your settings return to their defaults.

## 9. Troubleshooting

**Every panel says it couldn't reach a provider.**
Check your internet connection. If you use your own endpoint
exclusively, check that your node is running. A browser extension that
blocks requests can also cause this.

**A badge shows `!` (couldn't check).**
A provider didn't return the raw data needed. Reload the page later. A
grey `!` is not a failure.

**A badge shows a red ✗.**
The data a provider sent doesn't match its own cryptographic proofs.
Open **What was checked** to see which check failed. Then compare with
another provider, or with your own node. Please
[open an issue](https://github.com/bowo-prasetyo/bitcoin-explorer/issues)
with the link to the page.

**Pages say "Every data provider sent an invalid chain tip".**
Every provider was caught sending a block that fails proof of work, so
Assay won't show what they send. If you use your own node, check that
it runs Bitcoin **mainnet**: a testnet, signet or regtest node fails
this check. Then open **Providers** and click **Check again**.

**There's no "Install app" button.**
Only Chromium-based browsers (Chrome, Edge, Brave, Samsung Internet)
offer it, and only while Assay isn't already installed. In Safari, use
**Add to Home Screen** or **Add to Dock**; see [task 4.8](#48-install-assay-and-use-it-offline).
Opening Assay from a plain `http://` address (other than `localhost`)
disables installing and offline use.

**The indicator stays on "Polling".**
This is expected with Blockstream or electrs endpoints, which don't offer
live connections, and when live updates are off on the **Providers**
page. Data still updates. It just takes a few seconds longer to notice a
new block.

**The chart has gaps.**
The chart only records while its page is open. A gap means the page was
closed, not that nothing happened.

**The page says "Assay failed to start", or stays blank.**
"Assay failed to start" means the browser wouldn't let Assay open its
local storage, which some private modes block. A blank page usually
means a script couldn't load, for example because an extension or
network filter blocks unpkg.com or cdn.jsdelivr.net. Try a normal
window, another browser, or another network.
