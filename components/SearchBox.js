// <search-box> / <search-box compact>
// Search by block height, block hash, txid, address or bitcoin: link.
// Input is checked before anything is sent (search.js). The full form sits
// on the home page; the compact one in the header of every other page.

import { ApiError, getBlockHash, tryGetBlock } from '../api.js';
import { classifyQuery } from '../search.js';
import { formatNumber } from '../format.js';

let nextId = 0;

export default {

  props: {
    compact: { type: Boolean, default: false }
  },

  data() {
    return {
      query: '',
      searching: false,
      error: '',
      errorId: 'search-error-' + (++nextId)
    };
  },

  template: `
  <div class="search-box" :class="{ 'search-compact': compact }">

    <form class="search" @submit.prevent="search" role="search">
      <input
        v-model="query"
        type="search"
        :placeholder="compact
          ? 'Search height, hash, txid or address'
          : 'Block height, block hash, transaction id or address'"
        aria-label="Search by block height, block hash, transaction id or address"
        :aria-invalid="error ? 'true' : null"
        :aria-describedby="error ? errorId : null"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        @input="error = ''"
        @keydown.esc="clear"
      >
      <button type="submit" :disabled="searching">
        {{ searching ? 'Searching…' : 'Search' }}
      </button>
    </form>

    <div v-if="error" :id="errorId" class="notice notice-error search-error" role="alert">
      {{ error }}
    </div>

  </div>
  `,

  methods: {

    clear() {
      this.query = '';
      this.error = '';
    },

    go(path) {
      this.query = '';
      this.$router.push(path);
    },

    async search() {
      const result = classifyQuery(this.query);

      this.error = '';

      if (result.type === 'invalid') {
        this.error = result.reason;
        return;
      }

      if (result.type === 'address') {
        this.go('/address/' + result.address);
        return;
      }

      if (result.type === 'hash' && !result.likelyBlock) {
        this.go('/tx/' + result.hash);
        return;
      }

      this.searching = true;

      try {
        if (result.type === 'height') {
          this.go('/block/' + await getBlockHash(result.height));
          return;
        }

        // Looks like a block hash; confirm before routing.
        const block = await tryGetBlock(result.hash);
        this.go((block ? '/block/' : '/tx/') + result.hash);

      } catch (err) {
        if (err instanceof ApiError && err.kind === 'not_found') {
          this.error = `There is no block at height ${formatNumber(result.height)} yet.`;
        } else if (err instanceof ApiError && err.kind === 'distrusted') {
          this.error =
            'Every data provider sent an invalid chain tip, so Assay has ' +
            'stopped asking them. See the Providers page.';
        } else {
          this.error =
            "Couldn't reach any Bitcoin data provider to look this up. " +
            'Please try again in a moment.';
        }
      } finally {
        this.searching = false;
      }
    }
  }
};
