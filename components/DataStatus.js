// <data-status :status="status" what="transaction">
// Shows how current a piece of data is: loading, last updated, stale
// cache, or why it couldn't be loaded. Pair with createStatus() from
// refresh.js.

import { formatAgo } from '../format.js';

const { ref, computed } = Vue;

// One shared clock for every "x min ago" label; views import it too.
export const now = ref(Date.now());
setInterval(() => { now.value = Date.now(); }, 5000);

export default {

  props: {
    status: { type: Object, required: true },
    // Noun used in "not found" messages, e.g. "transaction".
    what: { type: String, default: 'data' }
  },

  setup(props) {
    const ago = computed(() =>
      props.status.updatedAt
        ? formatAgo(props.status.updatedAt, now.value)
        : ''
    );

    const notFound = computed(
      () => props.status.error?.kind === 'not_found'
    );

    const absoluteTime = computed(() =>
      props.status.updatedAt
        ? new Date(props.status.updatedAt).toLocaleString()
        : ''
    );

    return { ago, notFound, absoluteTime };
  },

  template: `
  <div class="data-status" role="status" aria-live="polite">

    <div v-if="status.error && notFound" class="notice notice-error">
      This {{ what }} was not found.
      <span class="muted">{{ status.error.message }}</span>
    </div>

    <div v-else-if="status.error && !status.updatedAt" class="notice notice-error">
      Couldn't reach any Bitcoin data provider. Retrying automatically.
    </div>

    <div v-else-if="status.error" class="notice notice-warn">
      Couldn't refresh. Showing data from
      <span :title="absoluteTime">{{ ago }}</span>.
    </div>

    <div v-else-if="status.loading" class="muted">
      Loading…
    </div>

    <div v-else-if="status.updatedAt" class="muted small">
      Updated <span :title="absoluteTime">{{ ago }}</span>
      <span v-if="status.cached"> (cached)</span>
      <span v-if="status.refreshing"> · refreshing…</span>
    </div>

  </div>
  `
};
