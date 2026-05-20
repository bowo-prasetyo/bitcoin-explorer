import { getMempool } from '../api.js';

import {
  createSmartRefresher
} from '../refresh.js';

import {
  get,
  put
} from '../db.js';

export default {

  template: `
  <div class="container">

    <div class="card">

      <h2>
        Mempool Visualization
      </h2>

      <canvas id="feeChart"></canvas>

    </div>

  </div>
  `,

  data() {

    return {

      chart: null,

      history: [],

      refresher: null
    };
  },

  methods: {

    // ===============================================
    // LOAD MEMPOOL DATA
    // ===============================================

    async loadMempoolData() {

      const mempool =
        await getMempool();

      const point = {

        timestamp:
          new Date()
            .toLocaleTimeString(),

        count:
          mempool.count,

        vsize:
          mempool.vsize,

        total_fee:
          mempool.total_fee
      };

      // Keep rolling history
      this.history.push({
      
        timestamp:
          point.timestamp,
      
        count:
          point.count,
      
        vsize:
          point.vsize,
      
        total_fee:
          point.total_fee
      
      });
            
      // Limit chart size
      if (this.history.length > 50) {

        this.history.shift();
      }

      // Persist history
      await put('cache', {

        id: 'mempool-chart-history',

        timestamp: Date.now(),

        data: this.history
      });

      return point;
    },

    // ===============================================
    // UPDATE CHART
    // ===============================================

    updateChart() {

      if (!this.chart) {
        return;
      }

      this.chart.data.labels =

        this.history.map(
          p => p.timestamp
        );

      this.chart.data.datasets[0].data =

        this.history.map(
          p => p.count
        );

      this.chart.update();
    },

    // ===============================================
    // CREATE CHART
    // ===============================================

    createChart() {

      const ctx =
        document
          .getElementById(
            'feeChart'
          );

      this.chart =
        new Chart(ctx, {

          type: 'line',

          data: {

            labels: [],

            datasets: [{

              label:
                'Mempool TX Count',

              data: []

            }]
          },

          options: {

            responsive: true,

            animation: false
          }
        });
    }
  },

  async mounted() {

    // ===============================================
    // CREATE CHART
    // ===============================================

    this.createChart();

    // ===============================================
    // LOAD HISTORY CACHE
    // ===============================================

    const cached =
      await get(
        'cache',
        'mempool-chart-history'
      );

    if (cached?.data) {

      this.history =
        cached.data;

      this.updateChart();
    }

    // ===============================================
    // START SMART REFRESH
    // ===============================================

    this.refresher =
      createSmartRefresher({

        cacheKey:
          'mempool-chart-live',

        cacheTTL:
          10000,

        fetchFn:
          this.loadMempoolData,

        onUpdate:
          (data, cached) => {

            this.updateChart();

            console.log(

              cached
                ? 'Chart from cache'
                : 'Chart from network'

            );
          }
      });

    this.refresher.start();
  },

  unmounted() {

    // Stop refresher

    if (this.refresher) {

      this.refresher.stop();
    }

    // Destroy chart properly

    if (this.chart) {

      this.chart.destroy();
    }
  }
};
