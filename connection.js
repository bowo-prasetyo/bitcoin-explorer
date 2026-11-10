// connection.js
// Online/offline state and the installable app, shared by the header and
// the views. The service worker (sw.js) is what makes the app open with no
// connection; this module registers it and tells the UI where things stand.

// navigator.onLine can claim "online" on a network that reaches nothing,
// but "offline" is reliable, and that's the case the UI words differently.
export const connection = Vue.reactive({
  online: navigator.onLine,
  // Set when the browser offers to install the app (Chromium-based
  // browsers); null elsewhere, e.g. Safari, which installs from its menu.
  installPrompt: null,
  installed: false
});

window.addEventListener('online', () => { connection.online = true; });
window.addEventListener('offline', () => { connection.online = false; });

window.addEventListener('beforeinstallprompt', event => {
  // Keep it for the "Install app" button instead of the browser's own bar.
  event.preventDefault();
  connection.installPrompt = Vue.markRaw(event);
});

window.addEventListener('appinstalled', () => {
  connection.installPrompt = null;
  connection.installed = true;
});

// Running as the installed app rather than in a browser tab.
export function runningInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    navigator.standalone === true; // iOS
}

export async function installApp() {
  const prompt = connection.installPrompt;
  if (!prompt) return false;
  connection.installPrompt = null; // each prompt can be used once
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
}

// Registered after the app has started, so it never slows the first view.
// Service workers need https (or localhost); elsewhere the app simply runs
// online-only, as before.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  navigator.serviceWorker
    .register('sw.js', { scope: './' })
    .catch(err => console.warn('Offline support unavailable:', err));
}
