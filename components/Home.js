import {
  getTipHeight,
  getBlockHash,
  getBlock,
  getMempool
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
      {{ latest.id }}
    </div>

    <div>
      Timestamp:
      {{ latest.timestamp }}
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
          <th>Size</th>
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
    </div>

    <div>
      Queue VSize:
      {{ mempool.vsize }}
    </div>

    <div>
      Total Fees:
      {{ mempool.total_fee }}
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

    search() {

      const q =
        this.query.trim();

      if (!q) {
        return;
      }

      if (q.length === 64) {

        this.$router.push(
          '/tx/' + q
        );

      } else {

        this.$router.push(
          '/address/' + q
        );
      }
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

  const histogram =
    this.mempool
      .fee_histogram || [];

  this.histogramChart
    .data.labels =

      histogram.map(
        h => h[0]
      );

  this.histogramChart
    .data.datasets[0]
    .data =

      histogram.map(
        h => h[1]
      );

  this.histogramChart
    .update();
}
    
  },

  mounted() {

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

            console.log(

              cached
                ? 'Mempool from cache'
                : 'Mempool from network'

            );
          }
      });

    this.mempoolRefresher.start();
  },

  unmounted() {

    // Stop refreshers

    if (this.latestRefresher) {

      this.latestRefresher.stop();
    }

    if (this.mempoolRefresher) {

      this.mempoolRefresher.stop();
    }
  }
};
