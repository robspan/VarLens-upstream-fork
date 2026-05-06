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
import { defineConfig, type Plugin } from 'vite'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

/**
 * Map of desktop modules that import `electron` (directly or transitively)
 * to web-build stubs that match each module's public surface using only
 * Node builtins + console. Each entry is matched by a "ends with this
 * path" check after resolving the import to an absolute file path —
 * works for any depth of relative path the source happens to use.
 *
 * Why this exists: Rollup hoists static-arg requires even when they sit
 * inside a try/catch in source, so MainLogger's `require('electron')`
 * leaks into the web bundle's top level. After `npm prune --omit=dev`
 * electron is gone and the bundle won't load. Stubbing severs the
 * import graph at the right boundary.
 */
const WEB_STUBS: Record<string, string> = {
  '/main/services/MainLogger': resolve(__dirname, 'src/web/stubs/main-logger-stub.ts'),
  '/main/database/geneReferenceLoader': resolve(
    __dirname,
    'src/web/stubs/gene-reference-loader-stub.ts'
  )
}

function aliasDesktopModulesToWebStubs(): Plugin {
  return {
    name: 'web-build:alias-desktop-to-web-stubs',
    enforce: 'pre',
    async resolveId(source, importer) {
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (resolved === null) return null
      const id = resolved.id.replace(/\.[jt]sx?$/, '').replace(/\\/g, '/')
      for (const [ending, stubPath] of Object.entries(WEB_STUBS)) {
        if (id.endsWith(ending)) return stubPath
      }
      return null
    }
  }
}

export default defineConfig({
  plugins: [aliasDesktopModulesToWebStubs()],
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
