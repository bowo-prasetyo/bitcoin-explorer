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

    <div class="card">
      <h2>Bitcoin Explorer</h2>

      <input
        v-model="query"
        placeholder="Block hash / txid / address"
      >

      <button @click="search">
        Search
      </button>
    </div>

    <div class="grid">

      <div class="card">
        <h3>Latest Block</h3>

        <div v-if="latest.height">

          <div>
            Height:
            {{ latest.height }}
          </div>

          <div class="hash">
            {{ latest.id }}
          </div>

          <div>
            Tx Count:
            {{ latest.tx_count }}
          </div>

        </div>

        <div v-else>
          Loading latest block...
        </div>
      </div>

      <div class="card">
        <h3>Mempool</h3>

        <div v-if="mempool.count !== undefined">

          <div>
            {{ mempool.count }} txs
          </div>

          <div>
            {{ mempool.vsize }} vbytes
          </div>

          <div>
            {{ mempool.total_fee }} sats
          </div>

        </div>

        <div v-else>
          Loading mempool...
        </div>
      </div>

    </div>

  </div>
  `,

  data() {

    return {

      latest: {},
      mempool: {},
      query: '',

      latestRefresher: null,
      mempoolRefresher: null

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
