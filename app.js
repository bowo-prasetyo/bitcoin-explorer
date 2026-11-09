// Main application bootstrap

import router from './router.js';
import { initDB, pruneCache } from './db.js';
import DataStatus from './components/DataStatus.js';
import VerifyBadge from './components/VerifyBadge.js';

const App = {
  template: `
  <div>

    <header>
      <router-link to="/">Home</router-link>
      <router-link to="/charts">Charts</router-link>
      <router-link to="/providers">Providers</router-link>
    </header>

    <!-- Keyed on the full URL so moving between two blocks (or two pages
         of one block) remounts the view and loads the new data. -->
    <router-view :key="$route.fullPath"></router-view>

  </div>
  `
};

function showFatalError(err) {
  const box = document.createElement('div');
  box.style.cssText = 'padding:20px;font-family:Arial';

  const title = document.createElement('h2');
  title.textContent = 'Application failed to start';

  const detail = document.createElement('pre');
  detail.textContent = String(err?.message || err);

  box.append(title, detail);
  document.body.replaceChildren(box);
}

async function bootstrap() {
  try {
    await initDB();

    // Keep the local cache bounded; never block startup on it.
    pruneCache().catch(err => console.warn('Cache prune failed', err));

    const app = Vue.createApp(App);

    app.component('data-status', DataStatus);
    app.component('verify-badge', VerifyBadge);
    app.use(router);
    app.mount('#app');

  } catch (err) {
    console.error('Bootstrap failed', err);
    showFatalError(err);
  }
}

bootstrap();
