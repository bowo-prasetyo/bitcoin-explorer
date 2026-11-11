import {
  getTipHeight,
  getBlockHash,
  getBlock,
  getMempool,
  getRecentBlocks,
  getFeeEstimates
} from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import {
  formatAgo,
  formatBtc,
  formatNumber,
  formatTime,
  formatVsize,
  formatLocalTime,
  histogramBuckets
} from '../format.js';

import { now } from './DataStatus.js';
import { chartColor } from '../chart-theme.js';

import {
  verifyTip,
  verifyChainWork,
  verifyDifficultyHistory,
  historyHeaderCount,
  chainWorkHeaderCount
} from '../verify.js';

import { headersOptedIn, optInToHeaders } from '../history.js';
import HeaderChainCard from './HeaderChainCard.js';

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

  components: { HeaderChainCard },

  template: `
<div class="container home-grid">

  <!-- SEARCH -->
  <div class="card span-all">

    <h2>A Bitcoin explorer that checks before it shows.</h2>

    <search-box></search-box>

    <p class="examples small">
      <span class="muted">Try:</span>
      <router-link to="/block/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f">the genesis block</router-link>
      <router-link to="/tx/4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b">its transaction</router-link>
      <router-link to="/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa">Satoshi Nakamoto's address</router-link>
    </p>

  </div>

  <!-- BLOCKCHAIN TIP -->
  <div class="card">

    <h2><glossary-term term="chain-tip">Chain tip</glossary-term></h2>

    <data-status :status="latestStatus" what="block"></data-status>

    <dl v-if="latest.id" class="facts">
      <dt>Height</dt>
      <dd><router-link :to="'/block/' + latest.id">{{ formatNumber(latest.height) }}</router-link></dd>

      <dt>Hash</dt>
      <dd class="hash-row">
        <router-link class="hash" :to="'/block/' + latest.id">{{ latest.id }}</router-link>
        <copy-button :text="latest.id" what="block hash"></copy-button>
      </dd>

      <dt>Mined</dt>
      <dd>
        {{ formatTime(latest.timestamp) }} <span class="muted">({{ ago(latest.timestamp) }})</span>
        <span v-if="formatLocalTime(latest.timestamp)" class="local-time muted small">{{ formatLocalTime(latest.timestamp) }} your time</span>
      </dd>
    </dl>

    <verify-badge v-if="latest.id" :result="tipCheck">
      <button
        v-if="tipCheck && tipCheck.state !== 'ok'"
        class="verify-action"
        @click="recheckTip"
      >Check again</button>
    </verify-badge>

  </div>

  <!-- TOTAL WORK -->
  <div class="card" v-if="latest.id">

    <h2>Work behind the tip</h2>

    <template v-if="!chainWorkEnabled">
      <p class="muted">
        How much <glossary-term term="proof-of-work">proof of work</glossary-term>
        stands behind this chain, and does every
        <glossary-term term="difficulty">difficulty</glossary-term> change
        since the genesis block follow the rules? Your
        browser can check both from the first and last header of each
        difficulty period, about
        {{ formatNumber(headerCount) }} {{ headerCount === 1 ? 'header' : 'headers' }}
        ({{ Math.ceil(headerCount * 80 / 1024) }} KB)
        the first time. After that, only new ones.
      </p>
      <button class="primary" @click="enableChainWork">Add up the total work</button>
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

  <!-- FULL HEADER CHAIN -->
  <header-chain-card v-if="latest.id" :tip-height="latest.height"></header-chain-card>

  <!-- RECENT BLOCKS -->
  <div class="card">

    <h2>Recent blocks</h2>

    <data-status :status="blocksStatus" what="block list"></data-status>

    <provider-note v-if="recentBlocks.length">
      this list comes from the data provider. Open a block to check it.
    </provider-note>

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

    <h2><glossary-term term="mempool">Mempool</glossary-term></h2>

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

    <provider-note v-if="mempool.count !== undefined">
      this is the provider's mempool. Every node keeps its own, and they
      can differ.
    </provider-note>

  </div>

  <!-- FEE ESTIMATES -->
  <div class="card">

    <h2>Fee estimates</h2>

    <data-status :status="feesStatus" what="fee estimate"></data-status>

    <provider-note v-if="feeRows.length">
      the provider's estimate, not a guarantee.
    </provider-note>

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

    <h2>Fee histogram</h2>

    <data-status :status="mempoolStatus" what="mempool"></data-status>

    <provider-note v-if="buckets.length">
      built from the provider's mempool.
    </provider-note>

    <div
      v-if="mempool.count !== undefined && !buckets.length"
      class="empty"
    >
      The mempool has no fee histogram data right now.
    </div>

    <p v-if="buckets.length" class="muted small">
      How much is waiting at each fee rate. Higher-paying transactions are
      mined first.
    </p>

    <canvas
      id="histogramChart"
      role="img"
      :aria-label="histogramSummary"
    ></canvas>

    <details v-if="buckets.length" class="chart-table">
      <summary>Show as a table</summary>
      <table>
        <thead>
          <tr><th>Fee rate (sat/vB)</th><th class="num">Waiting</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in buckets" :key="b.label">
            <td>{{ b.label }}</td>
            <td class="num">{{ formatVsize(b.vsize) }}</td>
          </tr>
        </tbody>
      </table>
    </details>

  </div>

</div>
`,

  data() {
    return {
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

      chainWorkEnabled: headersOptedIn(),
      chainWorkCheck: null,
      historyCheck: null,
      chainWorkProgress: null,
      chainWorkFor: null
    };
  },

  computed: {
    buckets() {
      return histogramBuckets(this.mempool?.fee_histogram);
    },

    // The chart's text alternative: the three biggest bands.
    histogramSummary() {
      if (!this.buckets.length) {
        return 'Fee histogram: no data yet.';
      }
      const top = [...this.buckets]
        .sort((a, b) => b.vsize - a.vsize)
        .slice(0, 3)
        .map(b => `${formatVsize(b.vsize)} at ${b.label} sat/vB`);
      return `Fee histogram. Most waiting: ${top.join('; ')}. Use "Show as a table" for every band.`;
    },

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
    formatLocalTime,

    ago(unixSeconds) {
      return formatAgo(unixSeconds * 1000, now.value);
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

    // The tip check failed or couldn't run: ask every provider again.
    recheckTip() {
      this.tipCheckedFor = null;
      this.checkTip();
    },

    enableChainWork() {
      optInToHeaders();
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
      // The total is built on the difficulty history, which it runs and
      // returns; it is run here only when the total stopped before it.
      const work = await verifyChainWork(tip, {
        onProgress: progress('Adding up the work'),
        onHistoryProgress: progress('Tracing the difficulty history')
      });
      if (!current()) return;
      this.chainWorkCheck = work;

      const history = work.history ?? await verifyDifficultyHistory(tip.height, {
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
              label: 'Waiting',
              data: [],
              backgroundColor: chartColor('--chart-1')
            }]
          },
          options: {
            responsive: true,
            animation: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: items => `${items[0].label} sat/vB`,
                  label: item => `${item.parsed.y.toFixed(2)} MvB waiting`
                }
              }
            },
            scales: {
              x: { title: { display: true, text: 'Fee rate (sat/vB)' } },
              y: {
                title: { display: true, text: 'Waiting (MvB)' },
                beginAtZero: true
              }
            }
          }
        })
      );
    },

    updateHistogram() {
      if (!this.histogramChart) {
        return;
      }

      // Highest rate on the right, like a fee slider.
      const buckets = [...this.buckets].reverse();

      this.histogramChart.data.labels = buckets.map(b => b.label);
      this.histogramChart.data.datasets[0].data = buckets.map(b => b.vsize / 1e6);
      this.histogramChart.update();
    }
  },

  mounted() {
    this.createHistogram();

    this.refreshers = [

      createSmartRefresher({
        cacheKey: 'latest-block',
        cacheTTL: CACHE_TTL.latestBlock,
        live: 'replace',
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
        live: 'refresh',
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
        live: 'replace',
        fetchFn: this.loadRecentBlocks,
        status: this.blocksStatus,
        onUpdate: data => { this.recentBlocks = data; }
      }),

      createSmartRefresher({
        cacheKey: 'fee-estimates',
        cacheTTL: CACHE_TTL.feeEstimates,
        live: 'refresh',
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
