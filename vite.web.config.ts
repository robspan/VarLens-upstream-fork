/**
 * Vite config for the web build target.
 *
 * Builds `src/web/server.ts` → `out/web/server.cjs`. Existence of that file
 * gates `tests/web-gate/integration/*.test.ts` (they `skipIf(!existsSync(...))`).
 *
 * Run via `npm run build:web` (composed into `npm run build`).
 *
 * Externals: Node-builtins and the better-sqlite3 native addon are kept
 * external — they're resolved at runtime, not bundled.
 */
import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    target: 'node24',
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    ssr: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/web/server.ts'),
      output: {
        entryFileNames: 'server.cjs',
        format: 'cjs'
      },
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'better-sqlite3-multiple-ciphers',
        'fastify',
        'pg',
        'pg-query-stream'
      ]
    },
    minify: false,
    sourcemap: true
  }
})
