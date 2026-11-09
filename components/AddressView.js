import { getAddress } from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Address</h2>

      <div class="hash">{{ address }}</div>

      <data-status :status="status" what="address"></data-status>

      <template v-if="data">

        <hr>

        <h3>Chain Stats</h3>

        <div>Funded: {{ data.chain_stats.funded_txo_sum }} satoshis (sats)</div>

        <div>Spent: {{ data.chain_stats.spent_txo_sum }} satoshis (sats)</div>

        <div>Transactions: {{ data.chain_stats.tx_count }}</div>

        <hr>

        <h3>Mempool Stats</h3>

        <div>Pending TX: {{ data.mempool_stats.tx_count }}</div>

        <div>Pending Funded: {{ data.mempool_stats.funded_txo_sum }} satoshis (sats)</div>

        <div>Pending Spent: {{ data.mempool_stats.spent_txo_sum }} satoshis (sats)</div>

      </template>

    </div>

  </div>
  `,

  data() {
    return {
      address: '',
      data: null,
      status: createStatus()
    };
  },

  methods: {
    loadAddressData() {
      return getAddress(this.address);
    }
  },

  mounted() {
    this.address = this.$route.params.addr;

    this.refresher = createSmartRefresher({
      cacheKey: 'addr-' + this.address,
      cacheTTL: CACHE_TTL.address,
      fetchFn: this.loadAddressData,
      status: this.status,
      onUpdate: data => { this.data = data; },

      // Nothing pending for this address: nothing to watch.
      shouldStop: () => this.data?.mempool_stats?.tx_count === 0
    });

    this.refresher.start();
  },

  unmounted() {
    this.refresher?.stop();
  }
};
