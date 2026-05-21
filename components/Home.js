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
  createSmartRefresher
} from '../refresh.js';

export default {

  template: `
<div class="container">

  <!-- SEARCH -->
  <div class="card">

    <h2>
      Bitcoin Explorer
    </h2>

    <input
      v-model="query"
      placeholder="
        Block hash / txid / address
      "
    >

    <button @click="search">
      Search
    </button>

  </div>
  
  <!-- SATOSHI NAKAMOTO LEGACY -->
  <div class="card">
    <h2>
    Satoshi Nakamoto Legacy:
    </h2>
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

    <h2>
      Blockchain Tip
    </h2>

    <div>
      Height:
      {{ latest.height }}
    </div>

    <div class="hash">
      Hash: 
      <a :href="'#/block/' + latest.id">
        {{ latest.id }}
      </a>
    </div>

    <div>
  Timestamp:
  {{ latest.timestamp }}

  <span v-if="latest.timestamp">
    (
    {{
      new Date(
        latest.timestamp * 1000
      ).toUTCString()
    }}
    )
  </span>
</div>

  </div>

  <!-- RECENT BLOCKS -->
  <div class="card">

    <h2>
      Recent Blocks
    </h2>

    <table>

      <thead>

        <tr>
          <th>Height</th>
          <th>TX</th>
          <th>Size (bytes)</th>
          <th>Weight</th>
        </tr>

      </thead>

      <tbody>

        <tr
          v-for="
            block in recentBlocks
          "
          :key="block.id"
        >

          <td>
            {{ block.height }}
          </td>

          <td>
            {{ block.tx_count }}
          </td>

          <td>
            {{ block.size }}
          </td>

          <td>
            {{ block.weight }}
          </td>

        </tr>

      </tbody>

    </table>

  </div>

  <!-- MEMPOOL -->
  <div class="card">

    <h2>
      Mempool State
    </h2>

    <div>
      Pending TX:
      {{ mempool.count }}
      transactions
    </div>

    <div>
      Queue VSize:
      {{ mempool.vsize }}
      virtual bytes (vBytes)
    </div>

    <div>
      Total Fees:
      {{ mempool.total_fee }}
      satoshis (sats)
    </div>

  </div>

  <!-- FEE ESTIMATES -->
  <div class="card">

    <h2>
      Fee Estimates
    </h2>

    <table>

      <thead>

        <tr>
          <th>Target</th>
          <th>sat/vB</th>
        </tr>

      </thead>

      <tbody>

        <tr
          v-for="
            (fee, target)
            in fees
          "
          :key="target"
        >

          <td>
            {{ target }} blocks
          </td>

          <td>
            {{ fee }}
          </td>

        </tr>

      </tbody>

    </table>

  </div>

  <!-- HISTOGRAM -->
  <div class="card">

    <h2>
      Fee Histogram
    </h2>

    <canvas
      id="histogramChart"
    ></canvas>

  </div>

</div>
`,

  data() {

  return {

    query: '',

    latest: {},

    recentBlocks: [],

    mempool: {},

    fees: {},

    histogramChart: null
  };
},

  methods: {

    // =================================================
    // SEARCH
    // =================================================
    
    async search() {

  const q =
    this.query.trim();

  if (!q) {
    return;
  }

  if (q.length === 64) {

    const block =
      await tryGetBlock(q);

    if (block) {

      this.$router.push(
        '/block/' + q
      );

    } else {

      this.$router.push(
        '/tx/' + q
      );
    }

    return;
  }

  this.$router.push(
    '/address/' + q
  );
},

    // =================================================
    // LOAD LATEST BLOCK
    // =================================================

    async loadLatestBlock() {

      const tip =
        await getTipHeight();

      const hash =
        await getBlockHash(tip);

      const block =
        await getBlock(hash);

      await put(
        'blocks',
        block
      );

      return block;
    },

    // =================================================
    // LOAD MEMPOOL
    // =================================================

    async loadMempool() {

      return await getMempool();
    },

    createHistogram() {

  const ctx =
    document
      .getElementById(
        'histogramChart'
      );

  this.histogramChart =
    Vue.markRaw(

      new Chart(ctx, {

        type: 'bar',

        data: {

          labels: [],

          datasets: [{

            label:
              'Queued vBytes',

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

  if (
    !this.histogramChart
  ) {
    return;
  }

  if (
    !this.mempool
      ?.fee_histogram
  ) {
    return;
  }

  const histogram =
    this.mempool
      .fee_histogram;

  this.histogramChart
    .data.labels =

      histogram.map(
        h => h[0] + ' sat/vB'
      );

  this.histogramChart
    .data.datasets[0]
    .data =

      histogram.map(
        h => h[1]
      );

  this.histogramChart
    .update();
},
    
    async loadRecentBlocks() {

  return await getRecentBlocks();
},

async loadFeeEstimates() {

  return await getFeeEstimates();
}    
    
  },

  mounted() {
    // ===========================================
    // CREATE HISTOGRAM CHART
    // ===========================================
  
    this.createHistogram();

    // ===============================================
    // LATEST BLOCK REFRESHER
    // ===============================================

    this.latestRefresher =
      createSmartRefresher({

        cacheKey:
          'latest-block',

        cacheTTL:
          15000,

        fetchFn:
          this.loadLatestBlock,

        onUpdate:
          (data, cached) => {

            this.latest = data;

            console.log(

              cached
                ? 'Latest block from cache'
                : 'Latest block from network'

            );
          }
      });

    this.latestRefresher.start();

    // ===============================================
    // MEMPOOL REFRESHER
    // ===============================================

    this.mempoolRefresher =
      createSmartRefresher({

        cacheKey:
          'mempool',

        cacheTTL:
          10000,

        fetchFn:
          this.loadMempool,

        onUpdate:
          (data, cached) => {

            this.mempool = data;
this.updateHistogram();

            console.log(

              cached
                ? 'Mempool from cache'
                : 'Mempool from network'

            );
          }
      });

    this.mempoolRefresher.start();

    this.blocksRefresher =
  createSmartRefresher({

    cacheKey:
      'recent-blocks',

    cacheTTL:
      15000,

    fetchFn:
      this.loadRecentBlocks,

    onUpdate:
      (data, cached) => {

        this.recentBlocks =
          data;

        console.log(

          cached
            ? 'Recent blocks cache'
            : 'Recent blocks network'
        );
      }
  });

this.blocksRefresher.start();

    this.feesRefresher =
  createSmartRefresher({

    cacheKey:
      'fee-estimates',

    cacheTTL:
      30000,

    fetchFn:
      this.loadFeeEstimates,

    onUpdate:
      (data, cached) => {

        this.fees = data;

        console.log(

          cached
            ? 'Fees cache'
            : 'Fees network'
        );
      }
  });

this.feesRefresher.start();
    
  },

  unmounted() {

    // Stop refreshers

    if (this.latestRefresher) {

      this.latestRefresher.stop();
    }

    if (this.mempoolRefresher) {

      this.mempoolRefresher.stop();
    }

    if (this.blocksRefresher) {

  this.blocksRefresher.stop();
}

if (this.feesRefresher) {

  this.feesRefresher.stop();
}
    
  }
};
