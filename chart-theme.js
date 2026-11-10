// chart-theme.js
// Chart.js draws on a canvas and can't read CSS variables, so charts take
// their colours from the active palette (styles.css, via theme.js) here,
// and are redrawn when the theme changes.

const FALLBACK = {
  '--chart-1': '#4fc3f7',
  '--chart-target': '#ffb300',
  '--chart-text': '#bdbdbd',
  '--chart-grid': '#333'
};

function read(name) {
  return window.AssayTheme?.color(name) || FALLBACK[name];
}

// A Chart.js scriptable option: resolved again every time a chart is
// drawn, so a theme change only needs chart.update().
export function chartColor(name) {
  return () => read(name);
}

function applyDefaults() {
  // Chart.js defaults to #666 text, about 3:1 on dark cards.
  Chart.defaults.color = read('--chart-text');
  Chart.defaults.borderColor = read('--chart-grid');
}

export function styleCharts() {
  if (typeof Chart === 'undefined') return;

  Chart.defaults.font.size = 13;
  applyDefaults();

  window.AssayTheme?.onChange(() => {
    applyDefaults();
    Object.values(Chart.instances).forEach(chart => {
      // Axis and legend colours were resolved from the defaults when the
      // chart was built; point them at the new ones.
      for (const scale of Object.values(chart.options.scales || {})) {
        if (scale.ticks) scale.ticks.color = Chart.defaults.color;
        if (scale.title) scale.title.color = Chart.defaults.color;
        if (scale.grid) scale.grid.color = Chart.defaults.borderColor;
      }
      if (chart.options.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = Chart.defaults.color;
      }
      chart.update('none');
    });
  });
}
