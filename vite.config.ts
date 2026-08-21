import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      // Registration is performed manually from src/pwa.ts in production only.
      injectRegister: null,
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        // iOS reads this one when adding the app to the home screen.
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'PeeCare 寵物尿量監測',
        short_name: 'PeeCare',
        description: 'PeeCare 寵物尿量監測應用殼',
        lang: 'zh-TW',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f5f0',
        theme_color: '#166554',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            // Separate artwork: the paws sit inside the 80% safe zone so
            // Android's adaptive mask never clips them.
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          ...(['GET', 'POST'] as const).map((method) => ({
            urlPattern:
              /^https:\/\/(?:identitytoolkit|securetoken|firestore)\.googleapis\.com\//,
            handler: 'NetworkOnly' as const,
            method,
          })),
          {
            urlPattern: /^https:\/\/accounts\.google\.com\//,
            handler: 'NetworkOnly',
            method: 'GET',
          },
          ...(['GET', 'POST', 'PATCH', 'DELETE'] as const).map((method) => ({
            urlPattern: /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app\//,
            handler: 'NetworkOnly' as const,
            method,
          })),
        ],
      },
      // Never run the service worker during development or unit tests.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
