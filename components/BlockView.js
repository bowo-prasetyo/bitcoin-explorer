import {
  getBlock,
  getBlockHash,
  getBlockTxs,
  getTipHeight,
  BLOCK_TXS_PAGE_SIZE
} from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import {
  formatAgo,
  formatBtc,
  formatFeeRate,
  formatNumber,
  formatTime,
  formatLocalTime,
  sumValues
} from '../format.js';

import { now } from './DataStatus.js';
import { blockTitle } from '../titles.js';

import {
  verifyBlockDifficulty,
  verifyBlockHeight,
  BIP34_HEIGHT,
  verifyDifficultyHistory,
  historyHeaderCount,
  verifyBlockHeader,
  verifyBlockTransactions
} from '../verify.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <nav class="pager" v-if="block" aria-label="Neighbouring blocks">
        <router-link v-if="block.previousblockhash" :to="'/block/' + block.previousblockhash">
          ‹ Block {{ formatNumber(block.height - 1) }}
        </router-link>
        <span v-else class="muted">Genesis block</span>

        <router-link v-if="nextHash" :to="'/block/' + nextHash">
          Block {{ formatNumber(block.height + 1) }} ›
        </router-link>
        <span v-else-if="tipHeight !== null" class="muted">Chain tip</span>
      </nav>

      <h2>Block <span v-if="block">{{ formatNumber(block.height) }}</span></h2>

      <div class="hash-row">
        <span class="hash">{{ hash }}</span>
        <copy-button :text="hash" what="block hash"></copy-button>
      </div>

      <data-status :status="status" what="block"></data-status>

      <verify-summary v-if="block" :results="summaryResults"></verify-summary>

      <dl v-if="block" class="facts">
        <dt>Mined</dt>
        <dd>
          {{ formatTime(block.timestamp) }} <span class="muted">({{ ago(block.timestamp) }})</span>
          <span v-if="formatLocalTime(block.timestamp)" class="local-time muted small">{{ formatLocalTime(block.timestamp) }} your time</span>
        </dd>

        <dt><glossary-term term="confirmations">Confirmations</glossary-term></dt>
        <dd>{{ confirmations === null ? '…' : formatNumber(confirmations) }}</dd>

        <dt>Transactions</dt>
        <dd>{{ formatNumber(block.tx_count) }}</dd>

        <dt>Size</dt>
        <dd>{{ formatNumber(block.size) }} bytes</dd>

        <dt><glossary-term term="vb-wu">Weight</glossary-term></dt>
        <dd>{{ formatNumber(block.weight) }} WU</dd>
      </dl>

      <verify-badge v-if="block" :result="headerCheck"></verify-badge>
      <verify-badge v-if="block" :result="difficultyCheck">
        <template v-if="historyOffer && !historyRunning">
          <button class="verify-action" @click="traceHistory">
            Trace back to the genesis block ({{ formatNumber(historyOffer) }} headers)
          </button>
        </template>
        <div v-if="historyRunning" class="muted small" style="margin-top:8px">
          Tracing the difficulty history… {{ formatNumber(historyProgress.done) }} / {{ formatNumber(historyProgress.total) }}
          <progress :value="historyProgress.done" :max="historyProgress.total"></progress>
        </div>
      </verify-badge>
      <verify-badge v-if="block && historyCheck" :result="historyCheck"></verify-badge>
      <verify-badge v-if="recordsHeight" :result="heightCheck"></verify-badge>

    </div>

    <div class="card" v-if="block">

      <h3>
        Transactions
        <span class="muted small" v-if="block.tx_count">
          {{ formatNumber(firstIndex + 1) }}–{{ formatNumber(lastIndex) }}
          of {{ formatNumber(block.tx_count) }}
        </span>
      </h3>

      <data-status :status="txsStatus" what="page of transactions"></data-status>

      <verify-badge v-if="txs.length" :result="txListCheck"></verify-badge>

      <div v-if="txs.length" class="table-scroll">
        <table class="stack-sm">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Transaction</th>
              <th class="num">Output total</th>
              <th class="num">Fee rate</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(tx, i) in txs" :key="tx.txid">
              <td class="num muted" data-label="#">{{ formatNumber(firstIndex + i + 1) }}</td>
              <td class="hash full">
                <router-link :to="'/tx/' + tx.txid">{{ tx.txid }}</router-link>
              </td>
              <td class="num" data-label="Output total">{{ formatBtc(sumValues(tx.vout)) }}</td>
              <td class="num" data-label="Fee rate">
                <span v-if="tx.vin?.[0]?.is_coinbase" class="tag">coinbase</span>
                <span v-else>{{ formatFeeRate(tx.fee, tx.weight) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="!txsStatus.loading && !txsStatus.error" class="empty">
        No transactions on this page.
      </div>

      <nav class="pager" v-if="pageCount > 1" aria-label="Transaction pages">
        <span>
          <router-link v-if="page > 1" :to="pageLink(1)">« First</router-link>
          <router-link v-if="page > 1" :to="pageLink(page - 1)">‹ Previous</router-link>
        </span>
        <span class="muted">Page {{ formatNumber(page) }} of {{ formatNumber(pageCount) }}</span>
        <span>
          <router-link v-if="page < pageCount" :to="pageLink(page + 1)">Next ›</router-link>
          <router-link v-if="page < pageCount" :to="pageLink(pageCount)">Last »</router-link>
        </span>
      </nav>

    </div>

  </div>
  `,

  data() {
    return {
      hash: '',
      page: 1,
      block: null,
      tipHeight: null,
      nextHash: null,
      txs: [],
      status: createStatus(),
      txsStatus: createStatus(),

      headerCheck: null,
      difficultyCheck: null,
      heightCheck: null,
      historyCheck: null,
      historyOffer: 0,
      historyRunning: false,
      historyProgress: { done: 0, total: 0 },
      txListCheck: null,
      txListStarted: false,
      verifiedBlockId: null
    };
  },

  computed: {
    // Blocks since BIP34 write their height into their coinbase.
    recordsHeight() {
      return !!this.block && this.block.height >= BIP34_HEIGHT;
    },

    // Every check on the page, for <verify-summary>. The transaction list
    // is checked in the second card, once its page of transactions loads.
    summaryResults() {
      const results = [this.headerCheck, this.difficultyCheck];

      if (this.historyCheck) {
        results.push(this.historyCheck);
      } else if (this.historyRunning) {
        results.push(null);
      } else if (this.historyOffer) {
        results.push({ state: 'na', needsConfirm: true });
      }

      // Blocks before BIP34 don't record their height: no badge.
      if (this.recordsHeight) {
        results.push(this.heightCheck);
      }

      const txsFailed = !this.txs.length && !!this.txsStatus.error;
      results.push(this.txListCheck ?? (txsFailed ? { state: 'error' } : null));

      return results;
    },

    // Derived from cached data too, so it's right on a cache-first render.
    confirmations() {
      if (!this.block || this.tipHeight === null) {
        return null;
      }
      return this.tipHeight - this.block.height + 1;
    },

    pageCount() {
      return this.block
        ? Math.max(1, Math.ceil(this.block.tx_count / BLOCK_TXS_PAGE_SIZE))
        : 1;
    },

    firstIndex() {
      return (this.page - 1) * BLOCK_TXS_PAGE_SIZE;
    },

    lastIndex() {
      return Math.min(
        this.firstIndex + BLOCK_TXS_PAGE_SIZE,
        this.block?.tx_count ?? 0
      );
    }
  },

  methods: {
    formatBtc,
    formatFeeRate,
    formatNumber,
    formatTime,
    formatLocalTime,
    sumValues,

    ago(unixSeconds) {
      return formatAgo(unixSeconds * 1000, now.value);
    },

    pageLink(page) {
      return page === 1
        ? '/block/' + this.hash
        : { path: '/block/' + this.hash, query: { page } };
    },

    async loadBlockData() {
      const [block, tipHeight] = await Promise.all([
        getBlock(this.hash),
        getTipHeight()
      ]);

      // A missing "next block" link shouldn't hide the block itself.
      const nextHash = tipHeight > block.height
        ? await getBlockHash(block.height + 1).catch(() => null)
        : null;

      return { block, tipHeight, nextHash };
    },

    loadTxPage() {
      return getBlockTxs(this.hash, this.firstIndex);
    },

    // Verify each block once per view, from whichever data arrives first.
    async verifyHeader() {
      if (!this.block || this.verifiedBlockId === this.block.id) {
        return;
      }

      this.verifiedBlockId = this.block.id;
      this.headerCheck = null;
      this.difficultyCheck = null;
      this.heightCheck = null;
      this.headerCheck = await verifyBlockHeader(this.block);
      this.verifyTxList();

      verifyBlockHeight(this.block, this.headerCheck.header).then(r => {
        if (this.verifiedBlockId === this.block?.id) this.heightCheck = r;
      });

      this.difficultyCheck = await verifyBlockDifficulty(
        this.block,
        this.headerCheck.header,
        this.tipHeight
      );

      this.offerHistory();
    },

    // Once one retarget step checks out, trace the rest back to genesis:
    // automatically if every header is already in the local store, else
    // offer it with its cost.
    async offerHistory() {
      if (this.difficultyCheck?.state !== 'ok' || this.block.height < 2 * 2016) {
        return;
      }

      const cached = await verifyDifficultyHistory(this.block.height, {
        tipHeight: this.tipHeight,
        cachedOnly: true
      });

      if (cached) {
        this.historyCheck = cached;
      } else {
        this.historyOffer = historyHeaderCount(this.block.height);
      }
    },

    async traceHistory() {
      this.historyRunning = true;
      this.historyProgress = { done: 0, total: this.historyOffer };

      this.historyCheck = await verifyDifficultyHistory(this.block.height, {
        tipHeight: this.tipHeight,
        onProgress: (done, total) => { this.historyProgress = { done, total }; }
      });

      this.historyRunning = false;
      this.historyOffer = 0;
    },

    async verifyTxList() {
      if (!this.headerCheck || !this.txs.length || this.txListStarted) {
        return;
      }

      this.txListStarted = true;

      if (!this.headerCheck.merkleRoot) {
        this.txListCheck = {
          state: 'error',
          title: 'Needs a checked block header first',
          checks: []
        };
        return;
      }

      this.txListCheck = await verifyBlockTransactions(
        this.block,
        this.headerCheck.merkleRoot,
        this.txs,
        this.firstIndex
      );
    }
  },

  mounted() {
    this.hash = this.$route.params.hash;

    const requested = parseInt(this.$route.query.page, 10);
    this.page = Number.isFinite(requested) && requested > 0 ? requested : 1;

    this.refreshers = [

      createSmartRefresher({
        cacheKey: 'block-' + this.hash,
        live: 'refresh',

        cacheTTL: data =>
          data?.tipHeight - data?.block?.height >= 6
            ? CACHE_TTL.blockDeep
            : CACHE_TTL.block,

        fetchFn: this.loadBlockData,
        status: this.status,

        onUpdate: data => {
          this.block = data.block;
          this.tipHeight = data.tipHeight ?? null;
          this.nextHash = data.nextHash ?? null;
          document.title = blockTitle(data.block.height);
          this.verifyHeader();
        },

        // Once a successor exists and the block is a few deep, the only
        // thing left changing is the confirmation count.
        shouldStop: () =>
          this.nextHash !== null &&
          this.confirmations !== null &&
          this.confirmations >= 3
      }),

      createSmartRefresher({
        cacheKey: `block-txs-${this.hash}-${this.firstIndex}`,
        cacheTTL: CACHE_TTL.blockTxs,
        fetchFn: this.loadTxPage,
        status: this.txsStatus,
        poll: false,
        onUpdate: data => {
          this.txs = data;
          this.verifyTxList();
        }
      })
    ];

    this.refreshers.forEach(r => r.start());
  },

  unmounted() {
    (this.refreshers || []).forEach(r => r.stop());
  }
};
