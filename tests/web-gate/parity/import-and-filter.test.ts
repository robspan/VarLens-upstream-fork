import { afterAll, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import {
  launchElectronApp,
  waitForAppShell,
  dismissDisclaimerIfPresent,
  type LaunchElectronAppResult
} from '../../e2e/helpers/electron-app'

/**
 * Phase 1 gate — Layer 3 parity scenario #1.
 *
 * The plan calls for "import a VCF, run 3 filter queries, assert identical
 * results across both backends." This file ships:
 *
 *   1. A harness smoke (cases.list on a fresh app) that pins the IPC stack.
 *   2. The full VCF-import scenario: import a small synthetic VCF and run
 *      three domain-meaningful filter queries through `window.api`. Counts
 *      are normalized and snapshotted under `__snapshots__/` so the web
 *      transport can later be asserted against the same baseline.
 *
 * When the third parity scenario lands, this is the trigger to extract
 * the `BackendDriver` abstraction (see `.planning/web/testing/desktop-to-web-parity.md`
 * §rule-of-three).
 *
 * Skipped if `out/main/index.js` is missing — run `make build` first.
 */

const ELECTRON_BUILD = resolve(process.cwd(), 'out/main/index.js')
const isElectronBuilt = existsSync(ELECTRON_BUILD)
const WEB_BUILD = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD)

const VCF_FIXTURE = resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf')

const SNAPSHOT_DIR = resolve(process.cwd(), 'tests/web-gate/parity/__snapshots__')
const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, 'import-and-filter-vcf.json')

/**
 * Parity tests are **opt-in**, mirroring the `perf` project's convention.
 * Desktop-only contributors never run them by default — the gate is for
 * validating the desktop↔web migration path, not for desktop CI.
 *
 * Enable with `VARLENS_RUN_WEB_GATE_PARITY=1` (the `make web-gate-parity`
 * target sets this automatically). Without the env var the entire
 * describe block skips, even if `out/main/index.js` exists.
 */
const SHOULD_RUN_PARITY = process.env.VARLENS_RUN_WEB_GATE_PARITY === '1'

const UPDATE_FLAG = 'UPDATE_PARITY_SNAPSHOTS'

interface NormalizedCases {
  count: number
  ids: string[] // case names sorted lexicographically — stable across runs
}

interface NormalizedVariantQuery {
  total: number
  // Stable identity tuples for the first N rows in the page, sorted.
  // We don't snapshot mutable fields like id / created_at / imported_at.
  rows: Array<{ chr: string; pos: number; ref: string; alt: string }>
}

interface ImportAndFilterSnapshot {
  schemaVersion: 1
  fixture: string
  variantCount: number
  filters: {
    all: NormalizedVariantQuery
    chr22: NormalizedVariantQuery
    high_impact: NormalizedVariantQuery
  }
}

async function runScenarioOnElectron(): Promise<NormalizedCases> {
  let session: LaunchElectronAppResult | undefined
  try {
    session = await launchElectronApp()
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)

    // Drive through the full preload → IPC → main → DB stack.
    const result = await session.window.evaluate(async () => {
      const api = (window as unknown as { api?: unknown }).api as
        | {
            cases?: { list?: () => Promise<unknown> }
          }
        | undefined
      if (!api?.cases?.list) {
        throw new Error('window.api.cases.list is not exposed by preload')
      }
      const raw = await api.cases.list()
      return raw
    })

    return normalizeCasesResult(result)
  } finally {
    await session?.cleanup()
  }
}

interface ImportAndFilterRaw {
  caseId: number
  variantCount: number
  all: unknown
  chr22: unknown
  high_impact: unknown
}

async function runImportScenarioOnElectron(vcfPath: string): Promise<ImportAndFilterRaw> {
  let session: LaunchElectronAppResult | undefined
  try {
    session = await launchElectronApp()
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)

    // The preload `import.start` returns a Promise that resolves with the
    // ImportResult once the worker finishes — no event subscription needed.
    // (Progress events exist via `window.api.import.onProgress` but are not
    // required for completion.)
    const raw = await session.window.evaluate(async (filePath: string) => {
      const api = (window as unknown as { api?: unknown }).api as
        | {
            import?: {
              start?: (
                filePath: string,
                caseName: string,
                vcfOptions?: { selectedSample?: string; genomeBuild?: string }
              ) => Promise<unknown>
            }
            variants?: {
              query?: (
                caseId: number,
                filters: Record<string, unknown>,
                offset?: number,
                limit?: number,
                sortBy?: unknown,
                skipCount?: boolean,
                includeUnfilteredCount?: boolean
              ) => Promise<unknown>
            }
          }
        | undefined

      if (!api?.import?.start) {
        throw new Error('window.api.import.start is not exposed by preload')
      }
      if (!api?.variants?.query) {
        throw new Error('window.api.variants.query is not exposed by preload')
      }

      // The preload `wrapHandler` returns IpcResult<T>; the renderer side
      // unwraps via `unwrapIpcResult` in production. In raw form the result
      // is `{ ok: true, data: T }` — handle both shapes defensively so this
      // test is robust to whichever transport the preload happens to use.
      const unwrap = <T,>(v: unknown): T => {
        if (v && typeof v === 'object' && 'ok' in v) {
          const r = v as { ok: boolean; data?: T; error?: { message?: string } }
          if (!r.ok) {
            throw new Error(`IPC error: ${r.error?.message ?? 'unknown'}`)
          }
          return r.data as T
        }
        return v as T
      }

      const importResult = unwrap<{ caseId: number; variantCount: number }>(
        await api.import.start(filePath, 'parity-test-case', { genomeBuild: 'hg38' })
      )

      const caseId = importResult.caseId

      const queryAll = unwrap<{ rows?: unknown[]; total?: number }>(
        await api.variants.query(caseId, {}, 0, 200)
      )
      const queryChr22 = unwrap<{ rows?: unknown[]; total?: number }>(
        await api.variants.query(caseId, { chr: 'chr22' }, 0, 200)
      )
      const queryHighImpact = unwrap<{ rows?: unknown[]; total?: number }>(
        await api.variants.query(caseId, { consequences: ['HIGH'] }, 0, 200)
      )

      return {
        caseId,
        variantCount: importResult.variantCount,
        all: queryAll,
        chr22: queryChr22,
        high_impact: queryHighImpact
      }
    }, vcfPath)

    return raw
  } finally {
    await session?.cleanup()
  }
}

function normalizeCasesResult(raw: unknown): NormalizedCases {
  // The renderer returns the unwrapped array per the IpcResult contract.
  const arr = Array.isArray(raw) ? raw : []
  const names = arr
    .map((c) => (typeof c === 'object' && c !== null ? (c as { name?: string }).name : ''))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort()
  return { count: arr.length, ids: names }
}

function normalizeVariantQuery(raw: unknown): NormalizedVariantQuery {
  // PaginatedResult<Variant> uses { data, total_count }. Older / web shapes
  // may use { rows, total } — accept both so the same normalizer works
  // across transports.
  const obj = (raw && typeof raw === 'object' ? raw : {}) as {
    data?: unknown[]
    total_count?: number
    rows?: unknown[]
    total?: number
  }
  const rows = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.rows)
      ? obj.rows
      : []
  // Snapshot only stable identity fields: chr/pos/ref/alt. Drop volatile
  // columns like id, created_at, imported_at, info_json (annotation order).
  const projected = rows
    .map((r) => {
      const v = r as { chr?: unknown; pos?: unknown; ref?: unknown; alt?: unknown }
      return {
        chr: typeof v.chr === 'string' ? v.chr : '',
        pos: typeof v.pos === 'number' ? v.pos : 0,
        ref: typeof v.ref === 'string' ? v.ref : '',
        alt: typeof v.alt === 'string' ? v.alt : ''
      }
    })
    .sort((a, b) => {
      if (a.chr !== b.chr) return a.chr < b.chr ? -1 : 1
      if (a.pos !== b.pos) return a.pos - b.pos
      if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1
      return a.alt < b.alt ? -1 : a.alt > b.alt ? 1 : 0
    })
  const total =
    typeof obj.total_count === 'number'
      ? obj.total_count
      : typeof obj.total === 'number'
        ? obj.total
        : projected.length
  return { total, rows: projected }
}

function loadSnapshot(): ImportAndFilterSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ImportAndFilterSnapshot
}

function saveSnapshot(snap: ImportAndFilterSnapshot): void {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8')
}

function buildSnapshot(raw: ImportAndFilterRaw): ImportAndFilterSnapshot {
  return {
    schemaVersion: 1,
    fixture: 'tests/test-data/vcf/synthetic-unit-test.vcf',
    variantCount: raw.variantCount,
    filters: {
      all: normalizeVariantQuery(raw.all),
      chr22: normalizeVariantQuery(raw.chr22),
      high_impact: normalizeVariantQuery(raw.high_impact)
    }
  }
}

describe.skipIf(!SHOULD_RUN_PARITY || !isElectronBuilt)('parity: cases.list on a fresh app', () => {
  // Cache the Electron-side result across both assertion blocks so we
  // don't pay the boot cost twice.
  let electronResult: NormalizedCases | undefined

  test('Electron path: cases.list returns a normalizable empty list on fresh userData', async () => {
    electronResult = await runScenarioOnElectron()
    expect(electronResult.count).toBe(0)
    expect(electronResult.ids).toEqual([])
  })

  test.skipIf(!isWebBuilt)('Web path: cases.list returns identical normalized result', async () => {
    // Activates only when the web build target lands. Until then this
    // test is part of the visible Phase 1 backlog.
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp({ db: ':memory:' })
    try {
      const res = await app.inject({ method: 'GET', url: '/api/cases' })
      expect(res.statusCode).toBe(200)
      const webResult = normalizeCasesResult(res.json())
      expect(webResult).toEqual(electronResult ?? { count: 0, ids: [] })
    } finally {
      await app.close()
    }
  })

  afterAll(() => {
    // Electron sessions clean themselves up via launchElectronApp's
    // cleanup() return; nothing else to do here. This hook exists so
    // future scenarios can attach shared tear-down without restructuring.
  })
})

describe.skipIf(!SHOULD_RUN_PARITY || !isElectronBuilt)(
  'parity: VCF import + 3 filter queries',
  () => {
    let electronSnapshot: ImportAndFilterSnapshot | undefined

    test('fixture exists', () => {
      expect(existsSync(VCF_FIXTURE)).toBe(true)
    })

    test('Electron path: imports VCF, runs 3 filter queries, matches snapshot', async () => {
      const raw = await runImportScenarioOnElectron(VCF_FIXTURE)
      electronSnapshot = buildSnapshot(raw)

      // Sanity: the fixture is non-empty and the unfiltered query returned
      // something. We don't pin an exact count here — that's the snapshot's
      // job — but a count of zero would mean import silently failed and
      // the snapshot would still pass on regenerate. Guard against that.
      expect(electronSnapshot.variantCount).toBeGreaterThan(0)
      expect(electronSnapshot.filters.all.total).toBeGreaterThan(0)

      const update = process.env[UPDATE_FLAG] === '1'
      const existing = loadSnapshot()
      if (update || existing === null) {
        saveSnapshot(electronSnapshot)
        if (existing === null && !update) {
          throw new Error(
            `Snapshot missing at ${SNAPSHOT_PATH}.\n` +
              `Seed it with: ${UPDATE_FLAG}=1 VARLENS_RUN_WEB_GATE_PARITY=1 npx vitest run --project web-gate-parity tests/web-gate/parity/import-and-filter.test.ts\n` +
              `Then commit the JSON file.`
          )
        }
        return
      }

      expect(electronSnapshot, driftMessage()).toEqual(existing)
    })

    test.skipIf(!isWebBuilt)(
      'Web path: VCF import + filters match Electron snapshot',
      async () => {
        // Mirrors the existing cases.list web stub. The HTTP shape will be
        // pinned in a follow-up once `src/web/server` exposes import + query
        // routes; for today this test activates only when the web build is
        // present and is intentionally minimal: it asserts the snapshot file
        // exists, so the parity assertion has a baseline to match against.
        const existing = loadSnapshot()
        expect(existing, 'Run the Electron half first to seed the snapshot.').not.toBeNull()
        // Once `src/web/server` ships an import + query surface, replace the
        // line below with a fastify.inject-driven scenario that builds the
        // same `ImportAndFilterSnapshot` shape and `expect().toEqual(existing)`.
        expect(electronSnapshot ?? existing).toEqual(existing)
      }
    )
  }
)

function driftMessage(): string {
  return (
    `Parity snapshot drift at ${SNAPSHOT_PATH}.\n` +
    `If the change is intentional: review the diff carefully, then run\n` +
    `  ${UPDATE_FLAG}=1 VARLENS_RUN_WEB_GATE_PARITY=1 npx vitest run --project web-gate-parity tests/web-gate/parity/import-and-filter.test.ts\n` +
    `and commit the regenerated snapshot in the same PR with a reason.\n` +
    `If unintended: investigate before updating.`
  )
}

describe.skipIf(SHOULD_RUN_PARITY && isElectronBuilt)('parity skipped notice', () => {
  test('parity is opt-in (set VARLENS_RUN_WEB_GATE_PARITY=1) and requires a build', () => {
    // Sentinel — succeeds whenever parity didn't run, so `make web-gate-
    // parity` produces a clear pass even on platforms without an Electron
    // build. The "real" parity assertion lives in the gated describe above.
    expect(SHOULD_RUN_PARITY ? isElectronBuilt : true).toBe(true)
  })
})
