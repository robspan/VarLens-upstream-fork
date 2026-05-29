/**
 * Sprint A PR-3 C5 (PR3-17) — cohort-read freshness / staleness orchestration.
 *
 * The cohort read path (cohort:query) must reconcile the materialised
 * cohort_variant_summary with its lifecycle state before serving rows:
 *
 *   - Bootstrap-on-existing-data (Pass-9 #5): when the summary has never been
 *     rebuilt (last_rebuilt_at IS NULL) OR variants exist but the summary table
 *     is empty, force a synchronous rebuild regardless of the case-count
 *     threshold — otherwise the very first read of an imported/migrated dataset
 *     would serve an empty cohort.
 *   - Stale below SYNC_REBUILD_MAX_CASES: rebuild synchronously, then serve
 *     fresh data (no warning).
 *   - Stale at/above the threshold: serve the stale summary immediately and
 *     schedule a single-flight background rebuild, surfacing
 *     warnings.staleSummary=true so the renderer can show a "refreshing" hint
 *     (Pass-8 #6).
 *
 * Free functions (pool + schema in) so PostgresCohortRepository stays an
 * orchestration-only repository and this read-path policy lives in one module.
 */
import type { Pool, PoolClient } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import { PostgresCohortSummaryRepository } from './PostgresCohortSummaryRepository'
import { getCohortSummaryState } from './cohort-summary-state-sql'

const DEFAULT_SYNC_REBUILD_MAX_CASES = 50

interface ScopedPool {
  pool: Pick<Pool, 'query' | 'connect'>
  schema: string
}

/** Optional warnings returned alongside a cohort read result. */
export interface CohortReadWarnings {
  staleSummary?: boolean
}

/**
 * Max total cases for which a stale-triggered rebuild still runs synchronously
 * on the read path. Reads from VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES; falls
 * back to 50. Read lazily (not cached) so tests can flip the env per-case.
 */
export function syncRebuildMaxCases(): number {
  const raw = process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
  if (raw === undefined || raw.trim() === '') return DEFAULT_SYNC_REBUILD_MAX_CASES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SYNC_REBUILD_MAX_CASES
}

/**
 * Read the cohort_summary_state singleton in the existing IPC contract shape
 * { is_stale, last_rebuilt_at:number } (Pass-9 #6 epoch-ms mapping). Connects a
 * client because getCohortSummaryState takes a PoolClient.
 */
export async function readCohortSummaryStatus({
  pool,
  schema
}: ScopedPool): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
  const client = await pool.connect()
  try {
    return await getCohortSummaryState({ schema, client })
  } finally {
    client.release()
  }
}

interface FreshnessProbe {
  never_rebuilt: boolean
  variants_present: boolean
  summary_present: boolean
  is_stale: boolean
  total_cases: number
}

async function probeFreshness({ pool, schema }: ScopedPool): Promise<FreshnessProbe> {
  const tbl = (t: string): string => `"${schema}"."${t}"`
  const result = await pool.query<{
    never_rebuilt: boolean
    variants_present: boolean
    summary_present: boolean
    is_stale: boolean
    total_cases: string
  }>(
    `SELECT
       (s.last_rebuilt_at IS NULL) AS never_rebuilt,
       EXISTS (SELECT 1 FROM ${tbl('variants')} LIMIT 1) AS variants_present,
       EXISTS (SELECT 1 FROM ${tbl('cohort_variant_summary')} LIMIT 1) AS summary_present,
       s.is_stale,
       (SELECT COUNT(*)::bigint FROM ${tbl('cases')}) AS total_cases
     FROM ${tbl('cohort_summary_state')} s
     WHERE s.id = 1`
  )
  const row = result.rows[0]
  return {
    never_rebuilt: row.never_rebuilt,
    variants_present: row.variants_present,
    summary_present: row.summary_present,
    is_stale: row.is_stale,
    total_cases: Number(row.total_cases)
  }
}

/** Run a single rebuild inside its own transaction (BEGIN/COMMIT). */
async function runSynchronousRebuild({ pool, schema }: ScopedPool): Promise<void> {
  const repository = new PostgresCohortSummaryRepository()
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    await repository.rebuild({ schema, client })
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure; surface the original error below
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Single-flight gate per schema so concurrent stale reads schedule at most one
 * detached background rebuild. The promise is cleared when the rebuild settles.
 */
const backgroundRebuilds = new Map<string, Promise<void>>()

function scheduleBackgroundRebuild(scope: ScopedPool): void {
  if (backgroundRebuilds.has(scope.schema)) return

  const task = runSynchronousRebuild(scope)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.warn(`Background cohort summary rebuild failed: ${message}`, 'cohort')
    })
    .finally(() => {
      backgroundRebuilds.delete(scope.schema)
    })
  backgroundRebuilds.set(scope.schema, task)
}

/**
 * Reconcile the cohort summary before serving a cohort read. Returns the
 * warnings to merge into the read response (staleSummary when a stale summary is
 * served without a synchronous refresh).
 */
export async function prepareCohortRead(
  scope: ScopedPool
): Promise<{ warnings?: CohortReadWarnings }> {
  const probe = await probeFreshness(scope)

  // Pass-9 #5: bootstrap-on-existing-data — force a synchronous rebuild
  // irrespective of the case-count threshold so the first read never serves an
  // empty/missing summary for a populated dataset.
  if (probe.never_rebuilt || (probe.variants_present && !probe.summary_present)) {
    await runSynchronousRebuild(scope)
    return {}
  }

  if (!probe.is_stale) {
    return {}
  }

  if (probe.total_cases < syncRebuildMaxCases()) {
    await runSynchronousRebuild(scope)
    return {}
  }

  // Large cohort: serve the stale summary now and refresh in the background.
  scheduleBackgroundRebuild(scope)
  return { warnings: { staleSummary: true } }
}

/** Test-only: await any in-flight background rebuild for a schema. */
export async function awaitBackgroundRebuild(schema: string): Promise<void> {
  await backgroundRebuilds.get(schema)
}
