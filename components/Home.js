import {
  ApiError,
  getTipHeight,
  getBlockHash,
  getBlock,
  getMempool,
  getRecentBlocks,
  getFeeEstimates,
  tryGetBlock
} from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import { classifyQuery } from '../search.js';

import {
  formatAgo,
  formatBtc,
  formatNumber,
  formatTime,
  formatVsize
} from '../format.js';

import { now } from './DataStatus.js';

import {
  verifyTip,
  verifyChainWork,
  verifyDifficultyHistory,
  historyHeaderCount,
  chainWorkHeaderCount
} from '../verify.js';

const CHAINWORK_KEY = 'btc_explorer_chainwork';

function readFlag() {
  try { return localStorage.getItem(CHAINWORK_KEY) === '1'; } catch { return false; }
}

function writeFlag() {
  try { localStorage.setItem(CHAINWORK_KEY, '1'); } catch { /* ignore */ }
}

// Confirmation targets worth showing, out of the ~28 Esplora returns.
const FEE_TARGETS = [1, 3, 6, 12, 24, 144, 504, 1008];

function etaLabel(blocks) {
  const minutes = blocks * 10;
  if (minutes < 60) return `~${minutes} min`;
  if (minutes < 24 * 60) return `~${Math.round(minutes / 60)} h`;
  const days = minutes / (24 * 60);
  if (days === 1) return '~1 day';
  if (days === 7) return '~1 week';
  return `~${+days.toFixed(1)} days`;
}

export default {

  template: `
<div class="container">

  <!-- SEARCH -->
  <div class="card">

    <h2>Bitcoin Explorer</h2>

    <form class="search" @submit.prevent="search" role="search">
      <input
        v-model="query"
        placeholder="Block height, block hash, transaction id or address"
        aria-label="Search"
        autocomplete="off"
        spellcheck="false"
        @input="searchError = ''"
      >
      <button type="submit" :disabled="searching">
        {{ searching ? 'Searching…' : 'Search' }}
      </button>
    </form>

    <div v-if="searchError" class="notice notice-error" style="margin-top:10px">
      {{ searchError }}
    </div>

  </div>

  <!-- SATOSHI NAKAMOTO LEGACY -->
  <div class="card">
    <h2>Legacy of Satoshi Nakamoto:</h2>
    <div class="hash">
      Genesis Address: <a href="#/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa">1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa</a>
    </div>
    <div class="hash">
      Genesis Transaction: <a href="#/tx/4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b">4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b</a>
    </div>
    <div class="hash">
      Genesis Block: <a href="#/block/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f">000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f</a>
    </div>
  </div>

  <!-- BLOCKCHAIN TIP -->
  <div class="card">

    <h2>Blockchain Tip</h2>

    <data-status :status="latestStatus" what="block"></data-status>

    <dl v-if="latest.id" class="facts">
      <dt>Height</dt>
      <dd><router-link :to="'/block/' + latest.id">{{ formatNumber(latest.height) }}</router-link></dd>

      <dt>Hash</dt>
      <dd class="hash"><router-link :to="'/block/' + latest.id">{{ latest.id }}</router-link></dd>

      <dt>Mined</dt>
      <dd>{{ formatTime(latest.timestamp) }} <span class="muted">({{ ago(latest.timestamp) }})</span></dd>
    </dl>

    <verify-badge v-if="latest.id" :result="tipCheck"></verify-badge>

  </div>

  <!-- TOTAL WORK -->
  <div class="card" v-if="latest.id">

    <h2>Work behind the tip</h2>

    <template v-if="!chainWorkEnabled">
      <p class="muted">
        How much proof of work stands behind this chain, and does every
        difficulty change since the genesis block follow the rules? Your
        browser can check both from the first and last header of each
        difficulty period, about
        {{ formatNumber(headerCount) }} {{ headerCount === 1 ? 'header' : 'headers' }}
        ({{ Math.ceil(headerCount * 80 / 1024) }} KB)
        the first time. After that, only new ones.
      </p>
      <button @click="enableChainWork">Add it up</button>
    </template>

    <template v-else>
      <div v-if="chainWorkProgress && !historyCheck" class="muted">
        {{ chainWorkProgress.label }}… {{ formatNumber(chainWorkProgress.done) }} / {{ formatNumber(chainWorkProgress.total) }}
        <progress :value="chainWorkProgress.done" :max="chainWorkProgress.total"></progress>
      </div>
      <verify-badge :result="chainWorkCheck"></verify-badge>
      <verify-badge v-if="chainWorkCheck" :result="historyCheck"></verify-badge>
    </template>

  </div>

  <!-- RECENT BLOCKS -->
  <div class="card">

    <h2>Recent Blocks</h2>

    <data-status :status="blocksStatus" what="block list"></data-status>

    <div v-if="recentBlocks.length" class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Height</th>
            <th>Mined</th>
            <th class="num">Transactions</th>
            <th class="num">Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="block in recentBlocks" :key="block.id">
            <td><router-link :to="'/block/' + block.id">{{ formatNumber(block.height) }}</router-link></td>
            <td :title="formatTime(block.timestamp)">{{ ago(block.timestamp) }}</td>
            <td class="num">{{ formatNumber(block.tx_count) }}</td>
            <td class="num">{{ (block.size / 1e6).toFixed(2) }} MB</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!blocksStatus.loading && !blocksStatus.error" class="empty">
      No recent blocks returned.
    </div>

  </div>

  <!-- MEMPOOL -->
  <div class="card">

    <h2>Mempool</h2>

    <data-status :status="mempoolStatus" what="mempool"></data-status>

    <dl v-if="mempool.count !== undefined" class="facts">
      <dt>Pending transactions</dt>
      <dd>{{ formatNumber(mempool.count) }}</dd>

      <dt>Size</dt>
      <dd>{{ formatVsize(mempool.vsize) }}
        <span class="muted">(~{{ Math.ceil(mempool.vsize / 1e6) }} blocks' worth)</span>
      </dd>

      <dt>Total fees</dt>
      <dd>{{ formatBtc(mempool.total_fee) }}</dd>
    </dl>

  </div>

  <!-- FEE ESTIMATES -->
  <div class="card">

    <h2>Fee Estimates</h2>

    <data-status :status="feesStatus" what="fee estimate"></data-status>

    <div v-if="feeRows.length" class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Confirm within</th>
            <th class="num">Fee rate</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in feeRows" :key="row.target">
            <td>
              {{ row.target }} {{ row.target === 1 ? 'block' : 'blocks' }}
              <span class="muted">({{ row.eta }})</span>
            </td>
            <td class="num">{{ row.rate.toFixed(1) }} sat/vB</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!feesStatus.loading && !feesStatus.error" class="empty">
      No fee estimates available.
    </div>

  </div>

  <!-- HISTOGRAM -->
  <div class="card">

    <h2>Fee Histogram</h2>

    <data-status :status="mempoolStatus" what="mempool"></data-status>

    <div
      v-if="mempool.count !== undefined && !mempool.fee_histogram?.length"
      class="empty"
    >
      The mempool has no fee histogram data right now.
    </div>

    <canvas id="histogramChart"></canvas>

  </div>

</div>
`,

  data() {
    return {
      query: '',
      searching: false,
      searchError: '',

      latest: {},
      recentBlocks: [],
      mempool: {},
      fees: {},

      latestStatus: createStatus(),
      blocksStatus: createStatus(),
      mempoolStatus: createStatus(),
      feesStatus: createStatus(),

      tipCheck: null,
      tipCheckedFor: null,

      chainWorkEnabled: readFlag(),
      chainWorkCheck: null,
      historyCheck: null,
      chainWorkProgress: null,
      chainWorkFor: null
    };
  },

  computed: {
    headerCount() {
      return this.latest.height === undefined ? 0 : historyHeaderCount(this.latest.height);
    },

    feeRows() {
      return FEE_TARGETS
        .filter(t => typeof this.fees[t] === 'number')
        .map(t => ({ target: t, eta: etaLabel(t), rate: this.fees[t] }));
    }
  },

  methods: {

    formatBtc,
    formatNumber,
    formatTime,
    formatVsize,

    ago(unixSeconds) {
      return formatAgo(unixSeconds * 1000, now.value);
    },

    // =================================================
    // SEARCH
    // =================================================

    async search() {
      const result = classifyQuery(this.query);

      this.searchError = '';

      if (result.type === 'invalid') {
        this.searchError = result.reason;
        return;
      }

      if (result.type === 'address') {
        this.$router.push('/address/' + result.address);
        return;
      }

      if (result.type === 'hash' && !result.likelyBlock) {
        this.$router.push('/tx/' + result.hash);
        return;
      }

      this.searching = true;

      try {
        if (result.type === 'height') {
          const hash = await getBlockHash(result.height);
          this.$router.push('/block/' + hash);
          return;
        }

        // Looks like a block hash; confirm before routing.
        const block = await tryGetBlock(result.hash);
        this.$router.push((block ? '/block/' : '/tx/') + result.hash);

      } catch (err) {
        if (err instanceof ApiError && err.kind === 'not_found') {
          this.searchError = `There is no block at height ${formatNumber(result.height)} yet.`;
        } else {
          this.searchError =
            "Couldn't reach any Bitcoin data provider to look this up. " +
            'Please try again in a moment.';
        }
      } finally {
        this.searching = false;
      }
    },

    // =================================================
    // DATA LOADERS
    // =================================================

    async loadLatestBlock() {
      const tip = await getTipHeight();
      const hash = await getBlockHash(tip);
      return await getBlock(hash);
    },

    // Ask every provider independently whenever a new tip shows up.
    async checkTip() {
      if (!this.latest.id || this.tipCheckedFor === this.latest.id) {
        return;
      }

      this.tipCheckedFor = this.latest.id;
      this.tipCheck = null;
      this.tipCheck = await verifyTip();
    },

    enableChainWork() {
      writeFlag();
      this.chainWorkEnabled = true;
      this.checkChainWork();
    },

    // Re-run for each new tip; cached headers make that cheap.
    async checkChainWork() {
      if (!this.chainWorkEnabled || !this.latest.id || this.chainWorkFor === this.latest.id) {
        return;
      }

      const tip = { id: this.latest.id, height: this.latest.height };

      this.chainWorkFor = tip.id;
      this.chainWorkCheck = null;
      this.historyCheck = null;

      // A newer tip may start its own run meanwhile; drop stale updates.
      const current = () => this.chainWorkFor === tip.id;
      const progress = label => (done, total) => {
        if (current()) this.chainWorkProgress = { label, done, total };
      };

      progress('Adding up the work')(0, chainWorkHeaderCount(tip.height));
      const work = await verifyChainWork(tip, { onProgress: progress('Adding up the work') });
      if (!current()) return;
      this.chainWorkCheck = work;

      // Period starts are now cached; this mostly fetches period ends.
      const history = await verifyDifficultyHistory(tip.height, {
        tipHeight: tip.height,
        onProgress: progress('Tracing the difficulty history')
      });
      if (current()) this.historyCheck = history;
    },

    loadMempool() {
      return getMempool();
    },

    loadRecentBlocks() {
      return getRecentBlocks();
    },

    loadFeeEstimates() {
      return getFeeEstimates();
    },

    // =================================================
    // HISTOGRAM
    // =================================================

    createHistogram() {
      const ctx = document.getElementById('histogramChart');

      this.histogramChart = Vue.markRaw(
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: [],
            datasets: [{
              label: 'Queued vBytes',
              data: []
            }]
          },
          options: {
            responsive: true,
            animation: false
          }
        })
      );
    },

    updateHistogram() {
      if (!this.histogramChart) {
        return;
      }

      const histogram = this.mempool?.fee_histogram || [];

      this.histogramChart.data.labels =
        histogram.map(h => h[0] + ' sat/vB');

      this.histogramChart.data.datasets[0].data =
        histogram.map(h => h[1]);

      this.histogramChart.update();
    }
  },

  mounted() {
    this.createHistogram();

    this.refreshers = [

      createSmartRefresher({
        cacheKey: 'latest-block',
        cacheTTL: CACHE_TTL.latestBlock,
        fetchFn: this.loadLatestBlock,
        status: this.latestStatus,
        onUpdate: data => {
          this.latest = data;
          this.checkTip();
          this.checkChainWork();
        }
      }),

      createSmartRefresher({
        cacheKey: 'mempool',
        cacheTTL: CACHE_TTL.mempool,
        fetchFn: this.loadMempool,
        status: this.mempoolStatus,
        onUpdate: data => {
          this.mempool = data;
          this.updateHistogram();
        }
      }),

      createSmartRefresher({
        cacheKey: 'recent-blocks',
        cacheTTL: CACHE_TTL.recentBlocks,
        fetchFn: this.loadRecentBlocks,
        status: this.blocksStatus,
        onUpdate: data => { this.recentBlocks = data; }
      }),

      createSmartRefresher({
        cacheKey: 'fee-estimates',
        cacheTTL: CACHE_TTL.feeEstimates,
        fetchFn: this.loadFeeEstimates,
        status: this.feesStatus,
        onUpdate: data => { this.fees = data; }
      })
    ];

    this.refreshers.forEach(r => r.start());
  },

  unmounted() {
    (this.refreshers || []).forEach(r => r.stop());
    this.histogramChart?.destroy();
  }
};
