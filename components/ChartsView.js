import { getMempool, getTipHeight } from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import { get, put } from '../db.js';

import { verifyDifficultyHistory, historyHeaderCount } from '../verify.js';

import {
  describeSeries,
  formatDifficultyShort,
  formatHashrate,
  headersOptedIn,
  optInToHeaders,
  seriesCsv
} from '../history.js';

import { formatNumber } from '../format.js';

const { markRaw, nextTick } = Vue;

const HISTORY_KEY = 'mempool-chart-history';
const HISTORY_LIMIT = 50;

// Bitcoin's target time between blocks, in minutes.
const TARGET_MINUTES = 10;

const year = ms => String(new Date(ms).getUTCFullYear());

// Ticks on 1 January, every `step` years so there are at most ~8.
function yearTicks(axis) {
  const first = new Date(axis.min).getUTCFullYear() + 1;
  const last = new Date(axis.max).getUTCFullYear();
  const step = Math.max(1, Math.ceil((last - first + 1) / 8));
  const ticks = [];
  for (let y = first; y <= last; y += step) ticks.push({ value: Date.UTC(y, 0, 1) });
  axis.ticks = ticks;
}
const day = unix => new Date(unix * 1000).toISOString().slice(0, 10);

// Log-axis ticks only at powers of ten, so labels don't crowd.
const powerOfTenOnly = format => value => {
  const exp = Math.log10(value);
  return Math.abs(exp - Math.round(exp)) < 1e-9 ? format(value) : '';
};

export default {

  template: `
  <div class="container">

    <!-- VERIFIED HISTORY -->
    <div class="card">

      <h2>Bitcoin since 2009</h2>

      <p class="muted">
        Drawn from the first and last block header of every
        <glossary-term term="difficulty-period">difficulty period</glossary-term>
        (about two weeks): the same headers the difficulty check verifies.
        Nothing here is taken on a provider's word.
      </p>

      <div v-if="tipError" class="notice notice-error">{{ tipError }}</div>

      <div v-else-if="tipHeight === null" class="muted">Loading…</div>

      <template v-else-if="offer">
        <p class="muted">
          The first time, your browser downloads and checks about
          {{ formatNumber(offer) }} headers ({{ Math.ceil(offer * 80 / 1024) }} KB).
          After that, only new ones. The home page's
          <strong>Add up the total work</strong> uses the same headers.
        </p>
        <button class="primary" @click="start">
          Download and check {{ formatNumber(offer) }} headers
        </button>
      </template>

      <template v-else>
        <div v-if="progress && !historyCheck" class="muted">
          Checking the difficulty history… {{ formatNumber(progress.done) }} / {{ formatNumber(progress.total) }}
          <progress :value="progress.done" :max="progress.total"></progress>
        </div>

        <verify-badge :result="historyCheck"></verify-badge>
      </template>

      <template v-if="series">

        <section class="history-chart">
          <h3>Difficulty</h3>
          <p class="muted small">
            How many times harder than the very first blocks it is to find a
            block. Log scale: each line up is ten times harder.
          </p>
          <canvas id="difficultyChart" role="img" :aria-label="'Difficulty chart. ' + description"></canvas>
        </section>

        <section class="history-chart">
          <h3>Average time between blocks</h3>
          <p class="muted small">
            Per difficulty period, against Bitcoin's 10-minute target. When
            blocks come faster, the next
            <glossary-term term="retarget">retarget</glossary-term> raises the
            difficulty, and the other way round.
          </p>
          <canvas id="intervalChart" role="img" :aria-label="'Average time between blocks chart. ' + description"></canvas>
        </section>

        <section class="history-chart">
          <h3>Estimated hashrate</h3>
          <p class="muted small">
            The computing power the difficulty and pace of blocks imply
            (difficulty × 2<sup>32</sup> hashes per block). An estimate, not a
            measurement: miners set block times, which can be off by up to
            about two hours, so short periods are noisy.
          </p>
          <canvas id="hashrateChart" role="img" :aria-label="'Estimated hashrate chart. ' + description"></canvas>
        </section>

        <details class="chart-table">
          <summary>Show as a table ({{ formatNumber(series.length) }} periods)</summary>
          <p class="small">
            <a :href="csvUrl" download="assay-difficulty-history.csv">Download as CSV</a>
          </p>
          <div class="table-scroll">
            <table class="stack-sm">
              <thead>
                <tr>
                  <th>Period from</th>
                  <th class="num">First block</th>
                  <th class="num">Difficulty</th>
                  <th class="num">Avg. block time</th>
                  <th class="num">Est. hashrate</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in [...series].reverse()" :key="s.height">
                  <td data-label="Period from">{{ day(s.time) }}</td>
                  <td class="num" data-label="First block">
                    <router-link v-if="s.hash" :to="'/block/' + s.hash">{{ formatNumber(s.height) }}</router-link>
                    <span v-else>{{ formatNumber(s.height) }}</span>
                  </td>
                  <td class="num" data-label="Difficulty">{{ formatDifficultyShort(s.difficulty) }}</td>
                  <td class="num" data-label="Avg. block time">{{ s.interval ? (s.interval / 60).toFixed(1) + ' min' : 'in progress' }}</td>
                  <td class="num" data-label="Est. hashrate">{{ s.hashrate ? formatHashrate(s.hashrate) : '–' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

      </template>

    </div>

    <!-- LIVE MEMPOOL -->
    <div class="card">

      <h2>Mempool transaction count</h2>

      <p class="muted small">
        Sampled by this browser while this page is open, so gaps mean the
        page was closed, not that the mempool was quiet.
      </p>

      <data-status :status="status" what="mempool"></data-status>

      <provider-note v-if="history.length">
        the provider's mempool, as it reported it at each sample.
      </provider-note>

      <div v-if="!status.loading && history.length === 0" class="empty">
        No samples recorded yet.
      </div>

      <canvas id="mempoolCountChart" role="img" :aria-label="summary"></canvas>

    </div>

  </div>
  `,

  data() {
    return {
      history: [],
      status: createStatus(),

      tipHeight: null,
      tipError: '',
      offer: 0,
      progress: null,
      historyCheck: null,
      csvUrl: ''
    };
  },

  computed: {
    // The mempool chart's text alternative.
    summary() {
      const n = this.history.length;
      if (!n) return 'Mempool transaction count: no samples yet.';
      const last = this.history[n - 1];
      const counts = this.history.map(p => p.count);
      const fmt = x => x.toLocaleString('en-US');
      return `Mempool transaction count, ${n} samples from ${this.history[0].timestamp} ` +
        `to ${last.timestamp}: latest ${fmt(last.count)}, lowest ${fmt(Math.min(...counts))}, ` +
        `highest ${fmt(Math.max(...counts))}.`;
    },

    // Only from a passed difficulty-history check (verify.js never builds
    // a series from a failed one).
    series() {
      return this.historyCheck?.state === 'ok' ? this.historyCheck.series : null;
    },

    description() {
      return this.series ? describeSeries(this.series) : '';
    }
  },

  methods: {

    formatNumber,
    formatDifficultyShort,
    formatHashrate,
    day,

    // =================================================
    // VERIFIED HISTORY
    // =================================================

    async loadHistory() {
      try {
        this.tipHeight = await getTipHeight();
      } catch (err) {
        this.tipError = err?.kind === 'distrusted'
          ? 'Every data provider sent an invalid chain tip, so Assay has stopped asking them. See the Providers page.'
          : "Couldn't reach any Bitcoin data provider to find the newest block. Reload to try again.";
        return;
      }

      // Everything already saved (e.g. from "Add up the total work"):
      // no download, no question.
      const cached = await verifyDifficultyHistory(this.tipHeight, {
        tipHeight: this.tipHeight,
        cachedOnly: true
      });

      if (cached) {
        this.showResult(cached);
      } else if (headersOptedIn()) {
        this.run();
      } else {
        this.offer = historyHeaderCount(this.tipHeight);
      }
    },

    start() {
      optInToHeaders();
      this.offer = 0;
      this.run();
    },

    async run() {
      this.progress = { done: 0, total: historyHeaderCount(this.tipHeight) };

      const result = await verifyDifficultyHistory(this.tipHeight, {
        tipHeight: this.tipHeight,
        onProgress: (done, total) => { this.progress = { done, total }; }
      });

      if (!this.destroyed) this.showResult(result);
    },

    async showResult(result) {
      this.historyCheck = result;

      if (!this.series) return;

      URL.revokeObjectURL(this.csvUrl);
      this.csvUrl = URL.createObjectURL(new Blob([seriesCsv(this.series)], { type: 'text/csv' }));

      await nextTick();
      if (!this.destroyed) this.drawHistory();
    },

    drawHistory() {
      const points = pick => this.series
        .filter(s => pick(s) !== null)
        .map(s => ({ x: s.time * 1000, y: pick(s), height: s.height }));

      const first = this.series[0].time * 1000;
      const last = this.series[this.series.length - 1].time * 1000;

      const timeAxis = {
        type: 'linear',
        min: first,
        max: last,
        title: { display: true, text: 'Year' },
        afterBuildTicks: yearTicks,
        ticks: { callback: year }
      };

      const tooltipTitle = items => {
        const p = items[0].raw;
        return `${day(p.x / 1000)} · from block ${formatNumber(p.height)}`;
      };

      const line = (id, datasets, y, label) => markRaw(new Chart(document.getElementById(id), {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          // Wide on desktop so three charts fit without endless scrolling.
          aspectRatio: window.innerWidth > 700 ? 3 : 1.6,
          animation: false,
          parsing: false,
          normalized: true,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          plugins: {
            legend: { display: datasets.length > 1 },
            tooltip: { callbacks: { title: tooltipTitle, label } }
          },
          scales: { x: timeAxis, y }
        }
      }));

      const series = (data, extra = {}) => ({
        data,
        borderColor: '#4fc3f7',
        backgroundColor: '#4fc3f7',
        borderWidth: 1.5,
        pointRadius: 0,
        ...extra
      });

      this.historyCharts?.forEach(c => c.destroy());

      const intervals = points(s => (s.interval === null ? null : s.interval / 60));
      const span = intervals.length
        ? [intervals[0].x, intervals[intervals.length - 1].x]
        : [];

      this.historyCharts = [
        line(
          'difficultyChart',
          [series(points(s => s.difficulty), { label: 'Difficulty', stepped: true })],
          {
            type: 'logarithmic',
            title: { display: true, text: 'Difficulty (log)' },
            ticks: { callback: powerOfTenOnly(formatDifficultyShort) }
          },
          item => `Difficulty ${formatDifficultyShort(item.raw.y)}`
        ),

        line(
          'intervalChart',
          [
            series(intervals, { label: 'Average' }),
            {
              label: '10-minute target',
              data: span.map(x => ({ x, y: TARGET_MINUTES })),
              borderColor: '#ffb300',
              borderDash: [6, 4],
              borderWidth: 1.5,
              pointRadius: 0
            }
          ],
          // Fitted to the data (not from zero): the swings around the
          // target are the point; the dashed line marks 10 minutes.
          { title: { display: true, text: 'Minutes' } },
          item => item.datasetIndex === 1
            ? 'Target: 10 min'
            : `Average: ${item.raw.y.toFixed(1)} min`
        ),

        line(
          'hashrateChart',
          [series(points(s => s.hashrate), { label: 'Estimated hashrate' })],
          {
            type: 'logarithmic',
            title: { display: true, text: 'Hashes/s (log)' },
            ticks: { callback: powerOfTenOnly(formatHashrate) }
          },
          item => `About ${formatHashrate(item.raw.y)}`
        )
      ];
    },

    // =================================================
    // LIVE MEMPOOL
    // =================================================

    async loadMempoolData() {
      const mempool = await getMempool();

      const point = {
        timestamp: new Date().toLocaleTimeString(),
        count: mempool.count,
        vsize: mempool.vsize,
        total_fee: mempool.total_fee
      };

      this.history.push(point);

      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift();
      }

      await put('cache', {
        id: HISTORY_KEY,
        timestamp: Date.now(),
        data: JSON.parse(JSON.stringify(this.history))
      });

      return point;
    },

    updateChart() {
      if (!this.chart) {
        return;
      }

      this.chart.data.labels = this.history.map(p => p.timestamp);
      this.chart.data.datasets[0].data = this.history.map(p => p.count);
      this.chart.update();
    },

    createChart() {
      const ctx = document.getElementById('mempoolCountChart');

      this.chart = markRaw(
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              label: 'Pending transactions',
              data: [],
              borderColor: '#4fc3f7',
              backgroundColor: '#4fc3f7',
              pointRadius: 2
            }]
          },
          options: {
            responsive: true,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: 'Time sampled (your clock)' } },
              y: { title: { display: true, text: 'Pending transactions' } }
            }
          }
        })
      );
    }
  },

  async mounted() {
    this.createChart();
    this.loadHistory();

    const cached = await get('cache', HISTORY_KEY).catch(() => null);

    if (cached?.data) {
      this.history = cached.data;
      this.updateChart();
    }

    this.refresher = createSmartRefresher({
      cacheKey: 'mempool-chart-live',
      cacheTTL: CACHE_TTL.mempool,
      fetchFn: this.loadMempoolData,
      status: this.status,
      onUpdate: () => this.updateChart()
    });

    this.refresher.start();
  },

  unmounted() {
    this.destroyed = true;
    this.refresher?.stop();
    this.chart?.destroy();
    this.historyCharts?.forEach(c => c.destroy());
    URL.revokeObjectURL(this.csvUrl);
  }
};
