import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'

/**
 * Handler-seam gate.
 *
 * The web dispatcher is split into per-domain route override modules.
 * This gate keeps those modules wired through dispatcher.ts and prevents
 * route handlers from reaching around storage executors into Postgres.
 *
 * Intentionally-flat handlers (no domain-module pattern) are excluded
 * per AGENTS.md: shell, shortlist, system, updater.
 */

const SHARED_DIR = 'src/shared/ipc/domains'
const PRELOAD_DIR = 'src/preload/domains'
const MAIN_DIR = 'src/main/ipc/domains'
const DISPATCHER_PATH = 'src/web/server/dispatcher.ts'
const TASK_TYPES_PATH = 'src/web/server/task-types.ts'
const WEB_ROUTES_DIR = 'src/web/server/routes'

const FLAT_HANDLERS = new Set(['shell', 'shortlist', 'system', 'updater'])
const SHARED_DOMAIN_HELPERS = new Set(['import-schemas'])
const ROUTE_OVERRIDE_LOGIC_EXCEPTIONS: Record<string, string> = {
  'analysis-groups.ts': 'thin storage-executor adapters with web-only argument validation',
  'annotations.ts': 'thin storage-executor adapters with web-only argument validation',
  'auth.ts': 'web-only session cookie/auth boundary backed by PostgresWebAuthService',
  'case-metadata.ts': 'thin storage-executor adapters with web-only argument validation',
  'cases.ts': 'simple cases:list storage read adapter',
  'cohort.ts': 'cohort route adapters plus explicit unsupported web methods',
  'database.ts': 'web-only database identity/capability adapters',
  'gene-lists.ts': 'thin storage-executor adapters with web-only argument validation',
  'gene-ref.ts': 'web mode intentionally disables external reference fetches',
  'hpo.ts': 'web mode intentionally disables external reference fetches',
  'panels.ts': 'thin storage-executor adapters with web-only argument validation',
  'protein.ts': 'web mode intentionally disables external reference fetches',
  'region-files.ts': 'web-only server-path guards and storage-executor adapters',
  'transcripts.ts': 'thin storage-executor adapters with web-only argument validation',
  'vep.ts': 'web mode intentionally disables external reference fetches'
}

function listDomains(dir: string): string[] {
  const abs = resolve(process.cwd(), dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .filter((f) => statSync(resolve(abs, f)).isFile())
    .map((f) => f.replace(/\.ts$/, ''))
    .filter((domain) => !SHARED_DOMAIN_HELPERS.has(domain))
    .sort()
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
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

  test('web route override modules are imported by the dispatcher', () => {
    const dispatcherSource = readRepoFile(DISPATCHER_PATH)
    const routeDir = resolve(process.cwd(), WEB_ROUTES_DIR)
    const missing: string[] = []

    for (const file of readdirSync(routeDir)
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      const source = readRepoFile(routePath)
      const buildFunction = source.match(/export function (build[A-Za-z]+Overrides)\(/)?.[1]
      if (buildFunction === undefined) continue

      const routeName = file.replace(/\.ts$/, '')
      if (!dispatcherSource.includes(`from './routes/${routeName}'`)) {
        missing.push(`${routePath} import`)
      }
      if (!dispatcherSource.includes(`${buildFunction}()`)) {
        missing.push(`${routePath} ${buildFunction}()`)
      }
    }

    expect(missing, missing.join('\n')).toEqual([])
  })

  test('web route override modules do not access Postgres directly', () => {
    const routeDir = resolve(process.cwd(), WEB_ROUTES_DIR)
    const offenders: string[] = []
    const forbidden = [
      /'pg'/,
      /"pg"/,
      /getPool\s*\(/,
      /pool\.query/,
      /pool\.connect/,
      /quoteIdentifier/
    ]

    for (const file of readdirSync(routeDir)
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      const source = readRepoFile(routePath)
      if (forbidden.some((pattern) => pattern.test(source))) offenders.push(routePath)
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  test('web route override modules use shared logic or audited exceptions', () => {
    const routeDir = resolve(process.cwd(), WEB_ROUTES_DIR)
    const offenders: string[] = []

    for (const file of readdirSync(routeDir)
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      const routePath = `${WEB_ROUTES_DIR}/${file}`
      const source = readRepoFile(routePath)
      if (!/export function build[A-Za-z]+Overrides\(/.test(source)) continue
      if (/handlers\/[A-Za-z0-9-]+-logic/.test(source)) continue
      if (ROUTE_OVERRIDE_LOGIC_EXCEPTIONS[file] !== undefined) continue
      offenders.push(`${routePath} (missing shared *-logic import or audited exception)`)
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

export { FLAT_HANDLERS }
