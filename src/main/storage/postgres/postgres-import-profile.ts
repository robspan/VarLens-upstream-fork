// Per-phase timing instrumentation for the Postgres VCF import path.
//
// No-op unless VARLENS_PG_IMPORT_PROFILE === '1'. When enabled, captures
// cumulative per-phase wall time and per-phase invocation counts across
// every batch of an import, then dumps a structured summary at end-of-run.
//
// Output goes to stderr AND to .planning/artifacts/perf/pg-import-profile/
// — the worker runs in a worker_thread under Electron, where Playwright
// captures stdout/stderr and we lose visibility. The file artifact is the
// reliable channel.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENABLED = process.env.VARLENS_PG_IMPORT_PROFILE === '1'
const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/pg-import-profile')

interface PhaseTotals {
  ms: number
  count: number
}

const totals = new Map<string, PhaseTotals>()
let runStartNs: bigint | null = null
let runLabel: string | null = null

export function profileEnabled(): boolean {
  return ENABLED
}

export function profileStart(label: string): void {
  if (!ENABLED) return
  totals.clear()
  runStartNs = process.hrtime.bigint()
  runLabel = label
}

/**
 * Time an async phase. Records wall time in totals[phase], increments
 * count[phase]. Always awaits the inner work — never short-circuits.
 */
export async function profilePhase<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn()
  const start = process.hrtime.bigint()
  try {
    return await fn()
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    const cur = totals.get(phase) ?? { ms: 0, count: 0 }
    cur.ms += elapsedMs
    cur.count += 1
    totals.set(phase, cur)
  }
}

/** Like profilePhase but for synchronous work (e.g., encoder cost). */
export function profilePhaseSync<T>(phase: string, fn: () => T): T {
  if (!ENABLED) return fn()
  const start = process.hrtime.bigint()
  try {
    return fn()
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    const cur = totals.get(phase) ?? { ms: 0, count: 0 }
    cur.ms += elapsedMs
    cur.count += 1
    totals.set(phase, cur)
  }
}

/** Increment a per-phase counter without timing (e.g., row counts). */
export function profileCount(phase: string, n: number): void {
  if (!ENABLED) return
  const cur = totals.get(phase) ?? { ms: 0, count: 0 }
  cur.count += n
  totals.set(phase, cur)
}

export function profileFlush(): void {
  if (!ENABLED || runStartNs === null) return
  const wallMs = Number(process.hrtime.bigint() - runStartNs) / 1_000_000

  const rows = Array.from(totals.entries())
    .map(([phase, t]) => ({
      phase,
      ms: t.ms,
      count: t.count,
      pctOfWall: (t.ms / wallMs) * 100
    }))
    .sort((a, b) => b.ms - a.ms)

  const header = `[pg-import-profile] run=${runLabel ?? '(unlabeled)'} wall_ms=${wallMs.toFixed(1)}`
  const lines: string[] = [
    header,
    `  ${'phase'.padEnd(36)}  ${'ms'.padStart(10)}  ${'count'.padStart(8)}  ${'%wall'.padStart(7)}`
  ]
  for (const r of rows) {
    lines.push(
      `  ${r.phase.padEnd(36)}  ${r.ms.toFixed(1).padStart(10)}  ${String(r.count).padStart(8)}  ${r.pctOfWall.toFixed(1).padStart(7)}`
    )
  }
  const body = lines.join('\n') + '\n'

  // Stderr (best-effort — under Playwright Electron the parent captures it).
  // eslint-disable-next-line no-console
  for (const line of lines) console.warn(line)

  // Reliable channel: write to a timestamped artifact file. The worker thread
  // can write to disk; the parent perf test or developer reads it after.
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const safeLabel = (runLabel ?? 'unlabeled').replace(/[^a-zA-Z0-9_-]+/g, '_')
    const path = resolve(ARTIFACT_DIR, `${ts}-${safeLabel}.txt`)
    writeFileSync(path, body)
  } catch {
    // Profile is diagnostic; never throw from here.
  }

  totals.clear()
  runStartNs = null
  runLabel = null
}
