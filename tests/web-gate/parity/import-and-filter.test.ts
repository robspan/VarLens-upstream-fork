import { afterAll, describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
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
 * results across both backends." Today we ship the Electron half and a
 * skipped-by-default web half. The full VCF import scenario will land in a
 * follow-up PR; for now this is a *harness smoke test* that proves:
 *
 *   - the helper boots Electron with isolated userData
 *   - the renderer reaches an interactive state
 *   - `window.api.cases.list()` returns through the full IPC stack and is
 *     normalizable
 *
 * When the second parity scenario lands, this is the trigger to extract
 * the `BackendDriver` abstraction (see `.planning/web/testing/desktop-to-web-parity.md`
 * §named-but-deferred).
 *
 * Skipped if `out/main/index.js` is missing — run `make build` first.
 */

const ELECTRON_BUILD = resolve(process.cwd(), 'out/main/index.js')
const isElectronBuilt = existsSync(ELECTRON_BUILD)
const WEB_BUILD = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD)

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

interface NormalizedCases {
  count: number
  ids: string[] // case names sorted lexicographically — stable across runs
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

function normalizeCasesResult(raw: unknown): NormalizedCases {
  // The renderer returns the unwrapped array per the IpcResult contract.
  const arr = Array.isArray(raw) ? raw : []
  const names = arr
    .map((c) => (typeof c === 'object' && c !== null ? (c as { name?: string }).name : ''))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort()
  return { count: arr.length, ids: names }
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

describe.skipIf(SHOULD_RUN_PARITY && isElectronBuilt)('parity skipped notice', () => {
  test('parity is opt-in (set VARLENS_RUN_WEB_GATE_PARITY=1) and requires a build', () => {
    // Sentinel — succeeds whenever parity didn't run, so `make web-gate-
    // parity` produces a clear pass even on platforms without an Electron
    // build. The "real" parity assertion lives in the gated describe above.
    expect(SHOULD_RUN_PARITY ? isElectronBuilt : true).toBe(true)
  })
})
