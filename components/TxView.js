import { getTx } from '../api.js';

import { put } from '../db.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Transaction</h2>

      <div class="hash">{{ txid }}</div>

      <data-status :status="status" what="transaction"></data-status>

      <template v-if="tx">

        <div>Fee: {{ tx.fee }} satoshis (sats)</div>

        <div>Weight: {{ tx.weight }}</div>

        <div>Confirmed: {{ tx.status.confirmed }}</div>

        <div v-if="tx.status.block_height">
          Block Height: {{ tx.status.block_height }}
        </div>

      </template>

    </div>

    <template v-if="tx">

      <div class="card">

        <h3>Inputs</h3>

        <div v-if="tx.vin.length === 0" class="empty">
          No inputs
        </div>

        <div v-for="(vin, index) in tx.vin" :key="index">

          <div v-if="vin.is_coinbase" class="hash">
            Coinbase (newly minted coins)
          </div>

          <router-link
            v-else-if="vin.prevout?.scriptpubkey_address"
            class="hash"
            :to="'/address/' + vin.prevout.scriptpubkey_address"
          >
            {{ vin.prevout.scriptpubkey_address }}
          </router-link>

          <div v-else class="hash empty">
            No address (non-standard script)
          </div>

        </div>

      </div>

      <div class="card">

        <h3>Outputs</h3>

        <div v-if="tx.vout.length === 0" class="empty">
          No outputs
        </div>

        <div v-for="(vout, index) in tx.vout" :key="index">

          <router-link
            v-if="vout.scriptpubkey_address"
            class="hash"
            :to="'/address/' + vout.scriptpubkey_address"
          >
            {{ vout.scriptpubkey_address }}
          </router-link>

          <div v-else-if="vout.scriptpubkey_type === 'op_return'" class="hash empty">
            OP_RETURN (data, no address)
          </div>

          <div v-else class="hash empty">
            No address ({{ vout.scriptpubkey_type || 'non-standard' }} script)
          </div>

        </div>

      </div>

    </template>

  </div>
  `,

  data() {
    return {
      txid: '',
      tx: null,
      status: createStatus()
    };
  },

  methods: {
    async loadTransaction() {
      const tx = await getTx(this.txid);

      await put('txs', tx);

      return tx;
    }
  },

  mounted() {
    this.txid = this.$route.params.txid;

    this.refresher = createSmartRefresher({
      cacheKey: 'tx-' + this.txid,

      // Confirmed transactions don't change; pending ones do.
      cacheTTL: tx =>
        tx?.status?.confirmed
          ? CACHE_TTL.txConfirmed
          : CACHE_TTL.txPending,

      fetchFn: this.loadTransaction,
      status: this.status,
      onUpdate: data => { this.tx = data; },

      // Stop polling once confirmed.
      shouldStop: () => this.tx?.status?.confirmed === true
    });

    this.refresher.start();
  },

  unmounted() {
    this.refresher?.stop();
  }
};
