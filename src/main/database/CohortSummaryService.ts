/**
 * CohortSummaryService - Pre-computed cohort aggregation tables
 *
 * Manages rebuild and staleness of cohort_variant_summary and gene_burden_summary.
 * Called after import/delete operations to refresh cached aggregations.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export interface CohortSummaryStatus {
  is_stale: boolean
  last_rebuilt_at: number
}

export class CohortSummaryService {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Rebuild both summary tables from the variants table.
   * Runs as a single transaction for atomicity.
   */
  rebuild(): void {
    const rebuildTransaction = this.db.transaction(() => {
      this.db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      this.db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
      this.db.exec(REBUILD_GENE_BURDEN_SQL)
      this.db.exec(UPDATE_META_SQL)
    })

    rebuildTransaction()

    // Update query planner statistics (outside transaction)
    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch {
      /* best effort */
    }
    try {
      this.db.exec('ANALYZE gene_burden_summary')
    } catch {
      /* best effort */
    }
  }

  /**
   * Mark summary tables as stale.
   * Called before data-changing operations.
   */
  markStale(): void {
    this.db.exec(MARK_STALE_SQL)
  }

  /**
   * Get current staleness status.
   */
  getStatus(): CohortSummaryStatus {
    const staleRow = this.db
      .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'")
      .get() as { value: string } | undefined

    const rebuiltRow = this.db
      .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'last_rebuilt_at'")
      .get() as { value: string } | undefined

    return {
      is_stale: staleRow?.value === '1',
      last_rebuilt_at: rebuiltRow ? parseInt(rebuiltRow.value, 10) : 0
    }
  }
}
