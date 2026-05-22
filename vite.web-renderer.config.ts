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

function normalizeBase(value: string | undefined): string {
  const raw = value?.trim()
  if (raw === undefined || raw === '') return '/varlens/'
  if (raw === '/') return '/'
  const withLeading = raw.startsWith('/') ? raw : '/' + raw
  return withLeading.endsWith('/') ? withLeading : withLeading + '/'
}

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // Reverse proxies may mount the app under a path prefix such as /varlens.
  // The browser still loads index.html from that prefix, so asset URLs and
  // API calls must include it. This build-time value must match the server's
  // runtime APP_PATH_PREFIX. Local web-dev overrides both values to `/`.
  base: normalizeBase(process.env.VARLENS_WEB_BASE),
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
