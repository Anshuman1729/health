// Install-state helpers. The service worker itself is generated and
// registered by vite-plugin-pwa (see vite.config.js).

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function initPwa({ onStandalone } = {}) {
  if (isStandalone()) {
    document.documentElement.classList.add('is-standalone');
    onStandalone?.();
  }
}
