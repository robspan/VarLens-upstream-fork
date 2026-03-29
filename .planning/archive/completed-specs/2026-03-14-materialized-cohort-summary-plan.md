# Materialized Cohort Summary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-compute cohort variant and gene burden aggregations into summary tables so queries read from cached results instead of aggregating 5M+ rows live.

**Architecture:** Two new summary tables (`cohort_variant_summary`, `gene_burden_summary`) are populated by a `CohortSummaryService.rebuild()` method called after import/delete operations. The existing `CohortService` is rewritten to SELECT from these tables. A staleness indicator in the renderer shows rebuild progress.

**Tech Stack:** better-sqlite3, TypeScript, Vitest, Vue 3 composables, Electron IPC

**Spec:** `.planning/specs/2026-03-14-materialized-cohort-summary-design.md`

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/main/database/CohortSummaryService.ts` | Rebuild, markStale, getStatus methods |
| `src/shared/sql/cohort-summary-rebuild.ts` | Shared SQL constants for rebuild (DRY across workers) |
| `src/main/workers/rebuild-summary-worker.ts` | Short-lived worker for deferred single-delete rebuilds |
| `tests/main/database/CohortSummaryService.test.ts` | Unit tests for rebuild and staleness |
| `tests/main/database/migration-v13.test.ts` | Migration creates tables/indexes correctly |

### Modified files
| File | Change |
|---|---|
| `src/main/database/migrations.ts` | Add v13 migration |
| `src/main/database/DatabaseService.ts` | Instantiate CohortSummaryService, expose getter |
| `src/main/database/cohort.ts` | Rewrite queries to read from summary tables; update SORTABLE_COLUMNS |
| `src/main/workers/import-worker.ts` | Call summary rebuild after FTS restore (using shared SQL) |
| `src/main/workers/delete-worker.ts` | Call summary rebuild after FTS restore (using shared SQL) |
| `src/main/ipc/handlers/cases.ts` | Emit summaryRebuilt via safeEmit after single/bulk delete |
| `src/main/ipc/handlers/cohort.ts` | Add summaryStatus, rebuildSummary handlers |
| `src/main/ipc/handlers/batch-import.ts` | Emit summaryRebuilt via safeEmit after import complete |
| `src/preload/index.ts` | Add cohort.getSummaryStatus, onSummaryRebuilt |
| `src/preload/index.d.ts` | Update type declarations |
| `src/renderer/src/composables/useCohortData.ts` | Add summaryStale state and auto-refresh |
| `src/renderer/src/components/CohortTable.vue` | Show staleness indicator, call cleanupListeners on unmount |
| `tests/main/database/cohort.test.ts` | Update tests for summary-based queries |

### Architecture notes

**safeEmit pattern:** Both `cases.ts` and `batch-import.ts` already use a `safeEmit()` helper that sends events via `BrowserWindow.getAllWindows()[0].webContents.send()`. All `cohort:summaryRebuilt` notifications use this same pattern — no `event.sender` needed.

**Shared SQL constants:** The rebuild SQL is extracted into `src/shared/sql/cohort-summary-rebuild.ts` so that `CohortSummaryService`, `import-worker`, `delete-worker`, and `rebuild-summary-worker` all import from a single source of truth.

**SORTABLE_COLUMNS update:** After the query rewrite, the `SORTABLE_COLUMNS` map must map `cadd_phred` → `cadd` and the `PRE_AGGREGATION_COLUMN_MAP` is removed (no longer needed since all columns now reference `cohort_variant_summary` directly). The `AGGREGATE_COLUMNS` set is also removed.

---

## Chunk 1: Migration and CohortSummaryService

### Task 1: Database Migration v13

**Files:**
- Modify: `src/main/database/migrations.ts:540-570`
- Test: `tests/main/database/migration-v13.test.ts` (create)

- [ ] **Step 1: Write migration v13 test**

```typescript
// tests/main/database/migration-v13.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Migration v13: cohort summary tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates cohort_variant_summary table with correct schema', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(cohort_variant_summary)').all() as { name: string }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('chr')
    expect(colNames).toContain('carrier_count')
    expect(colNames).toContain('het_count')
    expect(colNames).toContain('hom_count')
    expect(colNames).toContain('variant_key')
  })

  it('creates gene_burden_summary table', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(gene_burden_summary)').all() as { name: string }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('gene_symbol')
    expect(colNames).toContain('variant_count')
    expect(colNames).toContain('affected_case_count')
  })

  it('creates cohort_summary_meta table', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(cohort_summary_meta)').all() as { name: string }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('key')
    expect(colNames).toContain('value')
  })

  it('creates indexes on cohort_variant_summary', () => {
    runMigrations(db)
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cohort_variant_summary'"
    ).all() as { name: string }[]
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_cvs_gene')
    expect(indexNames).toContain('idx_cvs_carrier')
    expect(indexNames).toContain('idx_cvs_filters')
    expect(indexNames).toContain('idx_cvs_consequence')
  })

  it('is idempotent (safe to run twice)', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(13)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/migration-v13.test.ts`
Expected: FAIL — migration v13 does not exist yet

- [ ] **Step 3: Implement migration v13**

Add to `src/main/database/migrations.ts` after the v12 block (after line 569):

```typescript
  // ── Migration v13: Cohort summary tables (issue #33) ──
  if (currentVersion < 13) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cohort_variant_summary (
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        gene_symbol TEXT,
        cdna TEXT,
        aa_change TEXT,
        consequence TEXT,
        func TEXT,
        clinvar TEXT,
        gnomad_af REAL,
        cadd REAL,
        transcript TEXT,
        omim_mim_number TEXT,
        carrier_count INTEGER NOT NULL,
        het_count INTEGER NOT NULL,
        hom_count INTEGER NOT NULL,
        variant_key TEXT NOT NULL,
        PRIMARY KEY (chr, pos, ref, alt)
      );

      CREATE INDEX IF NOT EXISTS idx_cvs_gene ON cohort_variant_summary(gene_symbol);
      CREATE INDEX IF NOT EXISTS idx_cvs_carrier ON cohort_variant_summary(carrier_count);
      CREATE INDEX IF NOT EXISTS idx_cvs_filters ON cohort_variant_summary(gnomad_af, cadd);
      CREATE INDEX IF NOT EXISTS idx_cvs_consequence ON cohort_variant_summary(consequence);

      CREATE TABLE IF NOT EXISTS gene_burden_summary (
        gene_symbol TEXT PRIMARY KEY,
        variant_count INTEGER NOT NULL,
        unique_variant_count INTEGER NOT NULL,
        affected_case_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gbs_affected
        ON gene_burden_summary(affected_case_count DESC);

      CREATE TABLE IF NOT EXISTS cohort_summary_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    db.exec('PRAGMA user_version = 13')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/migration-v13.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/migration-v13.test.ts
git commit -m "feat(db): add migration v13 for cohort summary tables (#33)"
```

---

### Task 2: Extract shared rebuild SQL constants

**Files:**
- Create: `src/shared/sql/cohort-summary-rebuild.ts`

- [ ] **Step 1: Create shared SQL module**

```typescript
// src/shared/sql/cohort-summary-rebuild.ts
/**
 * Shared SQL constants for cohort summary table rebuild.
 *
 * Used by CohortSummaryService (main thread), import-worker, delete-worker,
 * and rebuild-summary-worker. Single source of truth to avoid SQL drift.
 */

export const REBUILD_VARIANT_SUMMARY_SQL = `
  DELETE FROM cohort_variant_summary;
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count, variant_key
  )
  SELECT
    chr, pos, ref, alt,
    MAX(gene_symbol), MAX(cdna), MAX(aa_change),
    MAX(consequence), MAX(func), MAX(clinvar),
    MAX(gnomad_af), MAX(cadd), MAX(transcript), MAX(omim_mim_number),
    COUNT(DISTINCT case_id),
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
    chr || ':' || pos || ':' || ref || ':' || alt
  FROM variants
  GROUP BY chr, pos, ref, alt;
`

export const REBUILD_GENE_BURDEN_SQL = `
  DELETE FROM gene_burden_summary;
  INSERT INTO gene_burden_summary (
    gene_symbol, variant_count, unique_variant_count,
    affected_case_count, updated_at
  )
  SELECT
    gene_symbol,
    COUNT(*) AS variant_count,
    COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) AS unique_variant_count,
    COUNT(DISTINCT case_id) AS affected_case_count,
    CAST(strftime('%s', 'now') AS INTEGER)
  FROM variants
  WHERE gene_symbol IS NOT NULL AND gene_symbol != ''
  GROUP BY gene_symbol;
`

export const UPDATE_META_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('last_rebuilt_at', CAST(strftime('%s', 'now') AS TEXT));
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '0');
`

export const MARK_STALE_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '1');
`

/** Check if summary tables exist (for workers on pre-v13 databases) */
export const CHECK_TABLE_EXISTS_SQL =
  "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/sql/cohort-summary-rebuild.ts
git commit -m "feat(shared): extract cohort summary rebuild SQL constants (#33)"
```

---

### Task 3: CohortSummaryService — rebuild, markStale, getStatus

**Files:**
- Create: `src/main/database/CohortSummaryService.ts`
- Test: `tests/main/database/CohortSummaryService.test.ts` (create)

- [ ] **Step 1: Write tests for CohortSummaryService**

```typescript
// tests/main/database/CohortSummaryService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('CohortSummaryService', () => {
  let db: Database.Database
  let service: CohortSummaryService

  const insertCase = (name: string): number => {
    const result = db.prepare(
      'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
    ).run(name, `/test/${name}.json`, 1000, Date.now())
    return result.lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number, chr: string, pos: number, ref: string, alt: string,
    opts: { gene_symbol?: string; gt_num?: string; consequence?: string } = {}
  ): void => {
    db.prepare(`
      INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, consequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(caseId, chr, pos, ref, alt, opts.gene_symbol ?? null, opts.gt_num ?? '0/1', opts.consequence ?? null)
  }

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    service = new CohortSummaryService(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('rebuild', () => {
    it('populates cohort_variant_summary from variants', () => {
      const c1 = insertCase('case1')
      const c2 = insertCase('case2')
      insertVariant(c1, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1', gt_num: '0/1' })
      insertVariant(c2, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1', gt_num: '1/1' })
      insertVariant(c1, '2', 200, 'G', 'C', { gene_symbol: 'TP53', gt_num: '0/1' })

      service.rebuild()

      const rows = db.prepare('SELECT * FROM cohort_variant_summary ORDER BY chr, pos').all() as Array<{
        chr: string; pos: number; carrier_count: number; het_count: number; hom_count: number; variant_key: string
      }>
      expect(rows).toHaveLength(2)
      // First variant: 2 carriers (1 het, 1 hom)
      expect(rows[0].carrier_count).toBe(2)
      expect(rows[0].het_count).toBe(1)
      expect(rows[0].hom_count).toBe(1)
      expect(rows[0].variant_key).toBe('1:100:A:T')
      // Second variant: 1 carrier (1 het)
      expect(rows[1].carrier_count).toBe(1)
      expect(rows[1].het_count).toBe(1)
    })

    it('populates gene_burden_summary', () => {
      const c1 = insertCase('case1')
      const c2 = insertCase('case2')
      insertVariant(c1, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1' })
      insertVariant(c2, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1' })
      insertVariant(c1, '1', 200, 'G', 'C', { gene_symbol: 'BRCA1' })
      insertVariant(c1, '2', 300, 'A', 'G', { gene_symbol: 'TP53' })

      service.rebuild()

      const rows = db.prepare(
        'SELECT * FROM gene_burden_summary ORDER BY affected_case_count DESC'
      ).all() as Array<{
        gene_symbol: string; variant_count: number; unique_variant_count: number; affected_case_count: number
      }>
      expect(rows).toHaveLength(2)
      expect(rows[0].gene_symbol).toBe('BRCA1')
      expect(rows[0].variant_count).toBe(3)
      expect(rows[0].unique_variant_count).toBe(2)
      expect(rows[0].affected_case_count).toBe(2)
      expect(rows[1].gene_symbol).toBe('TP53')
      expect(rows[1].affected_case_count).toBe(1)
    })

    it('clears stale flag after rebuild', () => {
      service.markStale()
      expect(service.getStatus().is_stale).toBe(true)
      service.rebuild()
      expect(service.getStatus().is_stale).toBe(false)
    })

    it('replaces old data on rebuild', () => {
      const c1 = insertCase('case1')
      insertVariant(c1, '1', 100, 'A', 'T')
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 1 })

      // Delete the variant, rebuild should clear
      db.prepare('DELETE FROM variants').run()
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 0 })
    })

    it('handles empty database', () => {
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 0 })
      expect(db.prepare('SELECT COUNT(*) as c FROM gene_burden_summary').get()).toEqual({ c: 0 })
    })
  })

  describe('markStale / getStatus', () => {
    it('marks summary as stale', () => {
      service.markStale()
      const status = service.getStatus()
      expect(status.is_stale).toBe(true)
    })

    it('returns not stale when no meta rows exist', () => {
      const status = service.getStatus()
      expect(status.is_stale).toBe(false)
      expect(status.last_rebuilt_at).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/CohortSummaryService.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement CohortSummaryService**

```typescript
// src/main/database/CohortSummaryService.ts
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
  MARK_STALE_SQL
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
      this.db.exec(REBUILD_GENE_BURDEN_SQL)
      this.db.exec(UPDATE_META_SQL)
    })

    rebuildTransaction()

    // Update query planner statistics (outside transaction)
    try { this.db.exec('ANALYZE cohort_variant_summary') } catch { /* best effort */ }
    try { this.db.exec('ANALYZE gene_burden_summary') } catch { /* best effort */ }
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
    const staleRow = this.db.prepare(
      "SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'"
    ).get() as { value: string } | undefined

    const rebuiltRow = this.db.prepare(
      "SELECT value FROM cohort_summary_meta WHERE key = 'last_rebuilt_at'"
    ).get() as { value: string } | undefined

    return {
      is_stale: staleRow?.value === '1',
      last_rebuilt_at: rebuiltRow ? parseInt(rebuiltRow.value, 10) : 0
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/CohortSummaryService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/CohortSummaryService.ts tests/main/database/CohortSummaryService.test.ts
git commit -m "feat(db): add CohortSummaryService with rebuild and staleness tracking (#33)"
```

---

### Task 4: Wire CohortSummaryService into DatabaseService

**Files:**
- Modify: `src/main/database/DatabaseService.ts:19-20,49-53,99-109,121-161`

- [ ] **Step 1: Add import and field to DatabaseService**

In `src/main/database/DatabaseService.ts`:

Add import after line 28:
```typescript
import { CohortSummaryService } from './CohortSummaryService'
```

Add private field after line 53 (`_currentUser`):
```typescript
  private _cohortSummary: CohortSummaryService
```

Initialize in constructor after line 109 (`_auth` initialization):
```typescript
      this._cohortSummary = new CohortSummaryService(this.db)
```

Add getter after the `auth` getter (after line 161):
```typescript
  get cohortSummary(): CohortSummaryService {
    return this._cohortSummary
  }
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/database/DatabaseService.ts
git commit -m "feat(db): expose CohortSummaryService via DatabaseService (#33)"
```

---

## Chunk 2: Worker Integration (Import and Delete)

### Task 5: Add summary rebuild to import worker

**Files:**
- Modify: `src/main/workers/import-worker.ts`

- [ ] **Step 1: Add import for shared SQL**

At the top of `import-worker.ts`, add:
```typescript
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  CHECK_TABLE_EXISTS_SQL
} from '../../shared/sql/cohort-summary-rebuild'
```

- [ ] **Step 2: Add summary rebuild after FTS rebuild in import worker**

After line 283 (`rebuildFts(db)`), add:
```typescript
      rebuildCohortSummary(db)
```

Add a new function after `rebuildFts` (after line 499):
```typescript
function rebuildCohortSummary(db: DatabaseType): void {
  try {
    const tableExists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
    if (tableExists.c === 0) return

    db.transaction(() => {
      db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      db.exec(REBUILD_GENE_BURDEN_SQL)
      db.exec(UPDATE_META_SQL)
    })()

    db.exec('ANALYZE cohort_variant_summary')
    db.exec('ANALYZE gene_burden_summary')
  } catch {
    // best effort — summary can be rebuilt on next import/app start
  }
}
```

Also add a stale marker at the start of import (after line 74, after `db.exec(DROP_INDEXES)`):
```typescript
      // Mark cohort summary as stale before import
      try { db.exec(MARK_STALE_SQL) } catch { /* table may not exist yet */ }
```

- [ ] **Step 2: Run existing import worker tests**

Run: `npx vitest run tests/main/workers/import-worker-db-opts.test.ts`
Expected: PASS (no regressions)

- [ ] **Step 3: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "feat(worker): rebuild cohort summary after batch import (#33)"
```

---

### Task 6: Add summary rebuild to delete worker

**Files:**
- Modify: `src/main/workers/delete-worker.ts`

- [ ] **Step 1: Add summary rebuild to delete worker**

In `src/main/workers/delete-worker.ts`, add import at top:
```typescript
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  CHECK_TABLE_EXISTS_SQL
} from '../../shared/sql/cohort-summary-rebuild'
```

After `restoreFts(db)` on line 64, add:
```typescript
    rebuildCohortSummary(db)
```

Before the delete operation (after line 35, after dropping FTS triggers), add:
```typescript
    // Mark cohort summary as stale before delete
    try { db.exec(MARK_STALE_SQL) } catch { /* table may not exist */ }
```

Add `rebuildCohortSummary` function at the bottom (same as import-worker — uses shared SQL constants):
```typescript
function rebuildCohortSummary(db: DatabaseType): void {
  try {
    const tableExists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
    if (tableExists.c === 0) return

    db.transaction(() => {
      db.exec(REBUILD_VARIANT_SUMMARY_SQL)
      db.exec(REBUILD_GENE_BURDEN_SQL)
      db.exec(UPDATE_META_SQL)
    })()

    db.exec('ANALYZE cohort_variant_summary')
    db.exec('ANALYZE gene_burden_summary')
  } catch {
    // best effort
  }
}
```

- [ ] **Step 2: Run existing delete tests**

Run: `npx vitest run tests/main/database/delete-cases.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/workers/delete-worker.ts
git commit -m "feat(worker): rebuild cohort summary after bulk delete (#33)"
```

---

### Task 7: Handle single case delete (markStale + deferred rebuild)

**Files:**
- Create: `src/main/workers/rebuild-summary-worker.ts`
- Modify: `src/main/ipc/handlers/cases.ts:69-82`

- [ ] **Step 1: Create rebuild-summary-worker (uses shared SQL)**

```typescript
// src/main/workers/rebuild-summary-worker.ts
/**
 * Short-lived worker thread for deferred cohort summary rebuild.
 *
 * Spawned after single case deletes to avoid blocking the main thread.
 * Opens its own database connection, rebuilds summary tables, then exits.
 */
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL
} from '../../shared/sql/cohort-summary-rebuild'

export interface RebuildWorkerRequest {
  dbPath: string
  encryptionKey?: string
}

export interface RebuildWorkerResponse {
  type: 'complete' | 'error'
  error?: string
}

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

port.on('message', (msg: RebuildWorkerRequest) => {
  let db: DatabaseType | null = null
  try {
    db = new Database(msg.dbPath)

    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      const safeKey = msg.encryptionKey.split("'").join("''")
      db.pragma(`key='${safeKey}'`)
    }

    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
    db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
    db.pragma('temp_store = MEMORY')
    db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

    db.transaction(() => {
      db!.exec(REBUILD_VARIANT_SUMMARY_SQL)
      db!.exec(REBUILD_GENE_BURDEN_SQL)
      db!.exec(UPDATE_META_SQL)
    })()

    try { db.exec('ANALYZE cohort_variant_summary') } catch { /* best effort */ }
    try { db.exec('ANALYZE gene_burden_summary') } catch { /* best effort */ }

    const response: RebuildWorkerResponse = { type: 'complete' }
    port.postMessage(response)
  } catch (error) {
    const response: RebuildWorkerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    }
    port.postMessage(response)
  } finally {
    if (db) {
      try { db.close() } catch { /* best effort */ }
    }
  }
})
```

- [ ] **Step 2: Wire deferred rebuild into cases:delete handler**

In `src/main/ipc/handlers/cases.ts`, the `cases:delete` handler (line 69) currently uses `_event` (unused). Modify to spawn rebuild worker after delete. The file already has `Worker` import and `safeEmit` helper.

Replace the `cases:delete` handler:
```typescript
  ipcMain.handle('cases:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      db.cases.deleteCase(validated.data)

      // Mark cohort summary stale and spawn deferred rebuild
      try {
        db.cohortSummary.markStale()
        safeEmit('cohort:summaryRebuilt', { is_stale: true })

        const workerPath = resolve(__dirname, 'rebuild-summary-worker.js')
        const worker = new Worker(workerPath)
        worker.postMessage({
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey()
        })
        worker.on('message', () => {
          safeEmit('cohort:summaryRebuilt', { is_stale: false })
          worker.terminate().catch(() => {})
        })
        worker.on('error', () => {
          worker.terminate().catch(() => {})
        })
      } catch {
        // best effort — summary rebuilds on next import
      }

      return undefined
    })
  })
```

Note: `safeEmit` already exists in `cases.ts` (line 14-18) and uses `BrowserWindow.getAllWindows()[0]` — no need for `event.sender`.

- [ ] **Step 3: Commit**

```bash
git add src/main/workers/rebuild-summary-worker.ts
git commit -m "feat(worker): add rebuild-summary-worker for deferred single-delete rebuilds (#33)"
```

---

## Chunk 3: Query Rewrites

### Task 8: Rewrite CohortService to read from summary tables

**Files:**
- Modify: `src/main/database/cohort.ts` (major rewrite of `getCohortVariants`, `getCohortSummary`, `getGeneBurden`)
- Modify: `tests/main/database/cohort.test.ts`

**IMPORTANT — SORTABLE_COLUMNS and column map updates:**

The `SORTABLE_COLUMNS` map (line 22-38) must be updated because columns now reference `cohort_variant_summary`:
- `cadd_phred` must map to `cadd` (the raw column name in the summary table; the alias `cadd_phred` is only in the SELECT, not usable in ORDER BY)
- `omim_id` is not currently in the map and doesn't need adding

Remove `PRE_AGGREGATION_COLUMN_MAP` entirely (no longer needed).
Remove `AGGREGATE_COLUMNS` set entirely (carrier_count, cohort_frequency, het_count, hom_count are now regular columns).

Updated `SORTABLE_COLUMNS`:
```typescript
const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  cdna: 'cdna',
  aa_change: 'aa_change',
  carrier_count: 'carrier_count',
  cohort_frequency: 'cohort_frequency',  // computed inline, alias works in ORDER BY of outer query
  het_count: 'het_count',
  hom_count: 'hom_count',
  consequence: 'consequence',
  func: 'func',
  clinvar: 'clinvar',
  gnomad_af: 'gnomad_af',
  cadd_phred: 'cadd',  // raw column name in summary table
  transcript: 'transcript'
}
```

Note: `cohort_frequency` is computed as `CAST(carrier_count AS REAL) / :total_cases AS cohort_frequency` in the SELECT. SQLite allows ORDER BY on a SELECT alias, so this works. However, for the `column_filters` loop, all columns are now direct columns on the summary table (or computed), so the entire `column_filters` handling simplifies to just WHERE conditions with LIKE.

- [ ] **Step 1: Update cohort tests to populate summary before querying**

In `tests/main/database/cohort.test.ts`, update the `beforeEach` to import and run `CohortSummaryService.rebuild()`:

Add imports:
```typescript
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'
```

Add `summaryService` variable and update `beforeEach`:
```typescript
  let summaryService: CohortSummaryService

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    cohortService = new CohortService(db)
    summaryService = new CohortSummaryService(db)
  })
```

Add a helper to rebuild after inserting test data:
```typescript
  const rebuildSummary = (): void => {
    summaryService.rebuild()
  }
```

Then in each test that queries cohort data, call `rebuildSummary()` after inserting variants and before calling cohort methods.

- [ ] **Step 2: Rewrite `getCohortVariants` in `src/main/database/cohort.ts`**

Replace the two-CTE query with a flat SELECT from `cohort_variant_summary`. Key changes:

1. Remove the `deduped` and `aggregated` CTEs
2. Replace `FROM variants` with `FROM cohort_variant_summary cvs`
3. Compute `cohort_frequency` and `total_cases` inline: `CAST(cvs.carrier_count AS REAL) / :total_cases AS cohort_frequency`
4. Add aliases: `cvs.cadd AS cadd_phred`, `cvs.omim_mim_number AS omim_id`
5. Move `carrier_count_min` and `cohort_frequency_min` from HAVING to WHERE
6. Remove `AGGREGATE_COLUMNS` set and `filterHavingClause` logic
7. Rewrite search from FTS5 to LIKE-based (see spec "Search strategy change")
8. Rewrite annotation filters to use `cvs.chr/pos/ref/alt` for global and join through `variants` for per-case annotations (see spec "Annotation filter rewrites")

The full rewrite is large — implement it following the spec's query template at lines 166-185. The search methods (`buildSingleTermCondition`, `buildBooleanSearchCondition`) need to be rewritten to use LIKE instead of FTS5:

- Gene/text default: `(cvs.gene_symbol LIKE ? COLLATE NOCASE OR cvs.consequence LIKE ? COLLATE NOCASE OR cvs.omim_mim_number LIKE ? COLLATE NOCASE)`
- Genomic position: `(cvs.chr = ? AND cvs.pos = ?)`
- HGVS: `(cvs.cdna LIKE ? OR cvs.aa_change LIKE ?)`

- [ ] **Step 3: Rewrite `getCohortSummary`**

Update `unique_variants` and `genes_with_variants` to read from summary:
```typescript
    // Unique variants — read from pre-computed summary
    const uniqueVariantsResult = this.db
      .prepare('SELECT COUNT(*) as count FROM cohort_variant_summary')
      .get() as { count: number }
    const uniqueVariants = uniqueVariantsResult.count

    // Genes with variants — read from pre-computed summary
    const genesResult = this.db
      .prepare('SELECT COUNT(DISTINCT gene_symbol) as count FROM cohort_variant_summary WHERE gene_symbol IS NOT NULL')
      .get() as { count: number }
    const genesWithVariants = genesResult.count
```

Leave `total_cases`, `total_variants`, `starred_variants`, `acmg_counts` unchanged.

- [ ] **Step 4: Rewrite `getGeneBurden`**

```typescript
  getGeneBurden(): GeneBurden[] {
    const sql = `
      SELECT gene_symbol, variant_count, unique_variant_count,
        affected_case_count,
        (SELECT COUNT(*) FROM cases) AS total_cases
      FROM gene_burden_summary
      ORDER BY affected_case_count DESC, variant_count DESC
    `
    const stmt = this.getStatement(sql)
    return stmt.all() as GeneBurden[]
  }
```

- [ ] **Step 5: Run cohort tests**

Run: `npx vitest run tests/main/database/cohort.test.ts`
Expected: PASS (all existing behavior preserved)

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/main/database/cohort.ts tests/main/database/cohort.test.ts
git commit -m "feat(db): rewrite cohort queries to read from summary tables (#33)"
```

---

## Chunk 4: IPC and Preload Integration

### Task 9: Add IPC handlers for summary status and rebuild

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts`

- [ ] **Step 1: Add summary IPC handlers**

In `src/main/ipc/handlers/cohort.ts`, add import at top:
```typescript
import { BrowserWindow } from 'electron'
```

Add `safeEmit` helper (same pattern as `cases.ts`):
```typescript
function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}
```

Add two new handlers inside `registerCohortHandlers`:

```typescript
  // Summary status
  ipcMain.handle('cohort:summaryStatus', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cohortSummary.getStatus()
    })
  })

  // Manual rebuild trigger
  ipcMain.handle('cohort:rebuildSummary', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      db.cohortSummary.rebuild()
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
  })
```

Note: The single case delete deferred rebuild was already wired in Task 7 (cases.ts handler).

- [ ] **Step 2: Run handler tests**

Run: `npx vitest run tests/main/handlers/cohort-handlers.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts src/main/ipc/handlers/cases.ts
git commit -m "feat(ipc): add cohort summary status and rebuild handlers (#33)"
```

---

### Task 10: Update preload bridge

**Files:**
- Modify: `src/preload/index.ts:148-170`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add new cohort API methods**

In `src/preload/index.ts`, add to the `cohort` object (after line 153):

```typescript
    getSummaryStatus: () => ipcRenderer.invoke('cohort:summaryStatus'),
    rebuildSummary: () => ipcRenderer.invoke('cohort:rebuildSummary'),
    onSummaryRebuilt: (
      callback: (status: { is_stale: boolean }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: { is_stale: boolean }
      ): void => {
        callback(status)
      }
      ipcRenderer.on('cohort:summaryRebuilt', handler)
      return () => {
        ipcRenderer.removeListener('cohort:summaryRebuilt', handler)
      }
    },
```

- [ ] **Step 2: Update `src/preload/index.d.ts`**

Add the new methods to the cohort type declaration (match the implementation above).

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): expose cohort summary status and rebuild API (#33)"
```

---

## Chunk 5: Renderer Integration

### Task 11: Add staleness state to useCohortData composable

**Files:**
- Modify: `src/renderer/src/composables/useCohortData.ts`

- [ ] **Step 1: Add summaryStale ref and listener**

Add to the composable:

```typescript
  const summaryStale = ref(false)

  // Listen for summary rebuild events
  let cleanupSummaryListener: (() => void) | null = null
  if (api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cohortApi = (api as any).cohort
    if (cohortApi.onSummaryRebuilt) {
      cleanupSummaryListener = cohortApi.onSummaryRebuilt(
        (status: { is_stale: boolean }) => {
          summaryStale.value = status.is_stale
        }
      )
    }
  }
```

Add to the return interface and return value:
```typescript
  summaryStale: Ref<boolean>
  cleanupListeners: () => void
```

Add cleanup method:
```typescript
  const cleanupListeners = (): void => {
    if (cleanupSummaryListener) {
      cleanupSummaryListener()
      cleanupSummaryListener = null
    }
  }
```

Update `reset` to also reset stale:
```typescript
  const reset = (): void => {
    variants.value = []
    totalCount.value = 0
    error.value = null
    summary.value = null
    summaryStale.value = false
  }
```

- [ ] **Step 2: Run composable tests**

Run: `npx vitest run tests/renderer/composables/useCohortData.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/composables/useCohortData.ts
git commit -m "feat(renderer): add summaryStale state to useCohortData (#33)"
```

---

### Task 12: Add staleness indicator to CohortTable

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue`

- [ ] **Step 1: Add staleness chip to template**

Find the table header area in `CohortTable.vue` and add a stale indicator chip. Use Vuetify's `v-chip` component:

```vue
<v-chip
  v-if="summaryStale"
  size="small"
  color="warning"
  variant="tonal"
  class="ml-2"
>
  <v-progress-circular
    indeterminate
    size="12"
    width="2"
    class="mr-1"
  />
  Updating cohort...
</v-chip>
```

Wire `summaryStale` and `cleanupListeners` from the composable into the component's setup.

Add auto-refresh: when `summaryStale` flips from `true` to `false`, re-fetch the current page:

```typescript
watch(summaryStale, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // Summary rebuilt — refresh current page
    loadVariants()
    fetchSummary()
  }
})
```

**IMPORTANT:** Call `cleanupListeners()` on component unmount to prevent memory leaks:
```typescript
onUnmounted(() => {
  cleanupListeners()
})
```

- [ ] **Step 2: Test manually (if dev server is available)**

Run: `make dev`
Verify: chip appears during import, clears after rebuild

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/CohortTable.vue
git commit -m "feat(ui): add cohort summary staleness indicator (#33)"
```

---

### Task 13: Handle first load after migration

**Files:**
- Modify: `src/renderer/src/composables/useCohortData.ts`

- [ ] **Step 1: Add first-load detection**

In `fetchVariants`, before the actual query, check if the summary table is empty and variants exist. If so, trigger a rebuild:

```typescript
  const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
    if (!api) return

    isLoading.value = true
    error.value = null

    try {
      const plainParams = globalThis.structuredClone(buildIpcParams(params))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).cohort.getVariants(plainParams)

      // First load after migration: if no results but summary might be empty
      // and database has data, trigger rebuild and retry.
      // Guard: also check summary status to avoid pointless rebuild on empty databases.
      if (result.data.length === 0 && result.total_count === 0 && params.offset === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cohortApi = (api as any).cohort
        if (cohortApi.getSummaryStatus) {
          const status = await cohortApi.getSummaryStatus()
          if (status.last_rebuilt_at === 0) {
            // Never rebuilt — trigger initial build
            summaryStale.value = true
            await cohortApi.rebuildSummary()
            // rebuildSummary will send summaryRebuilt event, which triggers refetch via watcher
            return
          }
        }
      }

      variants.value = result.data ?? []
      totalCount.value = result.total_count ?? 0
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      variants.value = []
      totalCount.value = 0
    } finally {
      isLoading.value = false
    }
  }
```

- [ ] **Step 2: Run composable tests**

Run: `npx vitest run tests/renderer/composables/useCohortData.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/composables/useCohortData.ts
git commit -m "feat(renderer): trigger initial summary rebuild on first load (#33)"
```

---

## Chunk 6: Final Validation

### Task 14: Notify renderer after import/delete workers complete

**Files:**
- Modify: `src/main/ipc/handlers/batch-import.ts:192-218`
- Modify: `src/main/ipc/handlers/cases.ts:84-105,107-126`

Both files already have a `safeEmit` helper (using `BrowserWindow.getAllWindows()[0]`).

- [ ] **Step 1: Send summaryRebuilt events in batch-import handler**

In `src/main/ipc/handlers/batch-import.ts`:

At the start of `batch-import:start` handler (line 150, after getting `db`), add:
```typescript
        safeEmit('cohort:summaryRebuilt', { is_stale: true })
```

In the `onComplete` callback (around line 192), after `safeEmit('batch-import:complete', ...)`:
```typescript
              safeEmit('cohort:summaryRebuilt', { is_stale: false })
```

- [ ] **Step 2: Send summaryRebuilt events in bulk delete handlers**

In `src/main/ipc/handlers/cases.ts`:

In `cases:deleteAll` handler (line 84), before `runDeleteWorker`:
```typescript
      safeEmit('cohort:summaryRebuilt', { is_stale: true })
```

After `runDeleteWorker` completes (line 94, after `safeEmit('cases:deleted', ...)`):
```typescript
        safeEmit('cohort:summaryRebuilt', { is_stale: false })
```

Same pattern for `cases:deleteBatch` (line 107): add `safeEmit` stale before `runDeleteWorker`, and not-stale after it completes.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/handlers/batch-import.ts src/main/ipc/handlers/cases.ts
git commit -m "feat(ipc): send summaryRebuilt events after import/delete workers (#33)"
```

---

### Task 15: Run full CI checks

- [ ] **Step 1: Lint**

Run: `make lint`
Expected: PASS (fix any lint errors)

- [ ] **Step 2: Typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 3: Full test suite**

Run: `make test`
Expected: PASS

- [ ] **Step 4: Build**

Run: `make dist`
Expected: PASS (app packages correctly)

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address lint/type/test issues from cohort summary implementation (#33)"
```
