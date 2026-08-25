import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'E-Trading — Crypto & Metals Price Alerts',
        short_name: 'E-Trading',
        description: "Elite Trading Alert System — set a price, get a message the second it's hit.",
        theme_color: '#0B0F14',
        background_color: '#0B0F14',
        display: 'standalone',
        start_url: '/dashboard',
        scope: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Live alert/price data goes over Firestore's own onSnapshot
        // websocket-ish channel and the Cloud Functions API — neither
        // should be served from a stale cache, so we only precache the
        // app shell (JS/CSS/HTML) and let data requests always hit the
        // network. This keeps "offline" meaning "app opens, data is
        // live once you're back online" rather than showing stale
        // alert prices.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
})
