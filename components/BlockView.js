import {
  getBlock,
  getBlockTxs,
  getTipHeight
} from '../api.js';

import { put } from '../db.js';

import {
  createSmartRefresher
} from '../refresh.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Block</h2>

      <div>
        Height:
        {{ block.height }}
      </div>

      <div>
        Timestamp:
        {{ block.timestamp }}
      </div>

      <div>
        Transactions:
        {{ block.tx_count }}
      </div>

      <div>
        Confirmations:
        {{ confirmations }}
      </div>

      <div class="hash">
        {{ block.id }}
      </div>

    </div>

    <div class="card">

      <h3>
        Transactions
      </h3>

      <div
        v-for="tx in txs"
        :key="tx.txid"
      >

        <router-link
          :to="'/tx/' + tx.txid"
        >
          {{ tx.txid }}
        </router-link>

      </div>

    </div>

  </div>
  `,

  data() {

    return {

      block: {},
      txs: [],

      confirmations: 0,

      refresher: null
    };
  },

  methods: {

    async loadBlockData() {

      const hash =
        this.$route.params.hash;

      const block =
        await getBlock(hash);

      const txs =
        await getBlockTxs(hash);

      const tip =
        await getTipHeight();

      this.confirmations =
        (
          tip - block.height
        ) + 1;

      await put(
        'blocks',
        block
      );

      return {
        block,
        txs
      };
    }
  },

  mounted() {

    const hash =
      this.$route.params.hash;

    this.refresher =
      createSmartRefresher({

        cacheKey:
          'block-' + hash,

        cacheTTL:
          30000,

        fetchFn:
          this.loadBlockData,

        onUpdate:
          (data, cached) => {

            this.block =
              data.block;

            this.txs =
              data.txs;

            console.log(

              cached
                ? 'Block from cache'
                : 'Block from network'

            );
          },

        // ===========================================
        // STOP AFTER 3 CONFIRMATIONS
        // ===========================================

        shouldStop: () => {

          return (
            this.confirmations >= 3
          );
        }
      });

    this.refresher.start();
  },

  unmounted() {

    if (this.refresher) {

      this.refresher.stop();
    }
  }
};
