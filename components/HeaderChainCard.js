// <header-chain-card :tip-height="…">: the full header chain, on Home.
// Opt-in: downloads the site's header files (~160 KB per difficulty
// period, ~78 MB in all), checks every header from the genesis block, and
// keeps them in this browser (headersync.js). Every visit re-checks what
// is stored from the genesis block (in a worker); new periods are fetched
// at most twice a day, or when asked.

import { getBlockHashFromEach } from '../api.js';
import { formatNumber, formatAgo } from '../format.js';
import { now } from './DataStatus.js';
import {
  startHeaderSync,
  storedSummary,
  headerChainResult,
  headerChainOptedIn,
  setHeaderChainOptIn,
  lastFullSync,
  markFullSync,
  expectedPeriods,
  idbStore,
  PERIOD_BYTES
} from '../headersync.js';

// A new period is published about every two weeks.
const RECHECK_AFTER_MS = 12 * 3600 * 1000;

export default {

  props: {
    tipHeight: { type: Number, default: null }
  },

  data() {
    return {
      enabled: headerChainOptedIn(),
      running: null,      // { stop } while a sync runs
      progress: null,     // { phase, done, total }
      check: null,        // <verify-badge> result
      stored: null,       // storedSummary(): is anything stored at all
      persisted: null,    // navigator.storage.persisted()
      lastSync: lastFullSync()
    };
  },

  computed: {
    downloadMB() {
      const n = this.tipHeight === null ? 0 : expectedPeriods(this.tipHeight);
      return Math.round(n * PERIOD_BYTES / 1e6);
    },

    progressLabel() {
      const p = this.progress;
      if (!p) return 'Starting';
      return p.phase === 'checking'
        ? `Checking stored headers again: period ${formatNumber(p.done)} of ${formatNumber(p.total)}`
        : `Downloading and checking: period ${formatNumber(p.done)} of ${formatNumber(p.total)}`;
    },

    lastSyncLabel() {
      return this.lastSync ? formatAgo(this.lastSync, now.value) : null;
    }
  },

  methods: {
    formatNumber,

    async enable() {
      setHeaderChainOptIn(true);
      this.enabled = true;
      // Ask the browser not to clear ~78 MB when space runs low.
      try {
        this.persisted = await navigator.storage?.persist?.() ?? null;
      } catch {
        this.persisted = null;
      }
      this.sync();
    },

    async sync({ fetchNew = true } = {}) {
      if (this.running) return;

      this.progress = null;
      this.check = null;

      const run = startHeaderSync({ fetchNew, onProgress: p => { this.progress = p; } });
      this.running = run;

      const result = await run.promise;
      this.running = null;
      this.progress = null;

      if (result.status === 'ok' && fetchNew) {
        markFullSync();
        this.lastSync = lastFullSync();
      }

      let answers = null;
      if (result.tip) {
        try {
          answers = await getBlockHashFromEach(result.tip.height);
        } catch {
          answers = null;
        }
      }

      this.check = headerChainResult(result, answers);
      this.stored = await storedSummary().catch(() => null);
    },

    stop() {
      this.running?.stop();
    },

    async remove() {
      if (!window.confirm('Delete the stored header chain from this browser?')) return;
      this.running?.stop();
      await this.running?.promise;
      await idbStore.deleteFrom(0);
      setHeaderChainOptIn(false);
      this.enabled = false;
      this.check = null;
      this.stored = null;
      this.lastSync = 0;
    }
  },

  async mounted() {
    if (!this.enabled) return;

    try {
      this.persisted = await navigator.storage?.persisted?.() ?? null;
    } catch {
      this.persisted = null;
    }

    this.stored = await storedSummary().catch(() => null);

    // What is stored is always checked again; the site is asked for new
    // periods only when the last full check is old.
    this.sync({ fetchNew: !this.stored || Date.now() - this.lastSync > RECHECK_AFTER_MS });
  },

  unmounted() {
    // The sync keeps what it has; the next visit resumes.
    this.running?.stop();
  },

  template: `
  <div class="card header-chain">

    <h2>Full header chain</h2>

    <template v-if="!enabled">
      <p class="muted">
        Keep every <glossary-term term="block-header">block header</glossary-term>
        since the genesis block in this browser, each one checked: linked
        to the one before, with valid
        <glossary-term term="proof-of-work">proof of work</glossary-term> and the
        <glossary-term term="difficulty">difficulty</glossary-term> Bitcoin's
        rules require. That is about {{ formatNumber(downloadMB) }} MB, downloaded
        once from this site, then about 160 KB every two weeks.
      </p>
      <button class="primary" @click="enable">Download and check the header chain</button>
    </template>

    <template v-else>
      <div v-if="running" class="muted" aria-live="polite">
        {{ progressLabel }}…
        <progress v-if="progress" :value="progress.done" :max="progress.total"></progress>
        <button class="verify-action" @click="stop">Stop</button>
      </div>

      <verify-badge v-if="check || !running" :result="check"></verify-badge>

      <p class="muted small">
        <template v-if="persisted === true">Kept until you delete it.</template>
        <template v-else-if="persisted === false">The browser may clear it if storage runs low; it would download again.</template>
        <template v-if="lastSyncLabel"> Last fully checked {{ lastSyncLabel }}.</template>
      </p>

      <div class="button-row" v-if="!running">
        <button @click="sync()">Check for new headers</button>
        <button @click="remove">Delete stored headers</button>
      </div>
    </template>

  </div>
  `
};
