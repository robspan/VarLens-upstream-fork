import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'

/**
 * Phase 1 gate — the IPC contract layer (`src/shared/ipc/domains/`) is the
 * "natural seam" for the web migration. Each domain must have a triple:
 *   1. shared contract:  src/shared/ipc/domains/<name>.ts
 *   2. preload binding:  src/preload/domains/<name>.ts
 *   3. main handler:     src/main/ipc/domains/<name>.ts
 *
 * Once `src/web/routes/<name>.ts` exists, that file must reuse the SAME
 * handler function as the main IPC registration — not a re-implementation.
 * This is the structural rule that prevents the web side from drifting
 * from the desktop side at the seam.
 *
 * Intentionally-flat handlers (no domain-module pattern) are excluded
 * per AGENTS.md: shell, shortlist, system, updater.
 */

const SHARED_DIR = 'src/shared/ipc/domains'
const PRELOAD_DIR = 'src/preload/domains'
const MAIN_DIR = 'src/main/ipc/domains'
const WEB_DIR = 'src/web/routes'

const FLAT_HANDLERS = new Set(['shell', 'shortlist', 'system', 'updater'])

function listDomains(dir: string): string[] {
  const abs = resolve(process.cwd(), dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .filter((f) => statSync(resolve(abs, f)).isFile())
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
}

describe('handler-seam gate', () => {
  test('every shared IPC domain has a preload binding and a main handler', () => {
    const shared = listDomains(SHARED_DIR)
    const preload = new Set(listDomains(PRELOAD_DIR))
    const main = new Set(listDomains(MAIN_DIR))

    expect(shared.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const domain of shared) {
      if (!preload.has(domain)) missing.push(`${PRELOAD_DIR}/${domain}.ts (missing)`)
      if (!main.has(domain)) missing.push(`${MAIN_DIR}/${domain}.ts (missing)`)
    }

    expect(missing, missing.join('\n')).toEqual([])
  })

  test('preload domain set matches shared domain set (no orphans)', () => {
    const shared = new Set(listDomains(SHARED_DIR))
    const preload = listDomains(PRELOAD_DIR)
    const orphans = preload.filter((d) => !shared.has(d))
    expect(orphans, `preload binding without shared contract: ${orphans.join(', ')}`).toEqual([])
  })

  test('main domain set matches shared domain set (no orphans)', () => {
    const shared = new Set(listDomains(SHARED_DIR))
    const main = listDomains(MAIN_DIR)
    const orphans = main.filter((d) => !shared.has(d))
    expect(orphans, `main domain without shared contract: ${orphans.join(', ')}`).toEqual([])
  })

  test.skipIf(!existsSync(resolve(process.cwd(), WEB_DIR)))(
    'every web route file imports from the corresponding main IPC handler / logic module',
    async () => {
      const { readFileSync } = await import('fs')
      const webRoutes = listDomains(WEB_DIR)
      expect(webRoutes.length).toBeGreaterThan(0)

      const violations: string[] = []
      for (const domain of webRoutes) {
        const file = resolve(process.cwd(), WEB_DIR, `${domain}.ts`)
        const source = readFileSync(file, 'utf8')

        // Acceptable seam imports: the per-domain logic module or the
        // per-domain handler module from src/main/ipc/handlers/.
        const reusesLogic =
          source.includes(`from '../../main/ipc/handlers/${domain}-logic'`) ||
          source.includes(`from '../../main/ipc/handlers/${domain}'`)

        if (!reusesLogic) {
          violations.push(
            `${WEB_DIR}/${domain}.ts must import from src/main/ipc/handlers/${domain}-logic ` +
              `(or src/main/ipc/handlers/${domain}). Reuse the same function — do not re-implement.`
          )
        }
      }

      expect(violations, violations.join('\n')).toEqual([])
    }
  )
})

export { FLAT_HANDLERS }
