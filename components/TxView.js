import { getTx, getTipHeight } from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import {
  formatAgo,
  formatBtc,
  formatFeeRate,
  formatNumber,
  formatSats,
  formatTime,
  formatLocalTime,
  sumValues,
  vsizeFromWeight
} from '../format.js';

import { now } from './DataStatus.js';

import {
  verifyTransactionContents,
  verifyTransactionInclusion,
  verifyTransactionInputs
} from '../verify.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Transaction</h2>

      <div class="hash-row">
        <span class="hash">{{ txid }}</span>
        <copy-button :text="txid" what="transaction id"></copy-button>
      </div>

      <data-status :status="status" what="transaction"></data-status>

      <verify-summary v-if="tx" :results="[contentsCheck, inputsCheck, inclusionCheck]"></verify-summary>

      <dl v-if="tx" class="facts">

        <dt>Status</dt>
        <dd v-if="tx.status.confirmed">
          <span class="tag tag-ok">Confirmed</span>
          in block
          <router-link :to="'/block/' + tx.status.block_hash">
            {{ formatNumber(tx.status.block_height) }}
          </router-link>
        </dd>
        <dd v-else>
          <span class="tag tag-pending">Unconfirmed</span>
          waiting in the mempool
        </dd>

        <template v-if="tx.status.confirmed">
          <dt><glossary-term term="confirmations">Confirmations</glossary-term></dt>
          <dd>
            <template v-if="confirmations !== null">
              <span class="strong">{{ formatNumber(confirmations) }}</span>
              <span class="muted" v-if="confirmations < 6"> (many wait for 6)</span>
            </template>
            <template v-else>…</template>
          </dd>

          <dt>Time</dt>
          <dd>
            {{ formatTime(tx.status.block_time) }}
            <span class="muted">({{ ago(tx.status.block_time) }})</span>
            <span v-if="formatLocalTime(tx.status.block_time)" class="local-time muted small">{{ formatLocalTime(tx.status.block_time) }} your time</span>
          </dd>
        </template>

        <dt>Output total</dt>
        <dd>{{ formatBtc(totalOut) }}</dd>

        <template v-if="!isCoinbase">
          <dt>Fee</dt>
          <dd>
            {{ formatBtc(tx.fee) }}
            <span class="muted">({{ formatSats(tx.fee) }})</span>
          </dd>

          <dt><glossary-term term="fee-rate">Fee rate</glossary-term></dt>
          <dd>{{ formatFeeRate(tx.fee, tx.weight) }}</dd>
        </template>

        <dt><glossary-term term="vb-wu">Size</glossary-term></dt>
        <dd>
          {{ formatNumber(vsizeFromWeight(tx.weight)) }} vB
          <span class="muted">({{ formatNumber(tx.weight) }} WU)</span>
        </dd>

      </dl>

      <template v-if="tx">
        <verify-badge :result="contentsCheck"></verify-badge>
        <verify-badge :result="inputsCheck">
          <button
            v-if="inputsCheck?.needsConfirm"
            class="verify-action"
            @click="checkInputs(true)"
          >Check all inputs ({{ formatNumber(inputsCheck.parentCount) }} downloads)</button>
        </verify-badge>
        <verify-badge :result="inclusionCheck"></verify-badge>
      </template>

    </div>

    <div class="io" v-if="tx">

      <div class="card">

        <h3>
          Inputs ({{ tx.vin.length }})
          <span class="muted small" v-if="!isCoinbase">{{ formatBtc(totalIn) }}</span>
        </h3>

        <div v-if="tx.vin.length === 0" class="empty">No inputs</div>

        <div v-for="(vin, index) in tx.vin" :key="index" class="io-row">

          <div class="io-main">
            <div v-if="vin.is_coinbase">
              <glossary-term term="coinbase-transaction"><span class="tag">coinbase</span></glossary-term>
              newly minted coins and fees
            </div>

            <router-link
              v-else-if="vin.prevout?.scriptpubkey_address"
              class="hash"
              :to="'/address/' + vin.prevout.scriptpubkey_address"
            >{{ vin.prevout.scriptpubkey_address }}</router-link>

            <div v-else class="empty">
              No address ({{ vin.prevout?.scriptpubkey_type || 'non-standard' }} script)
            </div>

            <router-link
              v-if="!vin.is_coinbase && vin.txid"
              class="small muted"
              :to="'/tx/' + vin.txid"
              :title="'Output ' + vin.vout + ' of ' + vin.txid"
            >from {{ vin.txid?.slice(0, 8) }}…:{{ vin.vout }}</router-link>
          </div>

          <div class="io-amount" v-if="!vin.is_coinbase">
            <span
              v-if="inputMark(index)"
              class="io-mark"
              :class="inputMark(index).ok ? 'pos' : 'neg'"
              :title="inputMark(index).ok ? 'Amount verified against the transaction it spends' : inputMark(index).reason"
            >{{ inputMark(index).ok ? '✓' : '✗' }}</span>
            {{ formatBtc(vin.prevout?.value) }}
          </div>

        </div>

      </div>

      <div class="card">

        <h3>
          Outputs ({{ tx.vout.length }})
          <span class="muted small">{{ formatBtc(totalOut) }}</span>
        </h3>

        <div v-if="tx.vout.length === 0" class="empty">No outputs</div>

        <div v-for="(vout, index) in tx.vout" :key="index" class="io-row">

          <div class="io-main">
            <router-link
              v-if="vout.scriptpubkey_address"
              class="hash"
              :to="'/address/' + vout.scriptpubkey_address"
            >{{ vout.scriptpubkey_address }}</router-link>

            <div v-else-if="vout.scriptpubkey_type === 'op_return'" class="empty">
              OP_RETURN (data, no address)
            </div>

            <div v-else class="empty">
              No address ({{ vout.scriptpubkey_type || 'non-standard' }} script)
            </div>
          </div>

          <div class="io-amount">{{ formatBtc(vout.value) }}</div>

        </div>

      </div>

    </div>

  </div>
  `,

  data() {
    return {
      txid: '',
      tx: null,
      tipHeight: null,
      status: createStatus(),

      contentsCheck: null,
      contentsStarted: false,
      inputsCheck: null,
      inclusionCheck: null,
      inclusionStartedFor: null
    };
  },

  computed: {
    isCoinbase() {
      return !!this.tx?.vin?.[0]?.is_coinbase;
    },

    totalIn() {
      return sumValues(this.tx?.vin, v => v.prevout?.value);
    },

    totalOut() {
      return sumValues(this.tx?.vout);
    },

    // The block counts as the first. A tip cached before the block arrived
    // can lag behind it, so never show fewer than 1.
    confirmations() {
      if (!this.tx?.status?.confirmed || this.tipHeight === null) {
        return null;
      }
      return Math.max(1, this.tipHeight - this.tx.status.block_height + 1);
    }
  },

  methods: {
    formatBtc,
    formatFeeRate,
    formatNumber,
    formatSats,
    formatTime,
    formatLocalTime,
    vsizeFromWeight,

    ago(unixSeconds) {
      return formatAgo(unixSeconds * 1000, now.value);
    },

    loadTransaction() {
      return getTx(this.txid);
    },

    // Inputs run after contents so the fee can use the verified outputs.
    async checkInputs(force) {
      this.inputsCheck = null;
      this.inputsCheck = await verifyTransactionInputs(this.tx, {
        outputTotal: this.contentsCheck?.outputTotal ?? null,
        force
      });
    },

    inputMark(index) {
      return this.inputsCheck?.perInput?.[index] || null;
    },

    async verify() {
      const tx = this.tx;

      if (!this.contentsStarted) {
        this.contentsStarted = true;
        verifyTransactionContents(tx).then(r => {
          this.contentsCheck = r;
          this.checkInputs(false);
        });
      }

      // Re-check inclusion once a pending transaction confirms.
      const key = tx.status?.confirmed ? tx.status.block_hash : 'unconfirmed';

      if (this.inclusionStartedFor !== key) {
        this.inclusionStartedFor = key;
        this.inclusionCheck = null;
        this.inclusionCheck = await verifyTransactionInclusion(tx);
      }
    }
  },

  mounted() {
    this.txid = this.$route.params.txid;

    this.refresher = createSmartRefresher({
      cacheKey: 'tx-' + this.txid,

      // A pending transaction can only confirm when a block arrives.
      live: 'replace',

      // Confirmed transactions don't change; pending ones do.
      cacheTTL: tx =>
        tx?.status?.confirmed
          ? CACHE_TTL.txConfirmed
          : CACHE_TTL.txPending,

      fetchFn: this.loadTransaction,
      status: this.status,
      onUpdate: data => {
        this.tx = data;
        this.verify();
      },

      // Stop polling once confirmed.
      shouldStop: () => this.tx?.status?.confirmed === true
    });

    // Confirmations keep counting after the transaction itself stops
    // changing. The tip only moves with a new block.
    this.tipRefresher = createSmartRefresher({
      cacheKey: 'tip-height',
      cacheTTL: CACHE_TTL.latestBlock,
      live: 'replace',
      fetchFn: getTipHeight,
      onUpdate: height => { this.tipHeight = height; }
    });

    this.refresher.start();
    this.tipRefresher.start();
  },

  unmounted() {
    this.refresher?.stop();
    this.tipRefresher?.stop();
  }
};
