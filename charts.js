export function renderFeeChart(canvasId, labels, values) {
  const ctx = document.getElementById(canvasId);

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Fees',
        data: values
      }]
    }
  });
}
