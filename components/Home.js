import { getTipHeight, getBlockHash, getBlock, getMempool } from '../api.js';
import { put } from '../db.js';

export default {
  template: `
  <div class="container">

    <div class="card">
      <h2>Bitcoin Explorer</h2>

      <input v-model="query" placeholder="Block hash / txid / address">

      <button @click="search">Search</button>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Latest Block</h3>
        <div>{{ latest.height }}</div>
        <div class="hash">{{ latest.id }}</div>
      </div>

      <div class="card">
        <h3>Mempool</h3>
        <div>{{ mempool.count }} txs</div>
        <div>{{ mempool.vsize }} vbytes</div>
      </div>
    </div>

  </div>
  `,

  data() {
    return {
      latest: {},
      mempool: {},
      query: ''
    };
  },

  async mounted() {
    const tip = await getTipHeight();
    const hash = await getBlockHash(tip);
    const block = await getBlock(hash);

    this.latest = block;

    await put('blocks', block);

    this.mempool = await getMempool();
  },

  methods: {
    search() {
      const q = this.query.trim();

      if (q.length === 64) {
        this.$router.push('/tx/' + q);
      } else {
        this.$router.push('/address/' + q);
      }
    }
  }
};
