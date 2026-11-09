// Main application bootstrap

import router from './router.js';
import { initDB, pruneCache } from './db.js';
import DataStatus from './components/DataStatus.js';
import VerifyBadge from './components/VerifyBadge.js';
import { liveFeed, liveCandidates } from './live.js';
import { getProviderSettings } from './api.js';

// One shared, reactive copy of the live-update status for the header.
export const liveState = Vue.reactive({ status: 'off' });

const LIVE_LABELS = {
  live: ['● Live', 'Told about new blocks the moment they are found (WebSocket). Data is still fetched and verified the usual way.'],
  connecting: ['Connecting…', 'Opening the live-updates connection.'],
  unavailable: ['Polling', 'Live updates are unavailable right now, so the page checks for new blocks periodically.'],
  off: ['Polling', 'Checking for new blocks periodically.'],
  disabled: ['Polling', 'Live updates are turned off (Providers page).']
};

const App = {
  data() {
    return { live: liveState };
  },
  computed: {
    liveLabel() { return LIVE_LABELS[this.live.status][0]; },
    liveTitle() { return LIVE_LABELS[this.live.status][1]; }
  },
  template: `
  <div>

    <header>
      <router-link to="/">Home</router-link>
      <router-link to="/charts">Charts</router-link>
      <router-link to="/providers">Providers</router-link>
      <router-link
        to="/providers"
        class="live-indicator"
        :class="'live-' + live.status"
        :title="liveTitle"
      >{{ liveLabel }}</router-link>
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
  title.textContent = 'Assay failed to start';

  const detail = document.createElement('pre');
  detail.textContent = String(err?.message || err);

  box.append(title, detail);
  document.body.replaceChildren(box);
}

async function bootstrap() {
  try {
    await initDB();

    liveFeed.start({ getCandidates: () => liveCandidates(getProviderSettings()) });
    liveFeed.onStatus(status => { liveState.status = status; });

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
