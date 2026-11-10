// Main application bootstrap

import router from './router.js';
import { initDB, pruneCache } from './db.js';
import DataStatus from './components/DataStatus.js';
import VerifyBadge from './components/VerifyBadge.js';
import ProviderNote from './components/ProviderNote.js';
import SearchBox from './components/SearchBox.js';
import CopyButton from './components/CopyButton.js';
import VerifySummary from './components/VerifySummary.js';
import GlossaryTerm from './components/GlossaryTerm.js';
import { liveFeed, liveCandidates } from './live.js';
import { getProviderSettings } from './api.js';
import { connection, installApp, registerServiceWorker, runningInstalled } from './connection.js';

// One shared, reactive copy of the live-update status for the header.
export const liveState = Vue.reactive({ status: 'off' });

const LIVE_LABELS = {
  live: ['● Live', 'Told about new blocks the moment they are found (WebSocket). Data is still fetched and verified the usual way.'],
  connecting: ['Connecting…', 'Opening the live-updates connection.'],
  unavailable: ['Polling', 'Live updates are unavailable right now, so the page checks for new blocks periodically.'],
  off: ['Polling', 'Checking for new blocks periodically.'],
  disabled: ['Polling', 'Live updates are turned off (Providers page).']
};

// The docs live in the repository, next to the code they describe.
const REPO_URL = 'https://github.com/bowo-prasetyo/bitcoin-explorer';
const HELP_URL = REPO_URL + '/blob/main/docs/user-guide.md';
const VERIFICATION_URL = REPO_URL + '/blob/main/docs/verification.md';

const App = {
  data() {
    return {
      live: liveState,
      connection,
      standalone: runningInstalled(),
      HELP_URL,
      VERIFICATION_URL,
      REPO_URL
    };
  },
  computed: {
    // The home page has its own, larger search box.
    showHeaderSearch() { return this.$route.path !== '/'; },
    // The browser can install Assay, and it isn't already running installed.
    canInstall() { return !!this.connection.installPrompt && !this.standalone; },
    liveLabel() { return LIVE_LABELS[this.live.status][0]; },
    liveTitle() { return LIVE_LABELS[this.live.status][1]; }
  },
  methods: {
    installApp
  },
  template: `
  <div>

    <header>
      <router-link to="/" class="brand" aria-label="Assay home">
        <img src="brand/assay-logo.svg" alt="Assay" width="90" height="24">
      </router-link>
      <search-box v-if="showHeaderSearch" compact class="header-search"></search-box>
      <router-link to="/charts">Charts</router-link>
      <router-link to="/providers">Providers</router-link>
      <a :href="HELP_URL" target="_blank" rel="noopener">Help</a>
      <router-link
        to="/providers"
        class="live-indicator"
        :class="'live-' + live.status"
        :title="liveTitle"
      >{{ liveLabel }}</router-link>
    </header>

    <div v-if="!connection.online" class="offline-banner" role="status">
      You're offline. Assay shows the pages you opened before, as they were
      then; their age is shown on each.
    </div>

    <!-- Keyed on the full URL so moving between two blocks (or two pages
         of one block) remounts the view and loads the new data. -->
    <router-view :key="$route.fullPath"></router-view>

    <footer>
      <router-link to="/glossary">Glossary</router-link>
      <a :href="HELP_URL" target="_blank" rel="noopener">User guide</a>
      <a :href="VERIFICATION_URL" target="_blank" rel="noopener">What gets verified</a>
      <a :href="REPO_URL" target="_blank" rel="noopener">Source</a>
      <button v-if="canInstall" type="button" class="link-button" @click="installApp">Install app</button>
    </footer>

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

// Chart.js defaults to #666 text, about 3:1 on these cards. Readable
// text and quiet grid lines for every chart.
function styleCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#bdbdbd';
  Chart.defaults.borderColor = '#333';
  Chart.defaults.font.size = 13;
}

async function bootstrap() {
  try {
    styleCharts();

    await initDB();

    liveFeed.start({ getCandidates: () => liveCandidates(getProviderSettings()) });
    liveFeed.onStatus(status => { liveState.status = status; });

    // Keep the local cache bounded; never block startup on it.
    pruneCache().catch(err => console.warn('Cache prune failed', err));

    const app = Vue.createApp(App);

    app.component('data-status', DataStatus);
    app.component('verify-badge', VerifyBadge);
    app.component('provider-note', ProviderNote);
    app.component('search-box', SearchBox);
    app.component('copy-button', CopyButton);
    app.component('verify-summary', VerifySummary);
    app.component('glossary-term', GlossaryTerm);
    app.use(router);
    app.mount('#app');

    registerServiceWorker();

  } catch (err) {
    console.error('Bootstrap failed', err);
    showFatalError(err);
  }
}

bootstrap();
