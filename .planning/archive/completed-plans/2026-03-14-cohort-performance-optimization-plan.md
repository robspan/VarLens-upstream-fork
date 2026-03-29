# Cohort Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize cohort view queries from ~200k summary rows by eliminating correlated subqueries, splitting COUNT, pre-computing filterable columns, adding incremental updates, and improving renderer reactivity.

**Architecture:** Migration v14 adds denormalized annotation flags + cohort_frequency + AFTER triggers to `cohort_variant_summary`. Query service switches from EXISTS subqueries to simple column checks, splits COUNT from data query. Renderer gets shallowRef, generation counter, count caching, and removes redundant structuredClone.

**Tech Stack:** SQLite (better-sqlite3), Electron IPC, Vue 3 Composition API, Vitest

**Spec:** `.planning/specs/2026-03-14-cohort-performance-optimization-design.md`

---

## File Structure

### Modified files:
- `src/main/database/migrations.ts` — Migration v14: ALTER TABLE, indexes, 6 AFTER triggers
- `src/shared/sql/cohort-summary-rebuild.ts` — Updated rebuild SQL with LEFT JOIN + annotation flags + cohort_frequency; incremental SQL constants
- `src/main/database/cohort.ts` — Simplified WHERE clauses, split COUNT, PK tiebreaker, use stored cohort_frequency for WHERE
- `src/shared/types/cohort.ts` — Add `_count_needed` to `CohortSearchParams`
- `src/main/database/CohortSummaryService.ts` — Add `incrementalAdd()`, `incrementalRemove()`
- `src/main/database/DatabaseService.ts` — Add `PRAGMA optimize=0x10002`
- `src/renderer/src/composables/useCohortData.ts` — shallowRef, generation counter, count caching, remove structuredClone
- `src/main/ipc/handlers/cases.ts` — Use incremental remove for single-case deletes

### Deferred (follow-up task):
- `src/main/workers/import-worker.ts` — Use incremental add for single-file imports (requires reading the full worker to find the right integration point; deferred to avoid scope creep)

### Test files:
- `tests/main/database/migrations.test.ts` — Migration v14 tests
- `tests/main/database/cohort.test.ts` — Updated cohort query tests
- `tests/main/database/cohort-summary.test.ts` — New: incremental add/remove + trigger tests

---

## Chunk 1: Schema + Rebuild SQL (Phase 1 core)

### Task 1: Migration v14 — Schema Changes

**Files:**
- Modify: `src/main/database/migrations.ts:618-620`
- Test: `tests/main/database/migrations.test.ts`

- [ ] **Step 1: Write failing test for migration v14 schema**

In `tests/main/database/migrations.test.ts`, add:

```typescript
it('should add annotation columns and frequency to cohort_variant_summary in v14', () => {
  const dbPath = tempDbPath()
  const service = new DatabaseService(dbPath)

  const db = (service as any).db as Database.Database

  // Verify new columns exist
  const columns = db
    .prepare("PRAGMA table_info('cohort_variant_summary')")
    .all() as { name: string; type: string; notnull: number }[]
  const columnNames = columns.map((c) => c.name)

  expect(columnNames).toContain('has_star')
  expect(columnNames).toContain('has_comment')
  expect(columnNames).toContain('acmg_best')
  expect(columnNames).toContain('cohort_frequency')

  // Verify has_star and has_comment have NOT NULL DEFAULT 0
  const hasStar = columns.find((c) => c.name === 'has_star')!
  expect(hasStar.notnull).toBe(1)

  // Verify cohort_frequency index exists
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cohort_variant_summary'")
    .all() as { name: string }[]
  const indexNames = indexes.map((i) => i.name)
  expect(indexNames).toContain('idx_cvs_cohort_freq')

  // Verify user_version = 14
  const version = db.pragma('user_version', { simple: true }) as number
  expect(version).toBe(14)

  service.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rebuild:node && npx vitest run tests/main/database/migrations.test.ts -t "v14"`
Expected: FAIL — columns don't exist, version is 13

- [ ] **Step 3: Implement migration v14 schema changes**

In `src/main/database/migrations.ts`, after the `if (currentVersion < 13)` block (line 618), add:

```typescript
  // ── Migration v14: Cohort performance optimization ──
  if (currentVersion < 14) {
    // Denormalized annotation flags
    db.exec(`
      ALTER TABLE cohort_variant_summary ADD COLUMN has_star INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cohort_variant_summary ADD COLUMN has_comment INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cohort_variant_summary ADD COLUMN acmg_best TEXT;
      ALTER TABLE cohort_variant_summary ADD COLUMN cohort_frequency REAL;
    `)

    // Index for frequency filter
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq
        ON cohort_variant_summary(cohort_frequency);
    `)

    db.exec('PRAGMA user_version = 14')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/migrations.test.ts -t "v14"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/migrations.test.ts
git commit -m "feat(db): migration v14 — add annotation flags and cohort_frequency columns"
```

---

### Task 2: Migration v14 — AFTER Triggers

**Files:**
- Modify: `src/main/database/migrations.ts`
- Test: `tests/main/database/cohort-summary.test.ts` (create)

- [ ] **Step 1: Write failing test for trigger behavior**

Create `tests/main/database/cohort-summary.test.ts`:

```typescript
/**
 * CohortSummaryService + trigger tests
 *
 * Tests annotation trigger sync behavior:
 * - Starring a variant updates has_star in summary
 * - Adding a comment updates has_comment in summary
 * - Setting ACMG classification updates acmg_best
 * - Deleting annotation reverts flags
 * - ACMG ranking: Pathogenic > Likely pathogenic > VUS > Likely benign > Benign
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('Annotation Triggers', () => {
  let db: Database.Database
  let summaryService: CohortSummaryService

  const insertCase = (name: string): number => {
    return db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, 0, Date.now()).lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    return db
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(caseId, chr, pos, ref, alt, 'BRCA1', '0/1').lastInsertRowid as number
  }

  const getSummaryRow = (chr: string, pos: number, ref: string, alt: string) => {
    return db
      .prepare(
        'SELECT has_star, has_comment, acmg_best FROM cohort_variant_summary WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
      )
      .get(chr, pos, ref, alt) as { has_star: number; has_comment: number; acmg_best: string | null } | undefined
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    summaryService = new CohortSummaryService(db)

    // Insert test data
    const caseId = insertCase('test-case')
    insertVariant(caseId, '1', 12345, 'A', 'G')
    summaryService.rebuild()
  })

  afterEach(() => {
    db.close()
  })

  it('should set has_star=1 when global annotation is starred', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 1, 0, 0)`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_star).toBe(1)
  })

  it('should revert has_star=0 when global star is deleted', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 1, 0, 0)`
    ).run()
    db.prepare(
      `DELETE FROM variant_annotations WHERE chr = '1' AND pos = 12345 AND ref = 'A' AND alt = 'G'`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_star).toBe(0)
  })

  it('should pick most pathogenic ACMG classification', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, acmg_classification, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 'Likely benign', 0, 0)`
    ).run()

    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Likely benign')

    // Per-case annotation with higher pathogenicity should win
    const variantId = db
      .prepare("SELECT id FROM variants WHERE chr = '1' AND pos = 12345 AND ref = 'A' AND alt = 'G'")
      .get() as { id: number }

    db.prepare(
      `INSERT INTO case_variant_annotations (case_id, variant_id, acmg_classification, created_at, updated_at)
       VALUES (1, ?, 'Pathogenic', 0, 0)`
    ).run(variantId.id)

    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Pathogenic')
  })

  it('should set has_comment=1 when global comment is added', () => {
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, global_comment, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 0, 'important finding', 0, 0)`
    ).run()

    const row = getSummaryRow('1', 12345, 'A', 'G')
    expect(row?.has_comment).toBe(1)
    expect(row?.has_star).toBe(0)
  })

  it('should rank ACMG classifications: Pathogenic > LP > VUS > LB > Benign', () => {
    // Start with Benign
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, acmg_classification, created_at, updated_at)
       VALUES ('1', 12345, 'A', 'G', 'Benign', 0, 0)`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Benign')

    // Update to Uncertain significance — should upgrade
    db.prepare(
      `UPDATE variant_annotations SET acmg_classification = 'Uncertain significance' WHERE chr = '1' AND pos = 12345`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Uncertain significance')

    // Update to Likely pathogenic — should upgrade
    db.prepare(
      `UPDATE variant_annotations SET acmg_classification = 'Likely pathogenic' WHERE chr = '1' AND pos = 12345`
    ).run()
    expect(getSummaryRow('1', 12345, 'A', 'G')?.acmg_best).toBe('Likely pathogenic')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts`
Expected: FAIL — triggers don't exist yet, has_star stays 0

- [ ] **Step 3: Implement AFTER triggers in migration v14**

In `src/main/database/migrations.ts`, inside the `if (currentVersion < 14)` block, after the index creation, add the 6 triggers. The canonical recompute body is shared — each trigger only differs in WHERE target (NEW.* vs OLD.* vs subquery on variants):

```typescript
    // AFTER triggers for real-time annotation sync
    // Uses canonical recompute: full re-derive from both annotation tables
    // UPDATE triggers have WHEN guards to skip no-op upserts

    // -- variant_annotations triggers --
    db.exec(`
      CREATE TRIGGER trg_va_after_insert
      AFTER INSERT ON variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = NEW.chr AND pos = NEW.pos AND ref = NEW.ref AND alt = NEW.alt;
      END
    `)

    db.exec(`
      CREATE TRIGGER trg_va_after_update
      AFTER UPDATE ON variant_annotations
      FOR EACH ROW
      WHEN OLD.starred != NEW.starred
        OR OLD.global_comment IS NOT NEW.global_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = NEW.chr AND pos = NEW.pos AND ref = NEW.ref AND alt = NEW.alt;
      END
    `)

    db.exec(`
      CREATE TRIGGER trg_va_after_delete
      AFTER DELETE ON variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = OLD.chr AND pos = OLD.pos AND ref = OLD.ref AND alt = OLD.alt;
      END
    `)

    // -- case_variant_annotations triggers --
    db.exec(`
      CREATE TRIGGER trg_cva_after_insert
      AFTER INSERT ON case_variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva2.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva2
              JOIN variants v2 ON cva2.variant_id = v2.id
              WHERE v2.chr = cohort_variant_summary.chr AND v2.pos = cohort_variant_summary.pos
              AND v2.ref = cohort_variant_summary.ref AND v2.alt = cohort_variant_summary.alt
              AND cva2.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = NEW.variant_id
        );
      END
    `)

    db.exec(`
      CREATE TRIGGER trg_cva_after_update
      AFTER UPDATE ON case_variant_annotations
      FOR EACH ROW
      WHEN OLD.starred != NEW.starred
        OR OLD.per_case_comment IS NOT NEW.per_case_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva2.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva2
              JOIN variants v2 ON cva2.variant_id = v2.id
              WHERE v2.chr = cohort_variant_summary.chr AND v2.pos = cohort_variant_summary.pos
              AND v2.ref = cohort_variant_summary.ref AND v2.alt = cohort_variant_summary.alt
              AND cva2.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = NEW.variant_id
        );
      END
    `)

    db.exec(`
      CREATE TRIGGER trg_cva_after_delete
      AFTER DELETE ON case_variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva2.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva2
              JOIN variants v2 ON cva2.variant_id = v2.id
              WHERE v2.chr = cohort_variant_summary.chr AND v2.pos = cohort_variant_summary.pos
              AND v2.ref = cohort_variant_summary.ref AND v2.alt = cohort_variant_summary.alt
              AND cva2.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = OLD.variant_id
        );
      END
    `)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/cohort-summary.test.ts
git commit -m "feat(db): migration v14 — add AFTER triggers for annotation sync"
```

---

### Task 3: Update Rebuild SQL

**Files:**
- Modify: `src/shared/sql/cohort-summary-rebuild.ts`
- Test: `tests/main/database/cohort-summary.test.ts`

- [ ] **Step 1: Write failing test for rebuild with annotation flags**

Add to `tests/main/database/cohort-summary.test.ts`:

```typescript
describe('Rebuild with annotation flags', () => {
  let db: Database.Database
  let summaryService: CohortSummaryService

  // ... same setup helpers as above ...

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    summaryService = new CohortSummaryService(db)
  })

  afterEach(() => { db.close() })

  it('should populate annotation flags and cohort_frequency during rebuild', () => {
    const caseId = insertCase('test')
    insertVariant(caseId, '1', 100, 'A', 'G')
    insertVariant(caseId, '1', 200, 'C', 'T')

    // Star one variant globally
    db.prepare(
      `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, global_comment, created_at, updated_at)
       VALUES ('1', 100, 'A', 'G', 1, 'test comment', 0, 0)`
    ).run()

    summaryService.rebuild()

    const starred = db.prepare(
      "SELECT has_star, has_comment, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
    ).get() as { has_star: number; has_comment: number; cohort_frequency: number }

    expect(starred.has_star).toBe(1)
    expect(starred.has_comment).toBe(1)
    expect(starred.cohort_frequency).toBeCloseTo(1.0) // 1 carrier / 1 case

    const unstarred = db.prepare(
      "SELECT has_star, has_comment, cohort_frequency FROM cohort_variant_summary WHERE chr = '1' AND pos = 200"
    ).get() as { has_star: number; has_comment: number; cohort_frequency: number }

    expect(unstarred.has_star).toBe(0)
    expect(unstarred.has_comment).toBe(0)
    expect(unstarred.cohort_frequency).toBeCloseTo(1.0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts -t "populate annotation"`
Expected: FAIL — rebuild doesn't populate new columns

- [ ] **Step 3: Replace REBUILD_VARIANT_SUMMARY_SQL with single-pass LEFT JOIN version**

Replace the entire `REBUILD_VARIANT_SUMMARY_SQL` constant in `src/shared/sql/cohort-summary-rebuild.ts` with:

```typescript
export const REBUILD_VARIANT_SUMMARY_SQL = `
  DELETE FROM cohort_variant_summary;
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key
  )
  SELECT
    d.chr, d.pos, d.ref, d.alt,
    d.gene_symbol, d.cdna, d.aa_change,
    d.consequence, d.func, d.clinvar, d.gnomad_af, d.cadd,
    d.transcript, d.omim_mim_number,
    d.carrier_count, d.het_count, d.hom_count,
    CAST(d.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases),
    CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
    CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
    va.acmg_classification,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt
  FROM (
    WITH deduped AS (
      SELECT chr, pos, ref, alt, case_id,
        MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
        MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
        MAX(func) AS func, MAX(clinvar) AS clinvar,
        MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
        MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
        MAX(gt_num) AS gt_num
      FROM variants
      GROUP BY chr, pos, ref, alt, case_id
    )
    SELECT chr, pos, ref, alt,
      MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
      MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
      MAX(func) AS func, MAX(clinvar) AS clinvar,
      MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
      MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
      COUNT(*) AS carrier_count,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
    FROM deduped
    GROUP BY chr, pos, ref, alt
  ) d
  LEFT JOIN variant_annotations va
    ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt;
`
```

- [ ] **Step 4: Add UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL constant**

Add this new constant to `src/shared/sql/cohort-summary-rebuild.ts`:

```typescript
export const UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL = `
  UPDATE cohort_variant_summary SET
    has_star = CASE WHEN has_star = 1 THEN 1 WHEN pca.has_star = 1 THEN 1 ELSE 0 END,
    has_comment = CASE WHEN has_comment = 1 THEN 1 WHEN pca.has_comment = 1 THEN 1 ELSE 0 END,
    acmg_best = CASE
      WHEN pca.acmg_rank > CASE acmg_best
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END
      THEN pca.acmg_best
      ELSE acmg_best
    END
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt,
      MAX(cva.starred) AS has_star,
      MAX(CASE WHEN cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
        THEN 1 ELSE 0 END) AS has_comment,
      CASE MAX(CASE cva.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END)
        WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
        WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
        WHEN 1 THEN 'Benign' ELSE NULL
      END AS acmg_best,
      MAX(CASE cva.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END) AS acmg_rank
    FROM case_variant_annotations cva
    JOIN variants v ON cva.variant_id = v.id
    GROUP BY v.chr, v.pos, v.ref, v.alt
  ) pca
  WHERE cohort_variant_summary.chr = pca.chr
    AND cohort_variant_summary.pos = pca.pos
    AND cohort_variant_summary.ref = pca.ref
    AND cohort_variant_summary.alt = pca.alt;
`
```

- [ ] **Step 5: Update CohortSummaryService.rebuild() to run per-case annotation pass**

In `src/main/database/CohortSummaryService.ts`, import the new SQL constant and add it to the rebuild transaction:

```typescript
import {
  REBUILD_VARIANT_SUMMARY_SQL,
  REBUILD_GENE_BURDEN_SQL,
  UPDATE_META_SQL,
  MARK_STALE_SQL,
  UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

// In rebuild():
const rebuildTransaction = this.db.transaction(() => {
  this.db.exec(REBUILD_VARIANT_SUMMARY_SQL)
  this.db.exec(UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL)
  this.db.exec(REBUILD_GENE_BURDEN_SQL)
  this.db.exec(UPDATE_META_SQL)
})
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `npx vitest run tests/main/database/cohort.test.ts`
Expected: PASS (existing tests should still work — new columns are additive)

- [ ] **Step 7: Commit**

```bash
git add src/shared/sql/cohort-summary-rebuild.ts src/main/database/CohortSummaryService.ts tests/main/database/cohort-summary.test.ts
git commit -m "feat(db): update rebuild SQL with LEFT JOIN for annotation flags and cohort_frequency"
```

---

## Chunk 2: Query Simplification + COUNT Split (Phase 1 queries)

### Task 4: Add _count_needed to CohortSearchParams

**Files:**
- Modify: `src/shared/types/cohort.ts:122-159`

- [ ] **Step 1: Add `_count_needed` field**

In `src/shared/types/cohort.ts`, add to `CohortSearchParams`:

```typescript
  /** Whether the total count needs to be recomputed (false = use cached count) */
  _count_needed?: boolean
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types/cohort.ts
git commit -m "feat(types): add _count_needed to CohortSearchParams"
```

---

### Task 5: Simplify Cohort Query WHERE Clauses + Split COUNT

**Files:**
- Modify: `src/main/database/cohort.ts:72-277`
- Test: `tests/main/database/cohort.test.ts`

- [ ] **Step 1: Write test for simplified annotation filters**

Add to `tests/main/database/cohort.test.ts`:

```typescript
it('should filter by has_star column (not EXISTS subquery)', () => {
  // Insert data, rebuild, star a variant via annotation
  const caseId = insertCase('test')
  insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
  insertVariant(caseId, '1', 200, 'C', 'T', { gene_symbol: 'TP53' })
  summaryService.rebuild()

  db.prepare(
    `INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
     VALUES ('1', 100, 'A', 'G', 1, 0, 0)`
  ).run()

  const result = cohortService.getCohortVariants({ starred_only: true })
  expect(result.data).toHaveLength(1)
  expect(result.data[0].gene_symbol).toBe('BRCA1')
})
```

- [ ] **Step 2: Run test to verify it still passes with current code**

Run: `npx vitest run tests/main/database/cohort.test.ts -t "has_star"`
Expected: PASS (the trigger already set has_star=1, but the query still uses EXISTS — both work)

- [ ] **Step 3: Simplify WHERE clauses in getCohortVariants**

In `src/main/database/cohort.ts`, replace the annotation filter blocks (lines 161-202) with:

```typescript
    // Annotation filters (use denormalized columns from v14)
    if (params.starred_only === true) {
      whereConditions.push('cvs.has_star = 1')
    }

    if (params.has_comment === true) {
      whereConditions.push('cvs.has_comment = 1')
    }

    if (params.acmg_classifications !== undefined && params.acmg_classifications.length > 0) {
      const placeholders = params.acmg_classifications.map(() => '?').join(', ')
      whereConditions.push(`cvs.acmg_best IN (${placeholders})`)
      paramsArray.push(...params.acmg_classifications)
    }
```

Replace the cohort_frequency WHERE filter (line 157) with:

```typescript
    if (params.cohort_frequency_min !== undefined && params.cohort_frequency_min > 0) {
      whereConditions.push('cvs.cohort_frequency >= ?')
      paramsArray.push(params.cohort_frequency_min)
    }
```

- [ ] **Step 4: Split COUNT from data query**

Replace the SELECT + COUNT(*) OVER() block (lines 224-276) with:

```typescript
    // Count query (only when filters change, not on page/sort change)
    let totalCount = 0
    if (params._count_needed !== false) {
      const countSql = `
        SELECT COUNT(*) as count
        FROM cohort_variant_summary cvs
        ${whereClause}
      `
      const countResult = this.db.prepare(countSql).get(...paramsArray) as { count: number }
      totalCount = countResult.count
    }

    // Build ORDER BY — use PK columns as tiebreaker instead of variant_key
    const direction = sortOrder.toUpperCase()
    const orderByClause = `ORDER BY ${sortBy} ${direction}, chr ASC, pos ASC, ref ASC, alt ASC`

    // Data query — no window function, LIMIT benefits from early termination
    const sql = `
      SELECT
        cvs.chr,
        cvs.pos,
        cvs.ref,
        cvs.alt,
        cvs.gene_symbol,
        cvs.cdna,
        cvs.aa_change,
        cvs.carrier_count,
        ${totalCases} AS total_cases,
        CAST(cvs.carrier_count AS REAL) / ${totalCases} AS cohort_frequency,
        cvs.het_count,
        cvs.hom_count,
        cvs.variant_key,
        cvs.consequence,
        cvs.func,
        cvs.clinvar,
        cvs.gnomad_af,
        cvs.cadd AS cadd_phred,
        cvs.transcript,
        cvs.omim_mim_number AS omim_id
      FROM cohort_variant_summary cvs
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `

    const stmt = this.getStatement(sql)
    const results = stmt.all(...paramsArray, limit, offset) as CohortVariant[]

    return {
      data: results,
      total_count: totalCount
    }
```

- [ ] **Step 5: Write test for _count_needed flag**

Add to `tests/main/database/cohort.test.ts`:

```typescript
it('should skip count query when _count_needed is false', () => {
  const caseId = insertCase('test')
  insertVariant(caseId, '1', 100, 'A', 'G', { gene_symbol: 'BRCA1' })
  insertVariant(caseId, '1', 200, 'C', 'T', { gene_symbol: 'TP53' })
  summaryService.rebuild()

  // With _count_needed: false, total_count should be 0 (not computed)
  const result = cohortService.getCohortVariants({ _count_needed: false })
  expect(result.total_count).toBe(0)
  expect(result.data.length).toBeGreaterThan(0) // data still returned

  // With _count_needed: true (default), total_count should be computed
  const result2 = cohortService.getCohortVariants({})
  expect(result2.total_count).toBe(2)
})
```

- [ ] **Step 6: Run all cohort tests**

Run: `npx vitest run tests/main/database/cohort.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/database/cohort.ts tests/main/database/cohort.test.ts
git commit -m "perf(db): simplify annotation filters to column checks, split COUNT from data query"
```

---

## Chunk 3: Renderer Optimizations (Phase 2)

### Task 6: PRAGMA optimize

**Files:**
- Modify: `src/main/database/DatabaseService.ts:90`

- [ ] **Step 1: Add PRAGMA optimize after existing PRAGMAs**

After `db.pragma('mmap_size = ...')` (line 90), add:

```typescript
      // Analyze tables with stale statistics on connection open
      db.pragma('optimize=0x10002')
```

- [ ] **Step 2: Commit**

```bash
git add src/main/database/DatabaseService.ts
git commit -m "perf(db): add PRAGMA optimize on database open"
```

---

### Task 7: Renderer — shallowRef, generation counter, count caching, remove structuredClone

**Files:**
- Modify: `src/renderer/src/composables/useCohortData.ts`

- [ ] **Step 1: Change `ref` to `shallowRef` for variants array**

In `useCohortData.ts`, change the import and the variants declaration:

```typescript
import { ref, shallowRef } from 'vue'

// Change line 98 from:
const variants = ref<CohortVariant[]>([])
// To:
const variants = shallowRef<CohortVariant[]>([])
```

- [ ] **Step 2: Add generation counter and count caching to fetchVariants**

Replace the `fetchVariants` function (lines 197-219) with:

```typescript
  let requestGeneration = 0
  let cachedFilterHash = ''

  const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
    if (!api) {
      console.warn('API not available - running outside Electron')
      return
    }

    const thisGeneration = ++requestGeneration
    isLoading.value = true
    error.value = null

    try {
      // Determine if filters changed (exclude pagination/sort params)
      const { offset, limit, sort_by, sort_order, ...filterParams } = params
      const filterHash = JSON.stringify(filterParams)
      const filtersChanged = filterHash !== cachedFilterHash

      const ipcParams = buildIpcParams(params)
      if (!filtersChanged) {
        ipcParams._count_needed = false
      }

      // No structuredClone — buildIpcParams already strips Vue Proxies via spread
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).cohort.getVariants(ipcParams)

      // Discard stale responses from superseded requests
      if (thisGeneration !== requestGeneration) return

      variants.value = result.data ?? []
      if (filtersChanged) {
        totalCount.value = result.total_count ?? 0
        cachedFilterHash = filterHash
      }
    } catch (err) {
      if (thisGeneration !== requestGeneration) return
      error.value = err instanceof Error ? err : new Error(String(err))
      variants.value = []
      totalCount.value = 0
    } finally {
      if (thisGeneration === requestGeneration) {
        isLoading.value = false
      }
    }
  }
```

- [ ] **Step 3: Update reset() to clear cached state**

In the `reset()` function, add:

```typescript
  const reset = (): void => {
    variants.value = []
    totalCount.value = 0
    error.value = null
    summary.value = null
    summaryStale.value = false
    cachedFilterHash = ''
    requestGeneration = 0
  }
```

Note: `requestGeneration` and `cachedFilterHash` need to be declared at the composable scope (not inside fetchVariants) so reset() can access them. Move them above `fetchVariants`.

- [ ] **Step 4: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useCohortData.ts
git commit -m "perf(renderer): shallowRef, generation counter, count caching, remove structuredClone"
```

---

## Chunk 4: Incremental Updates (Phase 3)

### Task 8: Incremental Add/Remove in CohortSummaryService

**Files:**
- Modify: `src/main/database/CohortSummaryService.ts`
- Modify: `src/shared/sql/cohort-summary-rebuild.ts`
- Test: `tests/main/database/cohort-summary.test.ts`

- [ ] **Step 1: Write failing tests for incremental operations**

Add to `tests/main/database/cohort-summary.test.ts`:

```typescript
describe('Incremental updates', () => {
  // ... same setup ...

  it('should incrementally add a case without full rebuild', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    insertVariant(case1, '1', 200, 'C', 'T')
    summaryService.rebuild()

    // Add second case sharing one variant
    const case2 = insertCase('case2')
    insertVariant(case2, '1', 100, 'A', 'G')
    insertVariant(case2, '1', 300, 'G', 'A')
    summaryService.incrementalAdd(case2)

    const shared = db.prepare(
      "SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
    ).get() as { carrier_count: number }
    expect(shared.carrier_count).toBe(2)

    const newVariant = db.prepare(
      "SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 300"
    ).get() as { carrier_count: number }
    expect(newVariant.carrier_count).toBe(1)

    const total = db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get() as { c: number }
    expect(total.c).toBe(3) // 100, 200, 300
  })

  it('should incrementally remove a case without full rebuild', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    insertVariant(case1, '1', 200, 'C', 'T')
    const case2 = insertCase('case2')
    insertVariant(case2, '1', 100, 'A', 'G')
    summaryService.rebuild()

    // Remove case2 (shares variant at pos 100)
    summaryService.incrementalRemove(case2)
    db.prepare('DELETE FROM cases WHERE id = ?').run(case2)

    const shared = db.prepare(
      "SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
    ).get() as { carrier_count: number }
    expect(shared.carrier_count).toBe(1)

    // Variant at 200 should be unchanged
    const unchanged = db.prepare(
      "SELECT carrier_count FROM cohort_variant_summary WHERE chr = '1' AND pos = 200"
    ).get() as { carrier_count: number }
    expect(unchanged.carrier_count).toBe(1)
  })

  it('should remove summary rows with zero carriers after incremental remove', () => {
    const case1 = insertCase('case1')
    insertVariant(case1, '1', 100, 'A', 'G')
    summaryService.rebuild()

    summaryService.incrementalRemove(case1)

    const row = db.prepare(
      "SELECT * FROM cohort_variant_summary WHERE chr = '1' AND pos = 100"
    ).get()
    expect(row).toBeUndefined() // removed because carrier_count dropped to 0
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts -t "Incremental"`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Add incremental SQL constants**

In `src/shared/sql/cohort-summary-rebuild.ts`, add:

```typescript
export const INCREMENTAL_ADD_SQL = `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key
  )
  SELECT
    chr, pos, ref, alt,
    MAX(gene_symbol), MAX(cdna), MAX(aa_change),
    MAX(consequence), MAX(func), MAX(clinvar),
    MAX(gnomad_af), MAX(cadd), MAX(transcript), MAX(omim_mim_number),
    1,
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
    CAST(1 AS REAL) / (SELECT COUNT(*) FROM cases),
    0, 0, NULL,
    chr || ':' || pos || ':' || ref || ':' || alt
  FROM variants
  WHERE case_id = ?
  GROUP BY chr, pos, ref, alt
  ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
    carrier_count = carrier_count + excluded.carrier_count,
    het_count = het_count + excluded.het_count,
    hom_count = hom_count + excluded.hom_count,
    cohort_frequency = CAST(carrier_count + excluded.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases);
`

export const INCREMENTAL_REMOVE_SQL = `
  UPDATE cohort_variant_summary SET
    carrier_count = carrier_count - sub.carrier_count,
    het_count = het_count - sub.het_count,
    hom_count = hom_count - sub.hom_count,
    cohort_frequency = CAST(carrier_count - sub.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases)
  FROM (
    SELECT chr, pos, ref, alt,
      COUNT(DISTINCT case_id) AS carrier_count,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
    FROM variants
    WHERE case_id = ?
    GROUP BY chr, pos, ref, alt
  ) sub
  WHERE cohort_variant_summary.chr = sub.chr
    AND cohort_variant_summary.pos = sub.pos
    AND cohort_variant_summary.ref = sub.ref
    AND cohort_variant_summary.alt = sub.alt;
`

export const CLEANUP_ZERO_CARRIERS_SQL = `
  DELETE FROM cohort_variant_summary WHERE carrier_count <= 0;
`
```

- [ ] **Step 4: Add incrementalAdd and incrementalRemove to CohortSummaryService**

In `src/main/database/CohortSummaryService.ts`, add:

```typescript
import {
  // ... existing imports ...
  INCREMENTAL_ADD_SQL,
  INCREMENTAL_REMOVE_SQL,
  CLEANUP_ZERO_CARRIERS_SQL
} from '../../shared/sql/cohort-summary-rebuild'

  /**
   * Incrementally add a single case's variants to the summary.
   * Much faster than full rebuild for single-case imports (~1,500 variants vs 200k).
   */
  incrementalAdd(caseId: number): void {
    const addTransaction = this.db.transaction(() => {
      this.db.prepare(INCREMENTAL_ADD_SQL).run(caseId)
      this.db.exec(UPDATE_META_SQL)
    })
    addTransaction()

    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch { /* best effort */ }
  }

  /**
   * Incrementally remove a single case's variants from the summary.
   * Must be called BEFORE the case is deleted (needs variants data).
   */
  incrementalRemove(caseId: number): void {
    const removeTransaction = this.db.transaction(() => {
      this.db.prepare(INCREMENTAL_REMOVE_SQL).run(caseId)
      this.db.exec(CLEANUP_ZERO_CARRIERS_SQL)
      this.db.exec(UPDATE_META_SQL)
    })
    removeTransaction()

    try {
      this.db.exec('ANALYZE cohort_variant_summary')
    } catch { /* best effort */ }
  }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/main/database/cohort-summary.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/sql/cohort-summary-rebuild.ts src/main/database/CohortSummaryService.ts tests/main/database/cohort-summary.test.ts
git commit -m "feat(db): add incremental summary add/remove for single-case operations"
```

---

### Task 9: Wire Incremental Updates into Workers/Handlers

**Files:**
- Modify: `src/main/ipc/handlers/cases.ts:69-110`
- Modify: `src/main/workers/import-worker.ts`

- [ ] **Step 1: Use incrementalRemove in single-case delete handler**

In `src/main/ipc/handlers/cases.ts`, replace the `cases:delete` handler (lines 69-110). The key change: wrap `incrementalRemove(caseId)` + `deleteCase(caseId)` in the same conceptual operation, with `incrementalRemove` running BEFORE the cascade delete (it needs to read from `variants WHERE case_id = ?`):

```typescript
  ipcMain.handle('cases:delete', async (_, id: number) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const db = getDb()

      try {
        // Incremental remove BEFORE cascade delete (reads from variants)
        // If this fails, fall back to markStale + full rebuild via worker
        db.cohortSummary.incrementalRemove(validated.data)
      } catch {
        // Fallback: mark stale for next full rebuild
        db.cohortSummary.markStale()
        safeEmit('cohort:summaryRebuilt', { is_stale: true })
      }

      db.cases.deleteCase(validated.data)
      safeEmit('cohort:summaryRebuilt', { is_stale: false })

      return undefined
    })
  })
```

**Note:** `incrementalRemove` runs its own transaction internally. If it succeeds but `deleteCase` fails (unlikely — it's a simple DELETE with cascade), the summary will have decremented counts but the case still exists. This is an acceptable trade-off for a desktop app — the next full rebuild corrects it. The old pattern spawned a worker thread for a full rebuild after every single delete, which is what we're optimizing away.

**Import-worker integration (deferred):** The import worker runs in a separate thread with its own DB connection. Wiring `incrementalAdd` requires reading the full worker to find the right integration point. This is deferred to a follow-up task to keep this PR focused.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers/cases.ts
git commit -m "perf(handlers): use incremental summary remove for single-case deletes"
```

---

## Chunk 5: Covering Indexes (Phase 4)

### Task 10: Add Covering Indexes

**Files:**
- Modify: `src/main/database/migrations.ts`

- [ ] **Step 1: Add covering indexes to migration v14**

In the migration v14 block, after the `idx_cvs_cohort_freq` index, add:

```typescript
    // Covering indexes for common filter+sort patterns
    // Drop v13 indexes that are now prefixes of covering indexes
    db.exec(`
      DROP INDEX IF EXISTS idx_cvs_consequence;
      DROP INDEX IF EXISTS idx_cvs_gene;

      CREATE INDEX IF NOT EXISTS idx_cvs_covering_common
        ON cohort_variant_summary(consequence, gnomad_af, carrier_count);

      CREATE INDEX IF NOT EXISTS idx_cvs_gene_covering
        ON cohort_variant_summary(gene_symbol, carrier_count);
    `)
```

- [ ] **Step 2: Run migration tests**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts
git commit -m "perf(db): add covering indexes for common cohort query patterns"
```

---

## Final Verification

- [ ] **Run full CI check**

```bash
make ci
```

Expected: lint + typecheck + all tests PASS

- [ ] **Manual smoke test** (optional)

```bash
make dev
```

Open the app, navigate to cohort view, verify:
- Filters work (starred, has_comment, ACMG)
- Pagination works (page changes don't cause flicker)
- Starring a variant in case view updates cohort view on next refresh
- Import a single case — verify summary updates without full rebuild lag
