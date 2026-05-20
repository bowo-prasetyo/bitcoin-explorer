import { getTx } from '../api.js';
import { put } from '../db.js';

export default {
  template: `
  <div class="container">
    <div class="card">
      <h2>Transaction</h2>

      <div class="hash">{{ tx.txid }}</div>

      <div>Fee: {{ tx.fee }}</div>
      <div>Weight: {{ tx.weight }}</div>
      <div>Status: {{ tx.status.confirmed }}</div>
    </div>

    <div class="card">
      <h3>Inputs</h3>
      <div v-for="vin in tx.vin">
        {{ vin.prevout?.scriptpubkey_address }}
      </div>
    </div>

    <div class="card">
      <h3>Outputs</h3>
      <div v-for="vout in tx.vout">
        {{ vout.scriptpubkey_address }}
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
      }
    };
  },

  async mounted() {
    const txid = this.$route.params.txid;

    this.tx = await getTx(txid);

    await put('txs', this.tx);
  }
};
