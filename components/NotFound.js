// Any URL no route matches, e.g. a mistyped or truncated link.

export default {
  template: `
  <div class="container">
    <div class="card">
      <h2>Page not found</h2>
      <p class="muted">
        Nothing lives at <span class="hash">#{{ $route.fullPath }}</span>.
        The link may be mistyped or cut short. Use the search box at the
        top to find what you were looking for, or
        <router-link to="/">go to the home page</router-link>.
      </p>
    </div>
  </div>
  `
};
