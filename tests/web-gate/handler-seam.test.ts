import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'

/**
 * Handler-seam gate.
 *
 * Phase 1 gated each domain on a per-file `src/web/routes/<name>.ts`
 * binding that re-imported the matching `<name>-logic.ts` module.
 * Phase 3 collapsed those routes into a single typed dispatcher
 * (`src/web/server/dispatcher.ts`) that delegates to the
 * Postgres read/write executors. The shared/preload/main triple is
 * still load-bearing — the renderer call sites depend on it — so
 * those tests remain. The per-route reuse test became irrelevant
 * (there are no per-route files) and was replaced by the
 * dispatcher-existence check below.
 *
 * Intentionally-flat handlers (no domain-module pattern) are excluded
 * per AGENTS.md: shell, shortlist, system, updater.
 */

const SHARED_DIR = 'src/shared/ipc/domains'
const PRELOAD_DIR = 'src/preload/domains'
const MAIN_DIR = 'src/main/ipc/domains'
const DISPATCHER_PATH = 'src/web/server/dispatcher.ts'
const TASK_TYPES_PATH = 'src/web/server/task-types.ts'

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

  test('the web dispatcher and its task-type allowlist exist', () => {
    const dispatcher = resolve(process.cwd(), DISPATCHER_PATH)
    const taskTypes = resolve(process.cwd(), TASK_TYPES_PATH)
    const missing: string[] = []
    if (!existsSync(dispatcher)) missing.push(DISPATCHER_PATH)
    if (!existsSync(taskTypes)) missing.push(TASK_TYPES_PATH)
    expect(missing, missing.join('\n')).toEqual([])
  })
})

export { FLAT_HANDLERS }
