import {
  getTipHeight,
  getBlockHash,
  getBlock,
  getMempool,
  getRecentBlocks,
  getFeeEstimates,
  tryGetBlock
} from '../api.js';

import { put } from '../db.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

export default {

  template: `
<div class="container">

  <!-- SEARCH -->
  <div class="card">

    <h2>Bitcoin Explorer</h2>

    <input
      v-model="query"
      placeholder="Block hash / txid / address"
    >

    <button @click="search" :disabled="searching">
      {{ searching ? 'Searching…' : 'Search' }}
    </button>

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

    <template v-if="latest.id">

      <div>Height: {{ latest.height }}</div>

      <div class="hash">
        Hash:
        <a :href="'#/block/' + latest.id">{{ latest.id }}</a>
      </div>

      <div>
        Timestamp:
        {{ latest.timestamp }}
        ({{ new Date(latest.timestamp * 1000).toUTCString() }})
      </div>

    </template>

  </div>

  <!-- RECENT BLOCKS -->
  <div class="card">

    <h2>Recent Blocks</h2>

    <data-status :status="blocksStatus" what="block list"></data-status>

    <table v-if="recentBlocks.length">

      <thead>
        <tr>
          <th>Height</th>
          <th>TX</th>
          <th>Size (bytes)</th>
          <th>Weight</th>
        </tr>
      </thead>

      <tbody>
        <tr v-for="block in recentBlocks" :key="block.id">
          <td>{{ block.height }}</td>
          <td>{{ block.tx_count }}</td>
          <td>{{ block.size }}</td>
          <td>{{ block.weight }}</td>
        </tr>
      </tbody>

    </table>

    <div v-else-if="!blocksStatus.loading && !blocksStatus.error" class="empty">
      No recent blocks returned.
    </div>

  </div>

  <!-- MEMPOOL -->
  <div class="card">

    <h2>Mempool State</h2>

    <data-status :status="mempoolStatus" what="mempool"></data-status>

    <template v-if="mempool.count !== undefined">

      <div>Pending TX: {{ mempool.count }} transactions</div>

      <div>Queue VSize: {{ mempool.vsize }} virtual bytes (vBytes)</div>

      <div>Total Fees: {{ mempool.total_fee }} satoshis (sats)</div>

    </template>

  </div>

  <!-- FEE ESTIMATES -->
  <div class="card">

    <h2>Fee Estimates</h2>

    <data-status :status="feesStatus" what="fee estimate"></data-status>

    <table v-if="Object.keys(fees).length">

      <thead>
        <tr>
          <th>Target</th>
          <th>sat/vB</th>
        </tr>
      </thead>

      <tbody>
        <tr v-for="(fee, target) in fees" :key="target">
          <td>{{ target }} blocks</td>
          <td>{{ fee }}</td>
        </tr>
      </tbody>

    </table>

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

      histogramChart: null
    };
  },

  methods: {

    // =================================================
    // SEARCH
    // =================================================

    async search() {
      const q = this.query.trim();

      if (!q) {
        return;
      }

      this.searchError = '';

      if (q.length !== 64) {
        this.$router.push('/address/' + q);
        return;
      }

      // A 64-char hex string is either a block hash or a txid.
      this.searching = true;

      try {
        const block = await tryGetBlock(q);

        this.$router.push(
          (block ? '/block/' : '/tx/') + q
        );
      } catch (err) {
        this.searchError =
          "Couldn't reach any Bitcoin data provider to look this up. " +
          'Please try again in a moment.';
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
      const block = await getBlock(hash);

      await put('blocks', block);

      return block;
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
        onUpdate: data => { this.latest = data; }
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

    if (this.histogramChart) {
      this.histogramChart.destroy();
    }
  }
};
