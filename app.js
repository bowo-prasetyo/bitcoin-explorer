// Main application bootstrap

import router from './router.js';
import { initDB } from './db.js';

const App = {
  template: `
  <div>

    <header>
      <router-link to="/">Home</router-link>
      <router-link to="/charts">Charts</router-link>
    </header>

    <router-view></router-view>

  </div>
  `
};

async function bootstrap() {
  try {
    // Initialize IndexedDB
    await initDB();

    // Create Vue app
    const app = Vue.createApp(App);

    // Register router
    app.use(router);

    // Mount application
    app.mount('#app');

    console.log('Bitcoin Explorer initialized');

  } catch (err) {
    console.error('Bootstrap failed', err);

    document.body.innerHTML = `
      <div style="padding:20px;font-family:Arial">
        <h2>Application failed to start</h2>
        <pre>${err}</pre>
      </div>
    `;
  }
}

bootstrap();
