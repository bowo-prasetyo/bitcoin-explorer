// Main application bootstrap

import router from './router.js';
import { initDB } from './db.js';
import DataStatus from './components/DataStatus.js';

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

function showFatalError(err) {
  const box = document.createElement('div');
  box.style.cssText = 'padding:20px;font-family:Arial';

  const title = document.createElement('h2');
  title.textContent = 'Application failed to start';

  const detail = document.createElement('pre');
  detail.textContent = String(err?.message || err);

  box.append(title, detail);
  document.body.replaceChildren(box);
}

async function bootstrap() {
  try {
    await initDB();

    const app = Vue.createApp(App);

    app.component('data-status', DataStatus);
    app.use(router);
    app.mount('#app');

  } catch (err) {
    console.error('Bootstrap failed', err);
    showFatalError(err);
  }
}

bootstrap();
