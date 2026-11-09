// <verify-badge :result="result" label="Proof of work">
// Shows the outcome of a check from verify.js, with a disclosure listing
// exactly what was checked. `result` null means the check is running.

export default {

  props: {
    result: { type: Object, default: null }
  },

  computed: {
    state() {
      return this.result ? this.result.state : 'pending';
    },

    icon() {
      return { ok: '✓', fail: '✗', error: '!', na: '–', pending: '…' }[this.state];
    },

    hasDetails() {
      const r = this.result;
      return !!r && (r.checks?.length || r.facts?.length || r.note);
    }
  },

  template: `
  <div class="verify" :class="'verify-' + state" role="status">

    <div class="verify-line">
      <span class="verify-icon" aria-hidden="true">{{ icon }}</span>
      <span class="verify-title">{{ result ? result.title : 'Verifying in your browser…' }}</span>
    </div>

    <slot></slot>

    <details v-if="hasDetails">
      <summary>What was checked</summary>

      <ul v-if="result.checks.length" class="verify-checks">
        <li v-for="c in result.checks" :key="c.label" :class="c.ok ? 'pos' : 'neg'">
          {{ c.ok ? '✓' : '✗' }} {{ c.label }}
        </li>
      </ul>

      <dl v-if="result.facts?.length" class="facts">
        <template v-for="f in result.facts" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd>{{ f.value }}</dd>
        </template>
      </dl>

      <p v-if="result.note" class="muted small">{{ result.note }}</p>
    </details>

  </div>
  `
};
