/**
 * Vite config for the web-mode browser bundle.
 *
 * Builds `src/web/index.html` + `src/web/bootstrap.ts` (which installs
 * the HTTP `window.api` Proxy and dynamic-imports the renderer entry).
 * Output: `out/web/public/`. Served by Fastify static + SPA fallback.
 *
 * The desktop renderer build lives in `electron.vite.config.ts` under
 * the `renderer:` key. This is its web sibling — same renderer source
 * tree, different transport, different entry HTML.
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { resolve } from 'node:path'

import pkg from './package.json'

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // Caddy mounts the app at /varlens/* and handle_paths strips the prefix.
  // The browser still loads index.html from /varlens/, so asset URLs and
  // API calls must include the prefix to hit Caddy correctly.
  base: '/varlens/',
  publicDir: resolve(__dirname, 'src/renderer/src/assets'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [vue(), vuetify({ autoImport: true })],
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, 'out/web/public'),
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: resolve(__dirname, 'src/web/index.html'),
      output: {
        manualChunks: {
          vuetify: ['vuetify'],
          zod: ['zod']
        }
      }
    }
  },
  server: {
    port: 5200,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:8787',
      '/healthz': 'http://localhost:8787'
    }
  }
})
