// <verify-summary :results="[headerCheck, difficultyCheck]">
// One line summing up every check on the page (summary.js), shown above
// the details. It is also the page's only live region for verification,
// so a screen reader hears one result instead of every badge.

import { summarizeChecks } from '../summary.js';

const ICONS = { ok: '✓', fail: '✗', error: '!', na: '–', pending: '…' };

export default {

  props: {
    results: { type: Array, required: true }
  },

  computed: {
    summary() {
      return summarizeChecks(this.results);
    },

    icon() {
      return ICONS[this.summary.state];
    }
  },

  template: `
  <div
    class="verify verify-summary"
    :class="'verify-' + summary.state"
    role="status"
    aria-live="polite"
  >
    <div class="verify-line">
      <span class="verify-icon" aria-hidden="true">{{ icon }}</span>
      <span class="verify-title">{{ summary.title }}</span>
    </div>
  </div>
  `
};
