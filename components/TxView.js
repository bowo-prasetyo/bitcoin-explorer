import { getTx } from '../api.js';

import { put } from '../db.js';

import {
  createSmartRefresher
} from '../refresh.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Transaction</h2>

      <div
        class="hash"
        v-if="tx.txid"
      >
        {{ tx.txid }}
      </div>

      <div v-else>
        Loading transaction...
      </div>

      <br>

      <div>
        Fee:
        {{ tx.fee }}
      </div>

      <div>
        Weight:
        {{ tx.weight }}
      </div>

      <div>
        Confirmed:
        {{ tx.status.confirmed }}
      </div>

      <div
        v-if="tx.status.block_height"
      >
        Block Height:
        {{ tx.status.block_height }}
      </div>

    </div>

    <div class="card">

      <h3>
        Inputs
      </h3>

      <div
        v-if="tx.vin.length === 0"
      >
        No inputs
      </div>

      <div
  v-for="(vin, index) in tx.vin"
  :key="index"
>

  <!-- NORMAL INPUT -->
  <router-link
    v-if="vin.prevout?.scriptpubkey_address"
    class="hash"
    :to="
      '/address/' +
      vin.prevout.scriptpubkey_address
    "
  >
    {{ vin.prevout.scriptpubkey_address }}
  </router-link>

  <!-- COINBASE INPUT -->
  <div
    v-else
    class="hash"
  >
    Coinbase
  </div>

</div>
</div>

    <div class="card">

      <h3>
        Outputs
      </h3>

      <div
        v-if="tx.vout.length === 0"
      >
        No outputs
      </div>
      
      <div
        v-for="(vout, index) in tx.vout"
        :key="index"
      >
      
        <router-link
          v-if="vout.scriptpubkey_address"
          class="hash"
          :to="'/address/' + vout.scriptpubkey_address"
        >
          {{ vout.scriptpubkey_address }}
        </router-link>
      
      </div>

    </div>

  </div>
  `,

  data() {

    return {

      tx: {

        vin: [],
        vout: [],
        status: {}

      },

      refresher: null
    };
  },

  methods: {

    // ===============================================
    // LOAD TRANSACTION
    // ===============================================

    async loadTransaction() {

      const txid =
        this.$route.params.txid;

      const tx =
        await getTx(txid);

      await put(
        'txs',
        tx
      );

      return tx;
    }
  },

  mounted() {

    const txid =
      this.$route.params.txid;

    // ===============================================
    // SMART AUTO REFRESH
    // ===============================================

    this.refresher =
      createSmartRefresher({

        cacheKey:
          'tx-' + txid,

        cacheTTL:
          15000,

        fetchFn:
          this.loadTransaction,

        onUpdate:
          (data, cached) => {

            this.tx = data;

            console.log(

              cached
                ? 'Transaction from cache'
                : 'Transaction from network'

            );
          },

        // ===========================================
        // STOP AFTER CONFIRMATION
        // ===========================================

        shouldStop: () => {

          return (
            this.tx?.status?.confirmed === true
          );
        }
      });

    this.refresher.start();
  },

  unmounted() {

    // Stop refresher

    if (this.refresher) {

      this.refresher.stop();
    }
  }
};
