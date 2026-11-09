import {
  benchmarkNodes,
  clearCustomProvider,
  getNodeHealth,
  getProviderSettings,
  normalizeEndpoint,
  setCustomProvider,
  testEndpoint
} from '../api.js';

import { verifyTip } from '../verify.js';

import { formatAgo } from '../format.js';

import { now } from './DataStatus.js';

export default {

  template: `
  <div class="container">

    <!-- WHO WE ASK -->
    <div class="card">

      <h2>Data providers</h2>

      <p class="muted">
        Lookups go to the providers below, best-ranked first; if one fails,
        the next is tried.
        <span v-if="settings.custom?.exclusive">
          You've chosen to use only your own endpoint, so nothing is sent to
          anyone else.
        </span>
      </p>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th class="num">Latency</th>
              <th class="num">OK / failed</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in health" :key="p.base">
              <td>
                {{ p.name }}
                <span v-if="p.preferred" class="tag tag-ok">preferred</span>
                <div class="small muted hash">{{ p.base }}</div>
                <div v-if="p.lastError" class="small neg">Last error: {{ p.lastError }}</div>
              </td>
              <td class="num">{{ p.latency === null ? '–' : p.latency + ' ms' }}</td>
              <td class="num">{{ p.success }} / {{ p.failure }}</td>
              <td>{{ p.lastSuccess ? ago(p.lastSuccess) : 'not yet' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="button-row" style="margin-top:12px">
        <button @click="checkAll" :disabled="checking">
          {{ checking ? 'Checking…' : 'Check all now' }}
        </button>
      </div>

    </div>

    <!-- DO THEY AGREE -->
    <div class="card">

      <h2>Do they agree?</h2>

      <p class="muted">
        Each provider is asked for its chain tip separately. Each tip's
        header is checked for proof of work, then the tips are compared.
      </p>

      <verify-badge :result="tipCheck"></verify-badge>

      <button @click="checkTip" :disabled="tipCheck === null">Check again</button>

    </div>

    <!-- BRING YOUR OWN -->
    <div class="card">

      <h2>Use your own endpoint</h2>

      <p class="muted">
        Point the explorer at an Esplora API you run or trust, such as
        <a href="https://github.com/Blockstream/electrs" rel="noopener" target="_blank">electrs</a>
        or a self-hosted mempool backend. It must allow cross-origin requests
        (<code>Access-Control-Allow-Origin</code>), and this page can only
        reach plain <code>http://</code> URLs on localhost or as a
        <code>.onion</code> address in Tor Browser.
      </p>

      <div v-if="settings.custom" class="notice notice-ok" style="margin-bottom:12px">
        Using <span class="hash">{{ settings.custom.base }}</span>
        {{ settings.custom.exclusive ? 'exclusively.' : 'first, with the public providers as fallback.' }}
      </div>

      <form class="provider-form" @submit.prevent="test">

        <input
          v-model="endpoint"
          placeholder="https://my-node.example/api"
          aria-label="Esplora API URL"
          autocomplete="off"
          spellcheck="false"
          @input="testResult = null; formError = ''"
        >

        <label>
          <input type="checkbox" v-model="exclusive">
          Use only my endpoint (don't send lookups to Blockstream or mempool.space)
        </label>

        <div class="button-row">
          <button type="submit" :disabled="testing || !endpoint">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
          <button type="button" @click="save" :disabled="!testResult?.ok">
            Save
          </button>
          <button type="button" v-if="settings.custom" @click="remove">
            Stop using my endpoint
          </button>
        </div>

      </form>

      <div v-if="formError" class="notice notice-error" style="margin-top:10px">
        {{ formError }}
      </div>

      <div v-else-if="testResult?.ok" class="notice notice-ok" style="margin-top:10px">
        Works: it reports block {{ testResult.height.toLocaleString('en-US') }}
        in {{ testResult.latency }} ms. Save to start using it.
      </div>

      <div v-else-if="testResult" class="notice notice-error" style="margin-top:10px">
        {{ testResult.error }}
      </div>

      <div v-if="saved" class="notice notice-ok" style="margin-top:10px">
        {{ saved }}
      </div>

    </div>

  </div>
  `,

  data() {
    return {
      health: getNodeHealth(),
      settings: getProviderSettings(),
      checking: false,

      tipCheck: null,

      endpoint: '',
      exclusive: false,
      testing: false,
      testResult: null,
      formError: '',
      saved: ''
    };
  },

  methods: {

    ago(ms) {
      return formatAgo(ms, now.value);
    },

    refreshHealth() {
      this.health = getNodeHealth();
      this.settings = getProviderSettings();
    },

    async checkAll() {
      this.checking = true;
      try {
        await benchmarkNodes();
      } finally {
        this.checking = false;
        this.refreshHealth();
      }
    },

    async checkTip() {
      this.tipCheck = null;
      this.tipCheck = await verifyTip();
      this.refreshHealth();
    },

    async test() {
      this.saved = '';
      this.formError = '';
      this.testResult = null;

      try {
        normalizeEndpoint(this.endpoint);
      } catch (err) {
        this.formError = err.message;
        return;
      }

      this.testing = true;
      try {
        this.testResult = await testEndpoint(this.endpoint);
        if (this.testResult.ok) {
          this.endpoint = this.testResult.base;
        }
      } finally {
        this.testing = false;
      }
    },

    save() {
      if (!this.testResult?.ok) {
        return;
      }

      setCustomProvider({ base: this.testResult.base, exclusive: this.exclusive });

      this.saved = this.exclusive
        ? 'Saved. All lookups now go only to your endpoint.'
        : 'Saved. Your endpoint is tried first from now on.';

      this.testResult = null;
      this.refreshHealth();
      this.checkTip();
    },

    remove() {
      clearCustomProvider();
      this.saved = 'Removed. Lookups go to the public providers again.';
      this.endpoint = '';
      this.exclusive = false;
      this.refreshHealth();
      this.checkTip();
    }
  },

  mounted() {
    const custom = this.settings.custom;

    if (custom) {
      this.endpoint = custom.base;
      this.exclusive = custom.exclusive;
    }

    this.checkTip();

    this.healthTimer = setInterval(() => this.refreshHealth(), 2000);
  },

  unmounted() {
    clearInterval(this.healthTimer);
  }
};
