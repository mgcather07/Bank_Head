import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // prompt: the app shows "Update available · Refresh" (src/app/UpdatePrompt.tsx) instead of swapping code silently
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Stand Point',
        short_name: 'Stand Point',
        description: 'Terrain, wind, regulation and weather intelligence for Black Warrior, Choccolocco, Hollins and Oakmulgee WMAs, the National Forest and your own hunting land.',
        theme_color: '#08090c',
        background_color: '#08090c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,geojson,gz}'],
        // the Talladega WMAs' data packs download the first time you open that area, then stay cached for offline use
        globIgnores: ['**/data/choccolocco/**', '**/data/hollins/**', '**/data/oakmulgee/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Firebase's sign-in handler must come from the network, never the app shell
        navigateFallbackDenylist: [/^\/__\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /^\/data\/(choccolocco|hollins|oakmulgee)\//.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'area-data', expiration: { maxEntries: 200 } },
          },
          {
            // USGS basemap tiles: cache what the hunter has viewed for offline use
            urlPattern: /^https:\/\/basemap\.nationalmap\.gov\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'usgs-tiles', expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // lidar hillshade tiles viewed in the field
            urlPattern: /^https:\/\/elevation\.nationalmap\.gov\/arcgis\/rest\/services\/3DEPElevation\/ImageServer\/exportImage\?bbox=.*f=image$/,
            handler: 'CacheFirst',
            options: { cacheName: 'lidar-hillshade', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /^https:\/\/protomaps\.github\.io\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'map-fonts', expiration: { maxEntries: 50 } },
          },
          {
            // forecasts: network first; the app also keeps its own timestamped cache and labels stale data
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'open-meteo', networkTimeoutSeconds: 8, expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never)
