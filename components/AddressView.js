import { getAddress } from '../api.js';

import {
  createSmartRefresher
} from '../refresh.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>
        Address
      </h2>

      <div class="hash">
        {{ address }}
      </div>

      <hr>

      <h3>
        Chain Stats
      </h3>

      <div>
        Funded:
        {{ data.chain_stats.funded_txo_sum }}
        satoshis (sats)
      </div>

      <div>
        Spent:
        {{ data.chain_stats.spent_txo_sum }}
        satoshis (sats)
      </div>

      <div>
        Transactions:
        {{ data.chain_stats.tx_count }}
      </div>

      <hr>

      <h3>
        Mempool Stats
      </h3>

      <div>
        Pending TX:
        {{ data.mempool_stats.tx_count }}
      </div>

      <div>
        Pending Funded:
        {{ data.mempool_stats.funded_txo_sum }}
        satoshis (sats)
      </div>

      <div>
        Pending Spent:
        {{ data.mempool_stats.spent_txo_sum }}
        satoshis (sats)
      </div>

    </div>

  </div>
  `,

  data() {

    return {

      address: '',

      data: {

        chain_stats: {},

        mempool_stats: {}
      },

      refresher: null
    };
  },

  methods: {

    // ===============================================
    // LOAD ADDRESS DATA
    // ===============================================

    async loadAddressData() {

      return await getAddress(
        this.address
      );
    }
  },

  mounted() {

    this.address =
      this.$route.params.addr;

    // ===============================================
    // SMART AUTO REFRESH
    // ===============================================

    this.refresher =
      createSmartRefresher({

        cacheKey:
          'addr-' + this.address,

        cacheTTL:
          30000,

        fetchFn:
          this.loadAddressData,

        onUpdate:
          (data, cached) => {

            this.data = data;

            console.log(

              cached
                ? 'Address from cache'
                : 'Address from network'

            );
          },

        // ===========================================
        // STOP IF NO MEMPOOL ACTIVITY
        // ===========================================

        shouldStop: () => {

          return (

            this.data?.mempool_stats
              ?.tx_count === 0

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
