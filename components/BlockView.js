import { getBlock, getBlockTxs } from '../api.js';
import { put } from '../db.js';

export default {
  template: `
  <div class="container">
    <div class="card">
      <h2>Block</h2>

      <div>Height: {{ block.height }}</div>
      <div>Timestamp: {{ block.timestamp }}</div>
      <div>Transactions: {{ block.tx_count }}</div>

      <div class="hash">{{ block.id }}</div>
    </div>

    <div class="card">
      <h3>Transactions</h3>

      <div v-for="tx in txs" :key="tx.txid">
        <router-link :to="'/tx/' + tx.txid">
          {{ tx.txid }}
        </router-link>
      </div>
    </div>
  </div>
  `,

  data() {
    return {
      block: {},
      txs: []
    };
  },

  async mounted() {
    const hash = this.$route.params.hash;

    this.block = await getBlock(hash);
    this.txs = await getBlockTxs(hash);

    await put('blocks', this.block);
  }
};
