// Install state and service-worker updates.
import { registerSW } from 'virtual:pwa-register';

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

export function initPwa({ onStandalone } = {}) {
  if (isStandalone()) {
    document.documentElement.classList.add('is-standalone');
    onStandalone?.();
  }
  if (!('serviceWorker' in navigator)) return;
  // autoUpdate: a new version installs in the background and the page reloads
  // into it. All data is saved on every change, and a running workout reopens.
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // iPhone home-screen apps rarely re-check on their own: check whenever the
      // app comes to the front, and every 30 minutes while open.
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    },
  });
}
