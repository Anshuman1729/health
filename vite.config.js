import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        id: '/',
        name: 'PulseDaily',
        short_name: 'Pulse',
        description: 'Protein, calories, water, weight, habits and training.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // --bg token of the light theme; the page swaps <meta theme-color> to the
        // dark --bg (#0D0E12) at runtime when dark mode is on.
        background_color: '#E9ECF1',
        theme_color: '#E9ECF1',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell (HTML, JS, CSS, fonts, icons).
        globPatterns: ['**/*.{html,js,css,woff2,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
