// #/glossary: every term, the same text as docs/glossary.md.
// #/glossary?term=<id> scrolls to and highlights one term.

import { GLOSSARY, glossaryHtml } from '../glossary.js';

export default {

  data() {
    return { entries: GLOSSARY, selected: this.$route.query.term || '' };
  },

  template: `
  <div class="container">
    <div class="card">
      <h2>Glossary</h2>
      <p class="muted">Plain explanations of the terms Assay uses.</p>
      <dl class="glossary">
        <template v-for="e in entries" :key="e.id">
          <dt :id="'g-' + e.id" :class="{ selected: e.id === selected }">{{ e.term }}</dt>
          <dd :class="{ selected: e.id === selected }" v-html="html(e.text)"></dd>
        </template>
      </dl>
    </div>
  </div>
  `,

  methods: {
    html: glossaryHtml
  },

  mounted() {
    if (this.selected) {
      document.getElementById('g-' + this.selected)?.scrollIntoView({ block: 'center' });
    }
  }
};
