import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Short commit id shown in Goals, so it's easy to tell which version a phone is running.
let commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!commit) { try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { commit = 'dev'; } }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(commit.slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/lib/pwa.js so updates apply on open
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
        // Activate a new version straight away instead of waiting for every
        // window to close (iPhone home-screen apps almost never fully close).
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
