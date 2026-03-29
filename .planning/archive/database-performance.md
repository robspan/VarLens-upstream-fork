# Database Performance & Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modularize `DatabaseService.ts` (1909 lines) into focused <500-line modules, then apply SQLite performance optimizations (PRAGMAs, indexes, query fixes, import speed).

**Architecture:** Phase 0 splits `DatabaseService` into 7 repository modules behind a thin facade, preserving the existing public API. Phases 1-6 then apply performance changes to the smaller, focused files. All IPC handlers continue calling `getDatabaseService()` — only internal file structure changes.

**Tech Stack:** better-sqlite3-multiple-ciphers, SQLite FTS5, Vitest (unit tests)

**Relates to:** GitHub issue #30 (modularize), referenced by #31, #32, #33

---

## Phase 0: Modularize DatabaseService (Issue #30)

Current state: `DatabaseService.ts` is 1909 lines containing 8 unrelated domains. Target: each file <500 lines.

### Planned file split

| New File | Methods Moved | Est. Lines |
|----------|--------------|------------|
| `DatabaseService.ts` | Constructor, `stmt()`, `runTransaction()`, `close()`, `isEncrypted()`, `getPath()`, `rekey()`, `database` getter, plus facade accessors for repositories | ~200 |
| `CaseRepository.ts` | `createCase`, `getCase`, `getCaseByName`, `getAllCases`, `updateCaseVariantCount`, `deleteCase`, `deleteAllCases`, `deleteCasesBatch` | ~120 |
| `VariantRepository.ts` | `insertVariantsBatch`, `getVariants`, `getVariantCount`, `getAllVariantsForExport`, `searchVariants`, `getGeneSymbols`, `buildSortClause`, `buildSearchCondition`, `buildSingleSearchToken`, `buildCursorCondition`, `SORTABLE_COLUMNS`, `BATCH_SIZE` | ~480 |
| `TranscriptRepository.ts` | `getVariantTranscripts`, `switchSelectedTranscript`, `insertTranscriptAndSwitch` | ~100 |
| `AnnotationRepository.ts` | `getGlobalAnnotation`, `upsertGlobalAnnotation`, `deleteGlobalAnnotation`, `getPerCaseAnnotation`, `upsertPerCaseAnnotation`, `deletePerCaseAnnotation`, `getAnnotationsForVariant` | ~230 |
| `MetadataRepository.ts` | `getCaseMetadata`, `upsertCaseMetadata`, `listCohortGroups`, `createCohortGroup`, `updateCohortGroup`, `deleteCohortGroup`, `getCohortGroupByName`, `getCaseCohorts`, `assignCaseCohort`, `removeCaseCohort`, `setCaseCohorts`, `getCaseHpoTerms`, `assignCaseHpoTerm`, `removeCaseHpoTerm` | ~280 |
| `TagRepository.ts` | `listTags`, `createTag`, `updateTag`, `deleteTag`, `getTag`, `getTagUsageCount`, `getVariantTags`, `assignVariantTag`, `removeVariantTag`, `setVariantTags` | ~210 |
| `DatabaseOverviewService.ts` | `getDatabaseOverview` | ~70 |

### Shared infrastructure

Each repository needs access to `db` (Database instance) and `stmt()` (prepared statement cache). Extract a base class or shared helper:

```typescript
// src/main/database/BaseRepository.ts (~50 lines)
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'

export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected statementCache: Map<string, Statement>
  ) {}

  protected stmt(sql: string): Statement {
    let statement = this.statementCache.get(sql)
    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
  }

  protected runTransaction<T>(fn: () => T): T {
    const transactionFn = this.db.transaction(fn)
    return transactionFn()
  }
}
```

---

### Task 1: Create BaseRepository with shared database infrastructure

**Files:**
- Create: `src/main/database/BaseRepository.ts`
- Test: `tests/main/database/BaseRepository.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import { BaseRepository } from '../../../src/main/database/BaseRepository'

// Concrete subclass for testing
class TestRepository extends BaseRepository {
  createTable(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT)')
  }

  insert(name: string): number {
    const result = this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name)
    return Number(result.lastInsertRowid)
  }

  get(id: number): { id: number; name: string } | undefined {
    return this.stmt('SELECT * FROM test_items WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined
  }

  insertTwo(name1: string, name2: string): void {
    this.runTransaction(() => {
      this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name1)
      this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name2)
    })
  }
}

describe('BaseRepository', () => {
  let db: Database.Database
  let cache: Map<string, Statement>
  let repo: TestRepository

  beforeEach(() => {
    db = new Database(':memory:')
    cache = new Map()
    repo = new TestRepository(db, cache)
    repo.createTable()
  })

  afterEach(() => {
    db.close()
  })

  it('caches prepared statements', () => {
    repo.insert('a')
    repo.insert('b')
    // Two inserts should reuse the same prepared statement
    expect(cache.size).toBe(1)
  })

  it('runs transactions atomically', () => {
    repo.insertTwo('x', 'y')
    const x = repo.get(1)
    const y = repo.get(2)
    expect(x?.name).toBe('x')
    expect(y?.name).toBe('y')
  })

  it('rolls back transaction on error', () => {
    db.exec('CREATE UNIQUE INDEX idx_name ON test_items(name)')
    repo.insert('dup')
    expect(() => repo.insertTwo('dup', 'other')).toThrow()
    // Transaction rolled back — only original 'dup' remains
    const all = db.prepare('SELECT * FROM test_items').all()
    expect(all).toHaveLength(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/BaseRepository.test.ts`
Expected: FAIL — file doesn't exist.

**Step 3: Write BaseRepository**

```typescript
// src/main/database/BaseRepository.ts
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import { TransactionError } from './errors'

/**
 * Base class for database repositories
 *
 * Provides shared access to the database connection, prepared statement cache,
 * and transaction support. All repositories share a single statement cache
 * owned by DatabaseService.
 */
export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected statementCache: Map<string, Statement>
  ) {}

  /**
   * Get or create a cached prepared statement
   */
  protected stmt(sql: string): Statement {
    let statement = this.statementCache.get(sql)
    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statementCache.set(sql, statement)
    }
    return statement
  }

  /**
   * Execute a function within a transaction with automatic rollback on error
   */
  protected runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError(
        'Transaction failed',
        error instanceof Error ? error : undefined
      )
    }
  }
}
```

**Step 4: Run test**

Run: `npx vitest run tests/main/database/BaseRepository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/database/BaseRepository.ts tests/main/database/BaseRepository.test.ts
git commit -m "refactor: extract BaseRepository with shared stmt cache and transaction support"
```

---

### Task 2: Extract CaseRepository

**Files:**
- Create: `src/main/database/CaseRepository.ts`
- Modify: `src/main/database/DatabaseService.ts` (remove case methods, add facade)
- Test: existing `tests/main/database/DatabaseService.test.ts` must still pass

**Step 1: Create CaseRepository**

```typescript
// src/main/database/CaseRepository.ts
import { BaseRepository } from './BaseRepository'
import type { Case } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

/**
 * Repository for case CRUD operations
 */
export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.stmt(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(name, filePath, fileSize, Date.now())
      return Number(result.lastInsertRowid)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  getCase(id: number): Case {
    const result = this.stmt('SELECT * FROM cases WHERE id = ?').get(id) as Case | undefined
    if (!result) throw new NotFoundError('Case', id)
    return result
  }

  getCaseByName(name: string): Case {
    const result = this.stmt('SELECT * FROM cases WHERE name = ?').get(name) as Case | undefined
    if (!result) throw new NotFoundError('Case', name)
    return result
  }

  getAllCases(): Case[] {
    return this.stmt('SELECT * FROM cases ORDER BY created_at DESC').all() as Case[]
  }

  updateCaseVariantCount(id: number, count: number): void {
    const result = this.stmt('UPDATE cases SET variant_count = ? WHERE id = ?').run(count, id)
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteCase(id: number): void {
    const result = this.stmt('DELETE FROM cases WHERE id = ?').run(id)
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteAllCases(): number {
    return this.stmt('DELETE FROM cases').run().changes
  }

  deleteCasesBatch(ids: number[]): number {
    if (ids.length === 0) return 0
    return this.runTransaction(() => {
      const placeholders = ids.map(() => '?').join(',')
      const result = this.db.prepare(`DELETE FROM cases WHERE id IN (${placeholders})`).run(...ids)
      return result.changes
    })
  }
}
```

**Step 2: Add facade delegations in DatabaseService**

In `DatabaseService.ts`, create a `CaseRepository` instance in the constructor and add delegate methods:

```typescript
import { CaseRepository } from './CaseRepository'

// In constructor, after schema init:
this.cases = new CaseRepository(this.db, this.statementCache)

// Facade methods (preserve existing public API):
createCase(name: string, filePath: string, fileSize: number): number {
  return this.cases.createCase(name, filePath, fileSize)
}
getCase(id: number): Case { return this.cases.getCase(id) }
getCaseByName(name: string): Case { return this.cases.getCaseByName(name) }
getAllCases(): Case[] { return this.cases.getAllCases() }
updateCaseVariantCount(id: number, count: number): void { this.cases.updateCaseVariantCount(id, count) }
deleteCase(id: number): void { this.cases.deleteCase(id) }
deleteAllCases(): number { return this.cases.deleteAllCases() }
deleteCasesBatch(ids: number[]): number { return this.cases.deleteCasesBatch(ids) }
```

Remove the original method bodies from DatabaseService (lines 170-300).

**Step 3: Run existing tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts`
Expected: All PASS — facade preserves API.

**Step 4: Commit**

```bash
git add src/main/database/CaseRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract CaseRepository from DatabaseService"
```

---

### Task 3: Extract TranscriptRepository

**Files:**
- Create: `src/main/database/TranscriptRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Create TranscriptRepository**

Move `getVariantTranscripts` (lines 388-419), `switchSelectedTranscript` (lines 426-474), and `insertTranscriptAndSwitch` (lines 481-502) into `TranscriptRepository.ts` extending `BaseRepository`.

**Step 2: Add facade delegations in DatabaseService**

```typescript
import { TranscriptRepository } from './TranscriptRepository'

// In constructor:
this.transcripts = new TranscriptRepository(this.db, this.statementCache)

// Delegates:
getVariantTranscripts(variantId: number) { return this.transcripts.getVariantTranscripts(variantId) }
switchSelectedTranscript(variantId: number, transcriptId: string) { this.transcripts.switchSelectedTranscript(variantId, transcriptId) }
insertTranscriptAndSwitch(variantId: number, transcript: TranscriptInsertRow) { this.transcripts.insertTranscriptAndSwitch(variantId, transcript) }
```

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/transcripts.test.ts tests/main/database/transcripts-insert.test.ts tests/main/database/DatabaseService.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/TranscriptRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract TranscriptRepository from DatabaseService"
```

---

### Task 4: Extract AnnotationRepository

**Files:**
- Create: `src/main/database/AnnotationRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Create AnnotationRepository**

Move all annotation methods (lines 1106-1324):
- `getGlobalAnnotation`, `upsertGlobalAnnotation`, `deleteGlobalAnnotation`
- `getPerCaseAnnotation`, `upsertPerCaseAnnotation`, `deletePerCaseAnnotation`
- `getAnnotationsForVariant`

**Step 2: Add facade delegations**

```typescript
import { AnnotationRepository } from './AnnotationRepository'

this.annotations = new AnnotationRepository(this.db, this.statementCache)

// 7 delegate methods preserving signatures
```

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts tests/main/handlers/`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/AnnotationRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract AnnotationRepository from DatabaseService"
```

---

### Task 5: Extract MetadataRepository

**Files:**
- Create: `src/main/database/MetadataRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Create MetadataRepository**

Move all metadata, cohort group, case-cohort link, and HPO term methods (lines 1326-1612):
- `getCaseMetadata`, `upsertCaseMetadata`
- `listCohortGroups`, `createCohortGroup`, `updateCohortGroup`, `deleteCohortGroup`, `getCohortGroupByName`
- `getCaseCohorts`, `assignCaseCohort`, `removeCaseCohort`, `setCaseCohorts`
- `getCaseHpoTerms`, `assignCaseHpoTerm`, `removeCaseHpoTerm`

**Step 2: Add facade delegations (14 methods)**

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts tests/main/handlers/case-metadata*`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/MetadataRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract MetadataRepository from DatabaseService"
```

---

### Task 6: Extract TagRepository

**Files:**
- Create: `src/main/database/TagRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Create TagRepository**

Move all tag methods (lines 1614-1825):
- `listTags`, `createTag`, `updateTag`, `deleteTag`, `getTag`, `getTagUsageCount`
- `getVariantTags`, `assignVariantTag`, `removeVariantTag`, `setVariantTags`

**Step 2: Add facade delegations (10 methods)**

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts tests/main/handlers/tags*`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/TagRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract TagRepository from DatabaseService"
```

---

### Task 7: Extract VariantRepository (largest module)

**Files:**
- Create: `src/main/database/VariantRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Create VariantRepository**

Move all variant query/insert methods and private helpers (lines 313-950 + 937-1048):
- `insertVariantsBatch`, `getVariantCount`
- `getVariants`, `searchVariants`, `getGeneSymbols`, `getAllVariantsForExport`
- `buildSortClause`, `buildSearchCondition`, `buildSingleSearchToken`, `buildCursorCondition`
- `SORTABLE_COLUMNS`, `BATCH_SIZE` constants

Note: `insertVariantsBatch` calls `this.cases.getCase()` and `this.cases.updateCaseVariantCount()`. Pass the `CaseRepository` instance to `VariantRepository` constructor:

```typescript
export class VariantRepository extends BaseRepository {
  constructor(
    db: DatabaseType,
    statementCache: Map<string, Statement>,
    private cases: CaseRepository
  ) {
    super(db, statementCache)
  }
  // ...
}
```

**Step 2: Add facade delegations (6 public methods)**

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts tests/main/database/variants.test.ts tests/main/handlers/variants*`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: extract VariantRepository from DatabaseService"
```

---

### Task 8: Extract DatabaseOverviewService and clean up facade

**Files:**
- Create: `src/main/database/DatabaseOverviewService.ts`
- Modify: `src/main/database/DatabaseService.ts`
- Modify: `src/main/database/index.ts` (export new modules)

**Step 1: Create DatabaseOverviewService**

Move `getDatabaseOverview` (lines 1838-1889) — it already creates a `CohortService`, so it just needs the db instance.

**Step 2: Clean up DatabaseService facade**

At this point, `DatabaseService.ts` should contain only:
- Constructor (PRAGMAs, schema init, repository creation)
- `stmt()`, `runTransaction()` (kept for backward compat, delegates to base)
- `close()`, `clearStatementCache()`
- `isEncrypted()`, `getPath()`, `rekey()`
- `database` getter
- Repository instances as public readonly properties
- ~35 one-line facade delegate methods

Verify line count is ~200-250.

**Step 3: Update barrel export**

In `src/main/database/index.ts`, add exports for new modules:

```typescript
export { BaseRepository } from './BaseRepository'
export { CaseRepository } from './CaseRepository'
export { VariantRepository } from './VariantRepository'
export { TranscriptRepository } from './TranscriptRepository'
export { AnnotationRepository } from './AnnotationRepository'
export { MetadataRepository } from './MetadataRepository'
export { TagRepository } from './TagRepository'
export { DatabaseOverviewService } from './DatabaseOverviewService'
```

**Step 4: Run full test suite**

Run: `npx vitest run tests/main/`
Expected: All PASS

**Step 5: Verify file sizes**

Run: `wc -l src/main/database/*.ts`
Expected: No file exceeds 500 lines.

**Step 6: Commit**

```bash
git add src/main/database/
git commit -m "refactor: extract DatabaseOverviewService, clean up facade, update barrel exports"
```

---

### Task 9: Phase 0 verification — lint, typecheck, all tests

**Step 1: Run lint**

Run: `make lint`
Expected: PASS

**Step 2: Run typecheck**

Run: `make typecheck`
Expected: PASS

**Step 3: Run full test suite**

Run: `make test`
Expected: All PASS

**Step 4: Verify line counts**

Run: `wc -l src/main/database/*.ts`
Expected: All files <500 lines.

**Step 5: Commit any fixups**

```bash
git add -A
git commit -m "chore: fix lint and type errors from DatabaseService modularization"
```

---

## Phase 1: Performance PRAGMAs

### Task 10: Add performance PRAGMAs to DatabaseService constructor

**Files:**
- Modify: `src/main/database/DatabaseService.ts` (constructor)
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the failing test**

Add to the existing `describe('Initialization')` block:

```typescript
it('sets performance PRAGMAs on initialization', () => {
  const tempDbPath = join(tmpdir(), `varlens-test-pragmas-${Date.now()}.db`)
  const fileService = new DatabaseService(tempDbPath)

  try {
    const synchronous = fileService.database.prepare('PRAGMA synchronous').get() as { synchronous: number }
    expect(synchronous.synchronous).toBe(1) // NORMAL = 1

    const cacheSize = fileService.database.prepare('PRAGMA cache_size').get() as { cache_size: number }
    expect(cacheSize.cache_size).toBe(-32000)

    const tempStore = fileService.database.prepare('PRAGMA temp_store').get() as { temp_store: number }
    expect(tempStore.temp_store).toBe(2) // MEMORY = 2

    const busyTimeout = fileService.database.prepare('PRAGMA busy_timeout').get() as { busy_timeout: number }
    expect(busyTimeout.busy_timeout).toBe(5000)

    const mmapSize = fileService.database.prepare('PRAGMA mmap_size').get() as { mmap_size: number }
    expect(mmapSize.mmap_size).toBe(268435456)
  } finally {
    fileService.close()
    if (existsSync(tempDbPath)) unlinkSync(tempDbPath)
    if (existsSync(`${tempDbPath}-wal`)) unlinkSync(`${tempDbPath}-wal`)
    if (existsSync(`${tempDbPath}-shm`)) unlinkSync(`${tempDbPath}-shm`)
  }
})
```

**Step 2: Run test — should fail**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts -t "sets performance PRAGMAs"`
Expected: FAIL

**Step 3: Add PRAGMAs to constructor**

After `this.db.pragma('foreign_keys = ON')`, add:

```typescript
// Performance PRAGMAs — safe defaults for desktop app
this.db.pragma('synchronous = NORMAL')   // Safe with WAL; major write speedup
this.db.pragma('busy_timeout = 5000')    // Retry on SQLITE_BUSY for 5s
this.db.pragma('cache_size = -32000')    // 32 MB page cache (default ~2 MB)
this.db.pragma('temp_store = MEMORY')    // Temp tables in RAM
this.db.pragma('mmap_size = 268435456')  // 256 MB memory-mapped I/O
```

**Step 4: Run test — should pass**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts -t "sets performance PRAGMAs"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/database/DatabaseService.ts tests/main/database/DatabaseService.test.ts
git commit -m "perf: add SQLite performance PRAGMAs (synchronous, cache_size, mmap, busy_timeout)"
```

---

### Task 11: Add PRAGMA optimize on database close

**Files:**
- Modify: `src/main/database/DatabaseService.ts` (close method)

**Step 1: Modify close()**

```typescript
close(): void {
  this.clearStatementCache()
  this.db.pragma('optimize')
  this.db.close()
}
```

**Step 2: Run tests**

Run: `npx vitest run tests/main/database/`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/main/database/DatabaseService.ts
git commit -m "perf: run PRAGMA optimize on database close for up-to-date query planner stats"
```

---

## Phase 2: Missing Indexes (Migration v4)

### Task 12: Add migration v4 with new indexes

**Files:**
- Modify: `src/main/database/migrations.ts`
- Test: `tests/main/database/migrations.test.ts`

**Step 1: Write the failing test**

```typescript
describe('v4 migration - performance indexes', () => {
  it('creates covering index for filter options', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_filter_covering'"
    ).all()
    expect(indexes).toHaveLength(1)
    db.close()
  })

  it('creates composite index for variant lookup with case_id', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_case_coords'"
    ).all()
    expect(indexes).toHaveLength(1)
    db.close()
  })

  it('creates partial index on gene_symbol for gene burden', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variants_gene_notnull'"
    ).all()
    expect(indexes).toHaveLength(1)
    db.close()
  })

  it('creates index on variant_annotations acmg_classification', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_variant_annotations_acmg'"
    ).all()
    expect(indexes).toHaveLength(1)
    db.close()
  })

  it('sets user_version to 4', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(result.user_version).toBe(4)
    db.close()
  })
})
```

**Step 2: Run test — should fail**

Run: `npx vitest run tests/main/database/migrations.test.ts -t "v4 migration"`
Expected: FAIL

**Step 3: Write migration**

In `src/main/database/migrations.ts`, after version 3 block:

```typescript
// v4: Performance indexes
if (currentVersion < 4) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_variants_filter_covering
      ON variants(case_id, consequence, func, clinvar);

    CREATE INDEX IF NOT EXISTS idx_variants_case_coords
      ON variants(case_id, chr, pos, ref, alt);

    CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull
      ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_variant_annotations_acmg
      ON variant_annotations(acmg_classification) WHERE acmg_classification IS NOT NULL;
  `)
  db.exec('PRAGMA user_version = 4')
}
```

**Step 4: Run test — should pass**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/migrations.test.ts
git commit -m "perf: add migration v4 with covering and partial indexes for query optimization"
```

---

## Phase 3: Query Optimizations

### Task 13: Remove unnecessary CAST() from per-column text filters

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/database/cohort.ts`

**Step 1: Add NUMERIC_COLUMNS set**

In both `VariantRepository.ts` and `cohort.ts`:

```typescript
const NUMERIC_COLUMNS = new Set(['pos', 'gnomad_af', 'cadd', 'qual', 'hpo_sim_score'])
```

**Step 2: Update column filter logic**

Replace `CAST(${sqlColumn} AS TEXT) LIKE ? COLLATE NOCASE` with:

```typescript
if (NUMERIC_COLUMNS.has(column)) {
  conditions.push(`CAST(${sqlColumn} AS TEXT) LIKE ? COLLATE NOCASE`)
} else {
  conditions.push(`${sqlColumn} LIKE ? COLLATE NOCASE`)
}
```

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/variants.test.ts tests/main/database/cohort.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/cohort.ts
git commit -m "perf: skip CAST() for text columns in LIKE filters to enable index usage"
```

---

### Task 14: Run ANALYZE after bulk import

**Files:**
- Modify: `src/main/database/VariantRepository.ts` (insertVariantsBatch)
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the failing test**

```typescript
it('runs ANALYZE after bulk insert', () => {
  const caseId = service.createCase('analyze-test', '/test.json', 1000)
  const variants = Array.from({ length: 10 }, (_, i) => ({
    chr: '1', pos: i + 1, ref: 'A', alt: 'T',
    gene_symbol: 'BRCA1', omim_mim_number: null,
    consequence: 'missense', gnomad_af: 0.01,
    cadd: 25, clinvar: null, gt_num: '0/1',
    func: 'exonic', qual: 30, hpo_sim_score: null,
    transcript: 'NM_001', cdna: 'c.1A>T',
    aa_change: 'p.Met1?', hpo_match: null, moi: null
  }))

  service.insertVariantsBatch(caseId, variants)

  const stats = service.database
    .prepare("SELECT * FROM sqlite_stat1 WHERE tbl = 'variants'")
    .all()
  expect(stats.length).toBeGreaterThan(0)
})
```

**Step 2: Run test — should fail**

**Step 3: Add ANALYZE after batch insert**

At end of `insertVariantsBatch` in `VariantRepository.ts`:

```typescript
this.db.exec('ANALYZE variants')
this.db.exec('ANALYZE variant_transcripts')
```

**Step 4: Run test — should pass**

**Step 5: Commit**

```bash
git add src/main/database/VariantRepository.ts tests/main/database/DatabaseService.test.ts
git commit -m "perf: run ANALYZE on variants table after bulk import for better query plans"
```

---

### Task 15: Optimize FTS5 index after bulk import

**Files:**
- Modify: `src/main/database/VariantRepository.ts`

**Step 1: Add FTS5 optimize after ANALYZE**

```typescript
this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
```

**Step 2: Run tests**

Run: `npx vitest run tests/main/database/`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "perf: optimize FTS5 index segments after bulk import"
```

---

### Task 16: Add expired cache cleanup on database open

**Files:**
- Modify: `src/main/database/DatabaseService.ts` (constructor)
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the failing test**

```typescript
it('cleans up expired API cache entries on initialization', () => {
  const tempDbPath = join(tmpdir(), `varlens-test-cache-cleanup-${Date.now()}.db`)
  const svc1 = new DatabaseService(tempDbPath)

  svc1.database.prepare(
    'INSERT INTO api_cache (cache_key, response_data, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run('test:expired', '{}', Date.now() - 100000, Date.now() - 50000)

  svc1.database.prepare(
    'INSERT INTO api_cache (cache_key, response_data, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run('test:valid', '{}', Date.now(), Date.now() + 100000)

  svc1.close()

  const svc2 = new DatabaseService(tempDbPath)
  const rows = svc2.database.prepare('SELECT cache_key FROM api_cache').all() as { cache_key: string }[]
  expect(rows).toHaveLength(1)
  expect(rows[0].cache_key).toBe('test:valid')

  svc2.close()
  if (existsSync(tempDbPath)) unlinkSync(tempDbPath)
  if (existsSync(`${tempDbPath}-wal`)) unlinkSync(`${tempDbPath}-wal`)
  if (existsSync(`${tempDbPath}-shm`)) unlinkSync(`${tempDbPath}-shm`)
})
```

**Step 2: Run test — should fail**

**Step 3: Add cleanup to constructor**

After `runMigrations(this.db)`:

```typescript
this.db.exec(`DELETE FROM api_cache WHERE expires_at <= ${Date.now()}`)
```

**Step 4: Run test — should pass**

**Step 5: Commit**

```bash
git add src/main/database/DatabaseService.ts tests/main/database/DatabaseService.test.ts
git commit -m "perf: clean up expired API cache entries on database open"
```

---

## Phase 4: Cohort Query Optimization

### Task 17: Optimize cohort count query with window function

**Files:**
- Modify: `src/main/database/cohort.ts`
- Test: `tests/main/database/cohort.test.ts`

**Step 1: Verify existing tests pass**

Run: `npx vitest run tests/main/database/cohort.test.ts`
Expected: All PASS

**Step 2: Replace two-query approach with window function**

Replace the data query + count query in `getCohortVariants` with a single query using an `aggregated` CTE and `COUNT(*) OVER()`:

```typescript
const sql = `
  WITH deduped AS (
    SELECT chr, pos, ref, alt, case_id,
      MAX(gene_symbol) as gene_symbol, MAX(cdna) as cdna,
      MAX(aa_change) as aa_change, MAX(gt_num) as gt_num,
      MAX(consequence) as consequence, MAX(func) as func,
      MAX(clinvar) as clinvar, MAX(gnomad_af) as gnomad_af,
      MAX(cadd) as cadd, MAX(transcript) as transcript,
      MAX(omim_mim_number) as omim_id
    FROM variants ${whereClause}
    GROUP BY chr, pos, ref, alt, case_id
  ),
  aggregated AS (
    SELECT chr, pos, ref, alt,
      MAX(gene_symbol) as gene_symbol, MAX(cdna) as cdna,
      MAX(aa_change) as aa_change,
      COUNT(*) as carrier_count,
      ${totalCases} as total_cases,
      CAST(COUNT(*) AS REAL) / ${totalCases} as cohort_frequency,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) as het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) as hom_count,
      chr || ':' || pos || ':' || ref || ':' || alt as variant_key,
      MAX(consequence) as consequence, MAX(func) as func,
      MAX(clinvar) as clinvar, MAX(gnomad_af) as gnomad_af,
      MAX(cadd) as cadd_phred, MAX(transcript) as transcript,
      MAX(omim_id) as omim_id
    FROM deduped GROUP BY chr, pos, ref, alt ${havingClause}
  )
  SELECT *, COUNT(*) OVER() as total_count
  FROM aggregated ${orderByClause} LIMIT ? OFFSET ?
`

const results = stmt.all(...) as (CohortVariant & { total_count: number })[]
const totalCount = results.length > 0 ? results[0].total_count : 0
const data = results.map(({ total_count: _, ...rest }) => rest as CohortVariant)
```

Remove the separate count query.

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/cohort.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main/database/cohort.ts
git commit -m "perf: use window function for cohort count to eliminate duplicate aggregation query"
```

---

## Phase 5: Import Performance

### Task 18: Move filter options to VariantRepository with prepared statements

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/database/DatabaseService.ts` (add facade)
- Modify: `src/main/ipc/handlers/variants.ts`
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the failing test**

```typescript
describe('getFilterOptions', () => {
  it('returns distinct filter values for a case', () => {
    const caseId = service.createCase('filter-opts', '/test.json', 1000)
    service.insertVariantsBatch(caseId, [
      { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1', omim_mim_number: null,
        consequence: 'missense_variant', gnomad_af: 0.01, cadd: 25, clinvar: 'Pathogenic',
        gt_num: '0/1', func: 'exonic', qual: 30, hpo_sim_score: null, transcript: 'NM_001',
        cdna: null, aa_change: null, hpo_match: null, moi: null },
      { chr: '1', pos: 200, ref: 'C', alt: 'G', gene_symbol: 'TP53', omim_mim_number: null,
        consequence: 'synonymous_variant', gnomad_af: 0.5, cadd: 5, clinvar: 'Benign',
        gt_num: '1/1', func: 'exonic', qual: 50, hpo_sim_score: null, transcript: 'NM_002',
        cdna: null, aa_change: null, hpo_match: null, moi: null }
    ])

    const options = service.getFilterOptions(caseId)
    expect(options.consequences).toContain('missense_variant')
    expect(options.consequences).toContain('synonymous_variant')
    expect(options.funcs).toContain('exonic')
    expect(options.clinvars).toContain('Pathogenic')
    expect(options.minCadd).toBe(5)
    expect(options.maxCadd).toBe(25)
  })
})
```

**Step 2: Add method to VariantRepository, facade in DatabaseService**

**Step 3: Update IPC handler** — replace 6 `db.database.prepare(...)` calls with `db.getFilterOptions(caseId)`

**Step 4: Run tests**

Run: `npx vitest run tests/main/database/ tests/main/handlers/variants*`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/DatabaseService.ts src/main/ipc/handlers/variants.ts tests/main/database/DatabaseService.test.ts
git commit -m "refactor: move filter options queries to VariantRepository with prepared statements"
```

---

### Task 19: Defer FTS5 triggers during bulk import

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/database/schema.ts` (export `createFTSTriggers`)
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the behavior test**

```typescript
it('FTS5 search works after bulk insert with deferred rebuild', () => {
  const caseId = service.createCase('fts-deferred', '/test.json', 1000)
  service.insertVariantsBatch(caseId, [
    { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1', omim_mim_number: '113705',
      consequence: 'missense_variant', gnomad_af: 0.01, cadd: 25, clinvar: null, gt_num: '0/1',
      func: 'exonic', qual: 30, hpo_sim_score: null, transcript: 'NM_001', cdna: null,
      aa_change: null, hpo_match: null, moi: null },
    { chr: '17', pos: 200, ref: 'G', alt: 'A', gene_symbol: 'TP53', omim_mim_number: '191170',
      consequence: 'stop_gained', gnomad_af: null, cadd: 35, clinvar: 'Pathogenic', gt_num: '0/1',
      func: 'exonic', qual: 50, hpo_sim_score: null, transcript: 'NM_002', cdna: null,
      aa_change: null, hpo_match: null, moi: null }
  ])

  const results = service.searchVariants(caseId, 'BRCA1')
  expect(results).toHaveLength(1)
  expect(results[0].gene_symbol).toBe('BRCA1')
})
```

**Step 2: Verify test passes as baseline**

**Step 3: Modify insertVariantsBatch**

At start: drop FTS triggers. After batch loop: rebuild FTS, re-create triggers.

```typescript
// Drop triggers before bulk insert
this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ai')
this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ad')
this.db.exec('DROP TRIGGER IF EXISTS variants_fts_au')

// ... existing batch loop ...

// Rebuild FTS index and re-create triggers
this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
this.db.exec(createFTSTriggers)
```

Export `createFTSTriggers` from `schema.ts`.

**Step 4: Run tests**

Run: `npx vitest run tests/main/database/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/schema.ts tests/main/database/DatabaseService.test.ts
git commit -m "perf: defer FTS5 triggers during bulk import and rebuild index afterward"
```

---

## Phase 6: Final Verification

### Task 20: Lint, typecheck, full test suite

**Step 1:** Run `make lint` — Expected: PASS

**Step 2:** Run `make typecheck` — Expected: PASS

**Step 3:** Run `make test` — Expected: All PASS

**Step 4:** Verify file sizes: `wc -l src/main/database/*.ts` — all <500 lines

**Step 5:** Commit any fixups

```bash
git add -A
git commit -m "chore: fix lint and type errors from database performance and modularization"
```

---

## Summary

| Task | Phase | File(s) | What |
|------|-------|---------|------|
| 1 | 0 | BaseRepository.ts | Shared stmt cache + transaction base class |
| 2 | 0 | CaseRepository.ts | Extract case CRUD (~120 lines) |
| 3 | 0 | TranscriptRepository.ts | Extract transcript ops (~100 lines) |
| 4 | 0 | AnnotationRepository.ts | Extract annotation ops (~230 lines) |
| 5 | 0 | MetadataRepository.ts | Extract metadata/cohort/HPO ops (~280 lines) |
| 6 | 0 | TagRepository.ts | Extract tag ops (~210 lines) |
| 7 | 0 | VariantRepository.ts | Extract variant query/insert (~480 lines) |
| 8 | 0 | DatabaseOverviewService.ts | Extract overview, clean facade (~70 lines) |
| 9 | 0 | — | Phase 0 verification |
| 10 | 1 | DatabaseService.ts | Add 5 performance PRAGMAs |
| 11 | 1 | DatabaseService.ts | PRAGMA optimize on close |
| 12 | 2 | migrations.ts | Migration v4: 4 new indexes |
| 13 | 3 | VariantRepository.ts, cohort.ts | Remove CAST() for text LIKE |
| 14 | 3 | VariantRepository.ts | ANALYZE after bulk import |
| 15 | 3 | VariantRepository.ts | FTS5 optimize after import |
| 16 | 3 | DatabaseService.ts | Clean expired cache on open |
| 17 | 4 | cohort.ts | Window function for cohort count |
| 18 | 5 | VariantRepository.ts, variants.ts | Filter options with prepared stmts |
| 19 | 5 | VariantRepository.ts, schema.ts | Defer FTS triggers during import |
| 20 | 6 | — | Final lint/typecheck/test |

## Not Included (Future Work — GitHub Issues)

- **#31** — Cursor pagination for cohort queries (full-stack, renderer changes)
- **#32** — Repository pattern for PostgreSQL (depends on #30, no PG backend yet)
- **#33** — Materialized cohort summary (measure after Task 17 first)
- Generated `variant_key` column — requires shared type changes
- Read/write connection separation — needs DatabaseManager refactor
- Auto-vacuum configuration — only for new databases, needs UX
