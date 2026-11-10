// <glossary-term term="vb-wu">Size</glossary-term>
// A label with a dotted underline. Tapping it opens a short definition
// from the glossary (glossary.js) right there, so jargon such as "vB" or
// "Merkle" never needs a trip to the docs. Escape, a tap elsewhere or a
// second tap closes it.
//
// Keep it out of tables inside .table-scroll: their overflow would clip
// the popover.

import { glossaryEntry, glossaryHtml } from '../glossary.js';

let nextId = 0;

export default {

  props: {
    term: { type: String, required: true }
  },

  data() {
    return { open: false, shift: 0, popId: 'term-' + (++nextId) };
  },

  computed: {
    entry() {
      return glossaryEntry(this.term);
    },

    html() {
      return this.entry ? glossaryHtml(this.entry.text) : '';
    }
  },

  template: `
  <span class="term-wrap" v-if="entry">
    <button
      type="button"
      class="term"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="popId"
      @click="toggle"
    ><slot>{{ entry.term }}</slot></button>
    <span
      v-if="open"
      :id="popId"
      class="term-pop"
      role="note"
      :style="{ transform: shift ? 'translateX(' + shift + 'px)' : null }"
    >
      <!-- Vue drops whitespace between elements on separate lines. -->
      <strong>{{ entry.term }}:</strong>{{ ' ' }}<span v-html="html"></span>
      <router-link class="term-more" :to="{ path: '/glossary', query: { term } }">All terms</router-link>
    </span>
  </span>
  <slot v-else></slot>
  `,

  methods: {

    toggle() {
      this.open ? this.close() : this.show();
    },

    async show() {
      this.open = true;
      this.shift = 0;
      document.addEventListener('pointerdown', this.onOutside, true);
      document.addEventListener('keydown', this.onKey);

      // Keep the popover on screen when the term is near the right edge.
      await this.$nextTick();
      const pop = this.$el.querySelector?.('.term-pop');
      if (pop) {
        const overflow = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
        if (overflow > 0) this.shift = -overflow;
      }
    },

    close() {
      this.open = false;
      document.removeEventListener('pointerdown', this.onOutside, true);
      document.removeEventListener('keydown', this.onKey);
    },

    onOutside(event) {
      if (!this.$el.contains(event.target)) this.close();
    },

    // Escape closes it and puts focus back on the term.
    onKey(event) {
      if (event.key === 'Escape') {
        this.close();
        this.$el.querySelector?.('.term')?.focus();
      }
    }
  },

  unmounted() {
    this.close();
  }
};
