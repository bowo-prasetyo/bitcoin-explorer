import { getAddress } from '../api.js';

export default {
  template: `
  <div class="container">
    <div class="card">
      <h2>Address</h2>

      <div class="hash">{{ address }}</div>

      <div>Funded: {{ data.chain_stats.funded_txo_sum }}</div>
      <div>Spent: {{ data.chain_stats.spent_txo_sum }}</div>
      <div>Transactions: {{ data.chain_stats.tx_count }}</div>
    </div>
  </div>
  `,

  data() {
    return {
      address: '',
      data: {
        chain_stats: {}
      }
    };
  },

  async mounted() {
    this.address = this.$route.params.addr;
    this.data = await getAddress(this.address);
  }
};
