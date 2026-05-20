import { getMempool } from '../api.js';
import { renderFeeChart } from '../charts.js';

export default {
  template: `
  <div class="container">
    <div class="card">
      <h2>Mempool Visualization</h2>

      <canvas id="feeChart"></canvas>
    </div>
  </div>
  `,

  async mounted() {
    const mempool = await getMempool();

    renderFeeChart(
      'feeChart',
      ['count', 'vsize', 'fees'],
      [
        mempool.count,
        mempool.vsize,
        mempool.total_fee
      ]
    );
  }
};
