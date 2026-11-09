import {
  getAddress,
  getAddressTxs,
  getAddressTxsChain
} from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import { classifyQuery } from '../search.js';

import {
  addressNetValue,
  formatAgo,
  formatBtc,
  formatNumber,
  formatTime
} from '../format.js';

import { now } from './DataStatus.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Address</h2>

      <div class="hash">{{ address }}</div>

      <div v-if="invalidReason" class="notice notice-error" style="margin-top:10px">
        This isn't a valid Bitcoin mainnet address. {{ invalidReason }}
      </div>

      <template v-else>

        <data-status :status="status" what="address"></data-status>

        <dl v-if="data" class="facts">
          <dt>Balance</dt>
          <dd class="strong">{{ formatBtc(balance) }}</dd>

          <template v-if="pendingDelta !== 0 || data.mempool_stats.tx_count">
            <dt>Pending</dt>
            <dd>
              <span :class="pendingDelta < 0 ? 'neg' : 'pos'">
                {{ formatBtc(pendingDelta, { sign: true }) }}
              </span>
              <span class="muted">
                in {{ formatNumber(data.mempool_stats.tx_count) }} unconfirmed
                {{ data.mempool_stats.tx_count === 1 ? 'transaction' : 'transactions' }}
              </span>
            </dd>
          </template>

          <dt>Total received</dt>
          <dd>{{ formatBtc(data.chain_stats.funded_txo_sum) }}</dd>

          <dt>Total sent</dt>
          <dd>{{ formatBtc(data.chain_stats.spent_txo_sum) }}</dd>

          <dt>Transactions</dt>
          <dd>{{ formatNumber(data.chain_stats.tx_count) }} confirmed</dd>
        </dl>

      </template>

    </div>

    <div class="card" v-if="!invalidReason && data">

      <h3>
        Transactions
        <span class="muted small" v-if="txs.length">
          showing {{ formatNumber(txs.length) }} of
          {{ formatNumber(data.chain_stats.tx_count + data.mempool_stats.tx_count) }}
        </span>
      </h3>

      <data-status :status="txsStatus" what="transaction history"></data-status>

      <div v-if="txs.length" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Transaction</th>
              <th class="num">Change</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in txs" :key="tx.txid">
              <td>
                <span v-if="tx.status.confirmed" :title="formatTime(tx.status.block_time)">
                  {{ ago(tx.status.block_time) }}
                </span>
                <span v-else class="tag tag-pending">pending</span>
              </td>
              <td class="hash">
                <router-link :to="'/tx/' + tx.txid">{{ tx.txid }}</router-link>
              </td>
              <td class="num" :class="net(tx) < 0 ? 'neg' : 'pos'">
                {{ formatBtc(net(tx), { sign: true }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="!txsStatus.loading && !txsStatus.error" class="empty">
        This address has no transactions.
      </div>

      <div v-if="hasMore" class="load-more">
        <button @click="loadMore" :disabled="loadingMore">
          {{ loadingMore ? 'Loading…' : 'Load older transactions' }}
        </button>
        <div v-if="moreError" class="notice notice-error" style="margin-top:10px">
          {{ moreError }}
        </div>
      </div>

    </div>

  </div>
  `,

  data() {
    return {
      address: '',
      invalidReason: '',
      data: null,
      recentTxs: [],
      olderTxs: [],
      loadingMore: false,
      moreError: '',
      status: createStatus(),
      txsStatus: createStatus()
    };
  },

  computed: {
    balance() {
      const c = this.data.chain_stats;
      return c.funded_txo_sum - c.spent_txo_sum;
    },

    pendingDelta() {
      const m = this.data.mempool_stats;
      return m.funded_txo_sum - m.spent_txo_sum;
    },

    txs() {
      const seen = new Set(this.recentTxs.map(t => t.txid));
      return [
        ...this.recentTxs,
        ...this.olderTxs.filter(t => !seen.has(t.txid))
      ];
    },

    confirmedShown() {
      return this.txs.filter(t => t.status.confirmed).length;
    },

    hasMore() {
      return (
        this.data &&
        this.confirmedShown > 0 &&
        this.confirmedShown < this.data.chain_stats.tx_count
      );
    }
  },

  methods: {
    formatBtc,
    formatNumber,
    formatTime,

    ago(unixSeconds) {
      return formatAgo(unixSeconds * 1000, now.value);
    },

    net(tx) {
      return addressNetValue(tx, this.address);
    },

    async loadMore() {
      const confirmed = this.txs.filter(t => t.status.confirmed);
      const lastSeen = confirmed[confirmed.length - 1]?.txid;

      if (!lastSeen) {
        return;
      }

      this.loadingMore = true;
      this.moreError = '';

      try {
        const page = await getAddressTxsChain(this.address, lastSeen);
        this.olderTxs = [...this.olderTxs, ...page];
      } catch (err) {
        this.moreError =
          "Couldn't load older transactions. Please try again.";
      } finally {
        this.loadingMore = false;
      }
    }
  },

  mounted() {
    const check = classifyQuery(this.$route.params.addr);

    this.address = this.$route.params.addr;

    if (check.type !== 'address') {
      this.invalidReason = check.type === 'invalid'
        ? check.reason
        : 'It looks like a block height, block hash or transaction id.';
      return;
    }

    this.address = check.address;

    // Nothing pending for this address: nothing to watch.
    const settled = () => this.data?.mempool_stats?.tx_count === 0;

    this.refreshers = [

      createSmartRefresher({
        cacheKey: 'addr-' + this.address,
        cacheTTL: CACHE_TTL.address,
        fetchFn: () => getAddress(this.address),
        status: this.status,
        onUpdate: data => { this.data = data; },
        shouldStop: settled
      }),

      createSmartRefresher({
        cacheKey: 'addr-txs-' + this.address,
        cacheTTL: CACHE_TTL.address,
        fetchFn: () => getAddressTxs(this.address),
        status: this.txsStatus,
        onUpdate: txs => { this.recentTxs = txs; },
        shouldStop: settled
      })
    ];

    this.refreshers.forEach(r => r.start());
  },

  unmounted() {
    (this.refreshers || []).forEach(r => r.stop());
  }
};
