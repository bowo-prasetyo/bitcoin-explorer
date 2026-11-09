// <provider-note>Optional reason</provider-note>
// Marks data the browser shows as reported by a provider, without checking
// it. Verified data carries a <verify-badge>; everything else carries this,
// so an unchecked number never looks the same as a checked one.

export default {
  template: `
  <p class="provider-note small">
    <strong>Not verified:</strong>
    <slot>reported by the data provider; your browser can't check it.</slot>
  </p>
  `
};
