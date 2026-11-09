import {
  getBlock,
  getBlockTxs,
  getTipHeight
} from '../api.js';

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

      <h2>Block</h2>

      <div class="hash">{{ hash }}</div>

      <data-status :status="status" what="block"></data-status>

      <template v-if="block">

        <div>Height: {{ block.height }}</div>

        <div>
          Timestamp:
          {{ block.timestamp }}
          ({{ new Date(block.timestamp * 1000).toUTCString() }})
        </div>

        <div>Transactions: {{ block.tx_count }}</div>

        <div>Confirmations: {{ confirmations }}</div>

      </template>

    </div>

    <div class="card" v-if="block">

      <h3>Transactions</h3>

      <div v-if="txs.length === 0" class="empty">
        No transactions returned for this block.
      </div>

      <div v-for="tx in txs" :key="tx.txid">
        <router-link class="hash" :to="'/tx/' + tx.txid">
          {{ tx.txid }}
        </router-link>
      </div>

    </div>

  </div>
  `,

  data() {
    return {
      hash: '',
      block: null,
      txs: [],
      tipHeight: null,
      status: createStatus()
    };
  },

  computed: {
    // Derived from cached data too, so it's right on a cache-first render.
    confirmations() {
      if (!this.block || this.tipHeight === null) {
        return '…';
      }
      return this.tipHeight - this.block.height + 1;
    }
  },

  methods: {
    async loadBlockData() {
      const [block, txs, tipHeight] = await Promise.all([
        getBlock(this.hash),
        getBlockTxs(this.hash),
        getTipHeight()
      ]);

      await put('blocks', block);

      return { block, txs, tipHeight };
    }
  },

  mounted() {
    this.hash = this.$route.params.hash;

    this.refresher = createSmartRefresher({
      cacheKey: 'block-' + this.hash,
      cacheTTL: CACHE_TTL.block,
      fetchFn: this.loadBlockData,
      status: this.status,

      onUpdate: data => {
        this.block = data.block;
        this.txs = data.txs;
        this.tipHeight = data.tipHeight ?? null;
      },

      // Confirmation count only matters while the block is new.
      shouldStop: () =>
        typeof this.confirmations === 'number' &&
        this.confirmations >= 3
    });

    this.refresher.start();
  },

  unmounted() {
    this.refresher?.stop();
  }
};
