import { getMempool } from '../api.js';

import {
  createSmartRefresher,
  createStatus,
  CACHE_TTL
} from '../refresh.js';

import { get, put } from '../db.js';

const { markRaw } = Vue;

const HISTORY_KEY = 'mempool-chart-history';
const HISTORY_LIMIT = 50;

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>Mempool Transaction Count</h2>

      <p class="muted small">
        Sampled by this browser while this page is open, so gaps mean the
        page was closed, not that the mempool was quiet.
      </p>

      <data-status :status="status" what="mempool"></data-status>

      <div v-if="!status.loading && history.length === 0" class="empty">
        No samples recorded yet.
      </div>

      <canvas id="mempoolCountChart"></canvas>

    </div>

  </div>
  `,

  data() {
    return {
      history: [],
      status: createStatus()
    };
  },

  methods: {

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
              label: 'Mempool TX Count',
              data: []
            }]
          },
          options: {
            responsive: true,
            animation: false
          }
        })
      );
    }
  },

  async mounted() {
    this.createChart();

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
    this.refresher?.stop();
    this.chart?.destroy();
  }
};
