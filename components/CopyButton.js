// <copy-button :text="txid" what="transaction id">
// Copies a long value (hash, txid, address) so nobody has to select 64
// characters by hand on a phone.

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through: blocked, or not a secure context
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export default {

  props: {
    text: { type: String, required: true },
    what: { type: String, default: 'value' }
  },

  data() {
    return { state: 'idle' };
  },

  computed: {
    label() {
      return { idle: 'Copy', copied: 'Copied', failed: "Couldn't copy" }[this.state];
    }
  },

  template: `
  <span class="copy-wrap">
    <button
      type="button"
      class="copy-button"
      :class="'copy-' + state"
      :aria-label="'Copy ' + what"
      :title="'Copy ' + what"
      @click="copy"
    >{{ label }}</button>
    <span class="visually-hidden" role="status">{{ state === 'idle' ? '' : label }}</span>
  </span>
  `,

  methods: {
    async copy() {
      this.state = (await copyText(this.text)) ? 'copied' : 'failed';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.state = 'idle'; }, 2000);
    }
  },

  unmounted() {
    clearTimeout(this.timer);
  }
};
