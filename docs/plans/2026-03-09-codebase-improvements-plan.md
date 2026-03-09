# VarLens v0.21.0 Codebase Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical security/architecture issues, migrate to Kysely query builder, add per-database authentication, refactor IPC handlers, decompose large Vue components, and add Vue Router.

**Architecture:** Bottom-up execution — stabilize the database layer (Phases 1-2), add authentication (Phase 3), refactor IPC (Phase 4), then refactor the UI layer (Phase 5), and finally fill test gaps (Phase 6).

**Tech Stack:** Electron 40, Vue 3, Vuetify 4, Pinia 3, TypeScript 5.9, Kysely (new), @node-rs/argon2 (new), vue-router (new), better-sqlite3-multiple-ciphers, Vitest 4, Zod 4.

**Key reference files:**
- Design doc: `docs/plans/2026-03-09-codebase-improvements-design.md`
- Codebase review: `.planning/docs/CODEBASE-REVIEW.md`
- Existing test patterns: `tests/main/database/DatabaseService.test.ts`, `tests/main/database/variants.test.ts`
- Mock API: `tests/utils/mock-api.ts`
- Test helpers: `tests/utils/test-helpers.ts`

---

## Phase 1: Critical Fixes & Configuration

### Task 1.1: Fix SQL Injection in Encryption Pragma

**Files:**
- Modify: `src/main/database/DatabaseService.ts:91` (key pragma) and `:269-278` (rekey method)
- Test: `tests/main/database/sqlcipher.test.ts`

**Step 1: Write the failing test**

Add to `tests/main/database/sqlcipher.test.ts`:

```typescript
describe('SQL injection prevention', () => {
  it('should handle passwords containing single quotes', () => {
    const dbPath = path.join(os.tmpdir(), `varlens-test-sqli-${Date.now()}.db`)
    try {
      const db = new DatabaseService(dbPath, "it's_secure")
      expect(db.isEncrypted()).toBe(true)
      db.close()

      // Reopen with same password
      const db2 = new DatabaseService(dbPath, "it's_secure")
      expect(db2.isEncrypted()).toBe(true)
      db2.close()
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    }
  })

  it('should handle rekey with single quotes in new password', () => {
    const dbPath = path.join(os.tmpdir(), `varlens-test-rekey-sqli-${Date.now()}.db`)
    try {
      const db = new DatabaseService(dbPath, 'initial')
      db.rekey("new'password")
      db.close()

      const db2 = new DatabaseService(dbPath, "new'password")
      expect(db2.isEncrypted()).toBe(true)
      db2.close()
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/sqlcipher.test.ts -t "SQL injection"`
Expected: FAIL — password with single quote breaks the pragma.

**Step 3: Implement the fix**

In `src/main/database/DatabaseService.ts`, find the constructor (line ~91):

```typescript
// BEFORE:
this.db.pragma(`key='${encryptionKey}'`)

// AFTER:
const safeKey = encryptionKey.replace(/'/g, "''")
this.db.pragma(`key='${safeKey}'`)
```

And in the `rekey()` method (line ~269-278):

```typescript
// BEFORE:
this.db.pragma(`rekey='${newPassword}'`)

// AFTER:
const safePassword = newPassword.replace(/'/g, "''")
this.db.pragma(`rekey='${safePassword}'`)
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/sqlcipher.test.ts -t "SQL injection"`
Expected: PASS

**Step 5: Run full sqlcipher test suite**

Run: `npx vitest run tests/main/database/sqlcipher.test.ts`
Expected: All tests PASS (no regressions).

**Step 6: Commit**

```bash
git add src/main/database/DatabaseService.ts tests/main/database/sqlcipher.test.ts
git commit -m "fix: prevent SQL injection in encryption pragma via single-quote escaping"
```

---

### Task 1.2: Create Centralized Configuration Module

**Files:**
- Create: `src/shared/config/database.config.ts`
- Create: `src/shared/config/api.config.ts`
- Create: `src/shared/config/app.config.ts`
- Create: `src/shared/config/domain.config.ts`
- Create: `src/shared/config/index.ts`

**Step 1: Create config directory and files**

`src/shared/config/database.config.ts`:
```typescript
export const DATABASE_CONFIG = {
  /** SQLite cache size in KB (negative = KB, positive = pages) */
  CACHE_SIZE_KB: -32000,
  /** Memory-mapped I/O size in bytes (256 MB) */
  MMAP_SIZE_BYTES: 268_435_456,
  /** Busy timeout in milliseconds */
  BUSY_TIMEOUT_MS: 5000,
  /** Batch insert size for variant imports */
  BATCH_INSERT_SIZE: 5000,
  /** API cache TTL in days */
  CACHE_TTL_DAYS: 30,
  /** Max recent databases in history */
  MAX_RECENT_DATABASES: 5,
} as const
```

`src/shared/config/api.config.ts`:
```typescript
export const API_CONFIG = {
  /** VEP API minimum time between requests (ms) — 15 req/sec */
  VEP_MIN_TIME_MS: 67,
  /** VEP hourly rate limit */
  VEP_HOURLY_LIMIT: 55000,
  /** Import progress throttle interval (ms) */
  PROGRESS_THROTTLE_MS: 100,
} as const
```

`src/shared/config/app.config.ts`:
```typescript
export const APP_CONFIG = {
  /** Default window dimensions */
  WINDOW_WIDTH: 1440,
  WINDOW_HEIGHT: 900,
  /** Max log entries in renderer */
  MAX_LOG_ENTRIES: 1000,
  /** Default debounce delay (ms) */
  DEBOUNCE_MS: 300,
  /** Snackbar timeout for success messages (ms) */
  SNACKBAR_SUCCESS_MS: 3000,
  /** Snackbar timeout for error messages (-1 = manual close) */
  SNACKBAR_ERROR_MS: -1,
  /** Default items-per-page options */
  ITEMS_PER_PAGE_OPTIONS: [10, 25, 50, 100] as readonly number[],
} as const
```

`src/shared/config/domain.config.ts`:
```typescript
export const DOMAIN_CONFIG = {
  /** Maximum CADD score */
  MAX_CADD_SCORE: 60,
} as const
```

`src/shared/config/index.ts`:
```typescript
export { DATABASE_CONFIG } from './database.config'
export { API_CONFIG } from './api.config'
export { APP_CONFIG } from './app.config'
export { DOMAIN_CONFIG } from './domain.config'
```

**Step 2: Replace hardcoded values across codebase**

Replace magic numbers with config references. Key files to update:

- `src/main/database/DatabaseService.ts:101-105` — pragma values → `DATABASE_CONFIG.*`
- `src/main/database/VariantRepository.ts:10` — batch size → `DATABASE_CONFIG.BATCH_INSERT_SIZE`
- `src/main/index.ts:38` — window size → `APP_CONFIG.WINDOW_WIDTH/HEIGHT`
- `src/main/services/api/VepApiClient.ts` — rate limits → `API_CONFIG.*`
- `src/main/services/api/ApiCache.ts` — TTL → `DATABASE_CONFIG.CACHE_TTL_DAYS`
- `src/main/services/RecentDatabasesService.ts` — max recent → `DATABASE_CONFIG.MAX_RECENT_DATABASES`
- `src/shared/types/ipc-schemas.ts:93` — max CADD → `DOMAIN_CONFIG.MAX_CADD_SCORE`
- `src/renderer/src/stores/logStore.ts` — max entries → `APP_CONFIG.MAX_LOG_ENTRIES`
- Various composables — debounce → `APP_CONFIG.DEBOUNCE_MS`
- Various components — snackbar → `APP_CONFIG.SNACKBAR_*`
- `src/renderer/src/components/VariantTable.vue` — items per page → `APP_CONFIG.ITEMS_PER_PAGE_OPTIONS`

**Step 3: Verify no regressions**

Run: `make ci`
Expected: All lint, typecheck, and tests pass.

**Step 4: Commit**

```bash
git add src/shared/config/
git add -u  # all modified files
git commit -m "refactor: centralize hardcoded magic numbers into config modules"
```

---

## Phase 2: Kysely Migration & Database Refactor

### Task 2.1: Install Kysely & Define Database Schema Types

**Files:**
- Modify: `package.json` (add kysely dependency)
- Create: `src/shared/types/database-schema.ts` (Kysely table type definitions)
- Modify: `electron.vite.config.ts` (if kysely needs any special handling)

**Step 1: Install Kysely**

```bash
npm install kysely
```

Note: Kysely's `SqliteDialect` works with `better-sqlite3` API. Since `better-sqlite3-multiple-ciphers` is API-compatible, it works directly. No additional dialect package needed — Kysely ships `SqliteDialect` built-in.

**Step 2: Define Kysely database schema types**

Create `src/shared/types/database-schema.ts`. This file defines the TypeScript types that Kysely uses for compile-time query type safety. Map every table in the database:

```typescript
import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

// ── Cases ──────────────────────────────────────────────────
export interface CasesTable {
  id: Generated<number>
  name: string
  file_path: string
  file_size: number
  variant_count: number
  created_at: number
}
export type Case = Selectable<CasesTable>
export type NewCase = Insertable<CasesTable>
export type CaseUpdate = Updateable<CasesTable>

// ── Variants ───────────────────────────────────────────────
export interface VariantsTable {
  id: Generated<number>
  case_id: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  hpo_match: string | null
  moi: string | null
}
export type Variant = Selectable<VariantsTable>
export type NewVariant = Insertable<VariantsTable>

// ── Variant Transcripts ────────────────────────────────────
export interface VariantTranscriptsTable {
  id: Generated<number>
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: number
  is_mane_select: number | null
  is_canonical: number | null
}

// ── Variant Annotations (global) ──────────────────────────
export interface VariantAnnotationsTable {
  id: Generated<number>
  chr: string
  pos: number
  ref: string
  alt: string
  global_comment: string | null
  updated_at: string | null
}

// ── Case Variant Annotations (per-case) ───────────────────
export interface CaseVariantAnnotationsTable {
  id: Generated<number>
  case_id: number
  variant_id: number
  starred: number
  per_case_comment: string | null
  acmg_classification: string | null
  acmg_criteria: string | null
  updated_at: string | null
}

// ── Case Metadata ─────────────────────────────────────────
export interface CaseMetadataTable {
  id: Generated<number>
  case_id: number
  affected_status: string | null
  notes: string | null
  sex: string | null
  age: number | null
  date_of_birth: string | null
}

// ── Cohort Groups ─────────────────────────────────────────
export interface CohortGroupsTable {
  id: Generated<number>
  name: string
  description: string | null
  created_at: string
}

// ── Case Cohort Links ─────────────────────────────────────
export interface CaseCohortLinksTable {
  case_id: number
  cohort_id: number
}

// ── Tags ──────────────────────────────────────────────────
export interface TagsTable {
  id: Generated<number>
  name: string
  color: string
  created_at: string
}

// ── Variant Tags ──────────────────────────────────────────
export interface VariantTagsTable {
  id: Generated<number>
  case_id: number
  variant_id: number
  tag_id: number
  created_at: string
}

// ── Case HPO Terms ────────────────────────────────────────
export interface CaseHpoTermsTable {
  id: Generated<number>
  case_id: number
  hpo_id: string
  hpo_name: string
  created_at: string
}

// ── API Cache ─────────────────────────────────────────────
export interface ApiCacheTable {
  id: Generated<number>
  cache_key: string
  response_data: string
  created_at: number
  expires_at: number
}

// ── Audit Log ─────────────────────────────────────────────
export interface AuditLogTable {
  id: Generated<number>
  action: string
  entity_type: string
  entity_key: string
  user_name: string | null
  details: string | null
  created_at: string
}

// ── Case Comments ─────────────────────────────────────────
export interface CaseCommentsTable {
  id: Generated<number>
  case_id: number
  comment_text: string
  created_at: string
  updated_at: string | null
}

// ── Case Metric Definitions ───────────────────────────────
export interface CaseMetricDefinitionsTable {
  id: Generated<number>
  name: string
  display_name: string
  unit: string | null
  category: string | null
  description: string | null
  is_predefined: number
  created_at: string
}

// ── Case Metric Values ────────────────────────────────────
export interface CaseMetricValuesTable {
  id: Generated<number>
  case_id: number
  metric_id: number
  value: number
  created_at: string
  updated_at: string | null
}

// ── Case Data Info ────────────────────────────────────────
export interface CaseDataInfoTable {
  id: Generated<number>
  case_id: number
  genome_build: string | null
  sequencing_platform: string | null
  capture_kit: string | null
  analysis_pipeline: string | null
  analysis_date: string | null
  caller: string | null
  notes: string | null
  created_at: string
  updated_at: string | null
}

// ── Case External IDs ─────────────────────────────────────
export interface CaseExternalIdsTable {
  id: Generated<number>
  case_id: number
  id_type: string
  id_value: string
  created_at: string
}

// ── Gene Lists ────────────────────────────────────────────
export interface GeneListsTable {
  id: Generated<number>
  name: string
  description: string | null
  created_at: string
  updated_at: string | null
}

// ── Gene List Items ───────────────────────────────────────
export interface GeneListItemsTable {
  id: Generated<number>
  gene_list_id: number
  gene_symbol: string
}

// ── Region Files ──────────────────────────────────────────
export interface RegionFilesTable {
  id: Generated<number>
  name: string
  description: string | null
  created_at: string
}

// ── Region File Entries ───────────────────────────────────
export interface RegionFileEntriesTable {
  id: Generated<number>
  region_file_id: number
  chr: string
  start: number
  end: number
  name: string | null
}

// ── Full Database Schema ──────────────────────────────────
export interface Database {
  cases: CasesTable
  variants: VariantsTable
  variant_transcripts: VariantTranscriptsTable
  variant_annotations: VariantAnnotationsTable
  case_variant_annotations: CaseVariantAnnotationsTable
  case_metadata: CaseMetadataTable
  cohort_groups: CohortGroupsTable
  case_cohort_links: CaseCohortLinksTable
  tags: TagsTable
  variant_tags: VariantTagsTable
  case_hpo_terms: CaseHpoTermsTable
  api_cache: ApiCacheTable
  audit_log: AuditLogTable
  case_comments: CaseCommentsTable
  case_metric_definitions: CaseMetricDefinitionsTable
  case_metric_values: CaseMetricValuesTable
  case_data_info: CaseDataInfoTable
  case_external_ids: CaseExternalIdsTable
  gene_lists: GeneListsTable
  gene_list_items: GeneListItemsTable
  region_files: RegionFilesTable
  region_file_entries: RegionFileEntriesTable
}
```

**Step 3: Verify types compile**

Run: `make typecheck`
Expected: PASS — no type errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json src/shared/types/database-schema.ts
git commit -m "feat: install Kysely and define typed database schema"
```

---

### Task 2.2: Create Kysely Instance Factory in DatabaseService

**Files:**
- Modify: `src/main/database/DatabaseService.ts`
- Create: `src/main/database/kysely.ts` (factory + dialect setup)
- Test: `tests/main/database/DatabaseService.test.ts`

**Step 1: Write the failing test**

Add to `tests/main/database/DatabaseService.test.ts`:

```typescript
describe('Kysely integration', () => {
  it('should expose a Kysely instance', () => {
    const db = new DatabaseService(':memory:')
    expect(db.kysely).toBeDefined()
    expect(typeof db.kysely.selectFrom).toBe('function')
    db.close()
  })

  it('should use the same underlying connection', () => {
    const db = new DatabaseService(':memory:')
    // Insert via raw, read via Kysely
    db.cases.createCase('test', '/path', 100)
    // This verifies Kysely uses the same connection
    const result = db.kysely.selectFrom('cases').selectAll().execute()
    // Kysely with better-sqlite3 dialect returns synchronously via .execute()
    expect(result).toBeDefined()
    db.close()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts -t "Kysely integration"`
Expected: FAIL — `db.kysely` does not exist yet.

**Step 3: Create Kysely factory**

Create `src/main/database/kysely.ts`:

```typescript
import { Kysely, SqliteDialect } from 'kysely'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Database } from '../../shared/types/database-schema'

/**
 * Create a Kysely instance that wraps an existing better-sqlite3 connection.
 * This allows Kysely and raw better-sqlite3 to share the same database handle.
 */
export function createKysely(db: DatabaseType): Kysely<Database> {
  const dialect = new SqliteDialect({ database: db })
  return new Kysely<Database>({ dialect })
}
```

Then add to `DatabaseService.ts`:

```typescript
import { createKysely } from './kysely'
import type { Kysely } from 'kysely'
import type { Database as KyselyDatabase } from '../../shared/types/database-schema'

// Add to private members:
private _kysely: Kysely<KyselyDatabase>

// In constructor, after schema init:
this._kysely = createKysely(this.db)

// Add getter:
get kysely(): Kysely<KyselyDatabase> { return this._kysely }

// In close(), before db.close():
await this._kysely.destroy()
```

Note: Kysely's `SqliteDialect` expects a `database` option that can be a `better-sqlite3` `Database` instance. Since `better-sqlite3-multiple-ciphers` is API-compatible, this should work directly. If not, we may need to pass `{ database: () => db }` as a factory function. Test and adjust.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts -t "Kysely integration"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts`
Expected: All PASS.

**Step 6: Commit**

```bash
git add src/main/database/kysely.ts src/main/database/DatabaseService.ts tests/main/database/DatabaseService.test.ts
git commit -m "feat: add Kysely instance factory sharing better-sqlite3 connection"
```

---

### Task 2.3: Migrate CaseRepository to Kysely

**Files:**
- Modify: `src/main/database/CaseRepository.ts`
- Modify: `src/main/database/BaseRepository.ts` (add Kysely to base)
- Test: `tests/main/database/DatabaseService.test.ts` (case tests)

**Step 1: Update BaseRepository to accept Kysely**

```typescript
import type { Kysely } from 'kysely'
import type { Database } from '../../shared/types/database-schema'

export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected kysely: Kysely<Database>,
    protected statementCache: Map<string, Statement>  // kept for migration period
  ) {}

  // Keep stmt() for now — repositories being migrated will stop using it
  // Remove statementCache entirely after all repos are migrated (Task 2.9)
}
```

Update `DatabaseService.ts` constructor to pass `this._kysely` to all repository constructors.

**Step 2: Rewrite CaseRepository using Kysely**

Replace all raw SQL in `CaseRepository.ts` with Kysely query builder calls. Example:

```typescript
export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number {
    const result = this.kysely
      .insertInto('cases')
      .values({
        name,
        file_path: filePath,
        file_size: fileSize,
        variant_count: 0,
        created_at: Date.now(),
      })
      .executeTakeFirstOrThrow()
    return Number(result.insertId)
  }

  getCase(id: number): Case | undefined {
    return this.kysely
      .selectFrom('cases')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
  }

  getAllCases(): Case[] {
    return this.kysely
      .selectFrom('cases')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()
  }

  // ... similar for other methods
}
```

Important: Kysely with `SqliteDialect` executes synchronously (better-sqlite3 is synchronous). The `.execute()` / `.executeTakeFirst()` calls return directly, not promises. Verify this behavior and adjust (may need `await` if Kysely wraps in microtask).

**Step 3: Run existing case tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts`
Expected: All case-related tests PASS with Kysely backend.

**Step 4: Commit**

```bash
git add src/main/database/BaseRepository.ts src/main/database/CaseRepository.ts src/main/database/DatabaseService.ts
git commit -m "refactor: migrate CaseRepository to Kysely query builder"
```

---

### Task 2.4: Migrate VariantRepository to Kysely (Including Filter Deduplication)

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Test: `tests/main/database/variants.test.ts`

This is the largest and most complex repository (591 lines). Key changes:

**Step 1: Create shared `applyVariantFilters()` method**

This replaces the ~80 lines of duplicated filter-building in `getVariants()` and `getAllVariantsForExport()`:

```typescript
import { type ExpressionBuilder, sql } from 'kysely'
import type { Database } from '../../shared/types/database-schema'

private applyVariantFilters(
  qb: SelectQueryBuilder<Database, 'variants', any>,
  filter: VariantFilter
): SelectQueryBuilder<Database, 'variants', any> {
  let query = qb.where('case_id', '=', filter.case_id)

  if (filter.gene_symbol) {
    query = query.where('gene_symbol', 'like', `%${filter.gene_symbol}%`)
  }

  if (filter.consequences?.length) {
    query = query.where('consequence', 'in', filter.consequences)
  } else if (filter.consequence) {
    query = query.where('consequence', '=', filter.consequence)
  }

  if (filter.funcs?.length) {
    query = query.where('func', 'in', filter.funcs)
  }

  if (filter.clinvars?.length) {
    query = query.where('clinvar', 'in', filter.clinvars)
  }

  if (filter.gnomad_af_max !== undefined) {
    query = query.where((eb) =>
      eb.or([
        eb('gnomad_af', 'is', null),
        eb('gnomad_af', '<=', filter.gnomad_af_max!)
      ])
    )
  }

  if (filter.cadd_min !== undefined) {
    query = query.where((eb) =>
      eb.or([
        eb('cadd', 'is', null),
        eb('cadd', '>=', filter.cadd_min!)
      ])
    )
  }

  // ... chr, pos, ref, alt filters
  // ... tag_ids, starred_only, has_comment, acmg_classifications
  // ... column_filters
  // ... search_query (use sql`` template for FTS5 MATCH)

  return query
}
```

**Step 2: Rewrite `getVariants()` using Kysely + shared filter method**

```typescript
getVariants(filter: VariantFilter, limit: number, cursor?: PaginationCursor, sortBy?: SortItem[]): PaginatedResult<Variant> {
  // Count query
  let countQuery = this.kysely.selectFrom('variants')
    .select(({ fn }) => [fn.countAll<number>().as('count')])
  countQuery = this.applyVariantFilters(countQuery, filter)
  const { count: total_count } = countQuery.executeTakeFirstOrThrow()

  // Data query
  let dataQuery = this.kysely.selectFrom('variants').selectAll()
  dataQuery = this.applyVariantFilters(dataQuery, filter)

  // Cursor pagination
  if (cursor) {
    dataQuery = this.applyCursorCondition(dataQuery, cursor, sortBy)
  }

  // Sort + limit
  dataQuery = this.applySortOrder(dataQuery, sortBy)
  const results = dataQuery.limit(limit + 1).execute()

  // Pagination logic (same as before)
  const has_more = results.length > limit
  const data = has_more ? results.slice(0, limit) : results
  // ... build next_cursor

  return { data, next_cursor, has_more, total_count }
}
```

**Step 3: Rewrite `getAllVariantsForExport()` using shared filter method**

```typescript
getAllVariantsForExport(filter: VariantFilter): Variant[] {
  let query = this.kysely.selectFrom('variants').selectAll()
  query = this.applyVariantFilters(query, filter)
  return query.orderBy('chr', 'asc').orderBy('pos', 'asc').execute()
}
```

**Step 4: Handle FTS5 search with Kysely raw SQL**

For the `buildSearchCondition()` method, use Kysely's `sql` template tag:

```typescript
if (filter.search_query) {
  query = query.where(
    sql`id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${filter.search_query + '*'})`
  )
}
```

**Step 5: Migrate remaining methods** (`insertVariantsBatch`, `getVariantCount`, `searchVariants`, `getGeneSymbols`, `getFilterOptions`)

For `insertVariantsBatch`, use Kysely's `.values()` with array + transaction:

```typescript
insertVariantsBatch(caseId: number, variants: NewVariant[]): void {
  this.kysely.transaction().execute((trx) => {
    for (let i = 0; i < variants.length; i += BATCH_INSERT_SIZE) {
      const batch = variants.slice(i, i + BATCH_INSERT_SIZE)
      trx.insertInto('variants').values(batch).execute()
    }
  })
}
```

**Step 6: Run variant tests**

Run: `npx vitest run tests/main/database/variants.test.ts`
Expected: All PASS.

**Step 7: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "refactor: migrate VariantRepository to Kysely with shared filter builder"
```

---

### Task 2.5: Migrate Remaining Repositories to Kysely

**Files:**
- Modify: `src/main/database/AnnotationRepository.ts`
- Modify: `src/main/database/TranscriptRepository.ts`
- Modify: `src/main/database/MetadataRepository.ts`
- Modify: `src/main/database/TagRepository.ts`
- Modify: `src/main/database/AuditLogRepository.ts`
- Modify: `src/main/database/GeneListRepository.ts`
- Modify: `src/main/database/DatabaseOverviewService.ts`

Each repository follows the same pattern as Task 2.3/2.4: replace `this.stmt(sql).all/get/run(...)` with Kysely `.selectFrom()`, `.insertInto()`, `.updateTable()`, `.deleteFrom()` chains.

**Step 1: Migrate AnnotationRepository** (153 lines, 6 methods)

Key methods: `getGlobalAnnotation`, `upsertGlobalAnnotation`, `deleteGlobalAnnotation`, `getPerCaseAnnotation`, `upsertPerCaseAnnotation`, `deletePerCaseAnnotation`.

Use Kysely's `.onConflict()` for upsert operations:

```typescript
upsertGlobalAnnotation(chr: string, pos: number, ref: string, alt: string, updates: AnnotationUpdates) {
  return this.kysely
    .insertInto('variant_annotations')
    .values({ chr, pos, ref, alt, ...updates, updated_at: new Date().toISOString() })
    .onConflict((oc) => oc
      .columns(['chr', 'pos', 'ref', 'alt'])
      .doUpdateSet(updates)
    )
    .execute()
}
```

**Step 2: Migrate TranscriptRepository** (106 lines, 3 methods)

**Step 3: Migrate MetadataRepository** (419 lines, 20+ methods)

This is the second-largest repository. Migrate method by method. Pay attention to:
- Cohort group CRUD
- HPO term management
- Case comments and metrics
- External IDs and data info

**Step 4: Migrate TagRepository** (121 lines, 8 methods)

**Step 5: Migrate AuditLogRepository** (94 lines, 3 methods)

**Step 6: Migrate GeneListRepository** (119 lines, 10+ methods)

**Step 7: Migrate DatabaseOverviewService** (59 lines, 1 method)

This uses a complex multi-join query. Use Kysely's `.innerJoin()` / `.leftJoin()` + subqueries.

**Step 8: Run full test suite after each repository**

After each repository migration:
Run: `npx vitest run`
Expected: All tests PASS.

**Step 9: Commit after each repository** (or batch 2-3 small ones together)

```bash
git commit -m "refactor: migrate AnnotationRepository to Kysely"
git commit -m "refactor: migrate TranscriptRepository to Kysely"
git commit -m "refactor: migrate MetadataRepository to Kysely"
git commit -m "refactor: migrate TagRepository to Kysely"
git commit -m "refactor: migrate AuditLogRepository to Kysely"
git commit -m "refactor: migrate GeneListRepository to Kysely"
git commit -m "refactor: migrate DatabaseOverviewService to Kysely"
```

---

### Task 2.6: Refactor DatabaseService God Object

**Files:**
- Modify: `src/main/database/DatabaseService.ts`
- Modify: All IPC handlers in `src/main/ipc/handlers/` (update call sites)

**Step 1: Replace 60+ delegate methods with repository getters**

In `DatabaseService.ts`, replace all delegate methods with public getters:

```typescript
class DatabaseService {
  // Replace private with exposed getters
  get cases(): CaseRepository { return this._cases }
  get variants(): VariantRepository { return this._variantsRepo }
  get annotations(): AnnotationRepository { return this._annotations }
  get metadata(): MetadataRepository { return this._metadata }
  get tags(): TagRepository { return this._tags }
  get transcripts(): TranscriptRepository { return this._transcripts }
  get overview(): DatabaseOverviewService { return this._overview }
  get auditLog(): AuditLogRepository { return this._auditLog }
  get geneLists(): GeneListRepository { return this._geneLists }
  get kysely(): Kysely<KyselyDatabase> { return this._kysely }

  // Keep utility methods:
  // close(), isEncrypted(), getPath(), rekey(), runTransaction()

  // DELETE all delegate methods (createCase, getCase, getAllCases, etc.)
}
```

**Step 2: Update all IPC handlers**

Find-and-replace across all handler files. Pattern:

```typescript
// BEFORE:
const db = getDatabaseService()
return db.getAllCases()

// AFTER:
const db = getDatabaseService()
return db.cases.getAllCases()
```

Key handlers to update:
- `handlers/cases.ts`: `db.getAllCases()` → `db.cases.getAllCases()`
- `handlers/variants.ts`: `db.getVariants(...)` → `db.variants.getVariants(...)`
- `handlers/annotations.ts`: `db.upsertGlobalAnnotation(...)` → `db.annotations.upsertGlobalAnnotation(...)`
- `handlers/tags.ts`: `db.createTag(...)` → `db.tags.createTag(...)`
- `handlers/case-metadata.ts`: all metadata calls
- `handlers/audit-log.ts`: `db.appendAuditEntry(...)` → `db.auditLog.appendAuditEntry(...)`
- `handlers/gene-lists.ts`: all gene list calls
- `handlers/transcripts.ts`: all transcript calls
- `handlers/export.ts`: `db.getAllVariantsForExport(...)` → `db.variants.getAllVariantsForExport(...)`
- `handlers/cohort.ts`: uses `db.database` directly — update if needed
- `handlers/database.ts`: `db.rekey(...)` stays on DatabaseService

**Step 3: Update CohortService if it accesses DatabaseService methods**

Check `src/main/database/cohort.ts` — it may use the raw `db` directly. Ensure it works with the refactored service.

**Step 4: Run full test suite**

Run: `make ci`
Expected: All lint, typecheck, and tests PASS.

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: replace DatabaseService delegates with repository getters"
```

---

### Task 2.7: Remove Statement Cache & Clean Up BaseRepository

**Files:**
- Modify: `src/main/database/BaseRepository.ts`
- Modify: `src/main/database/DatabaseService.ts`
- Modify: All repositories (remove `statementCache` from constructors)

**Step 1: Remove statementCache from BaseRepository**

Now that all repositories use Kysely, the manual statement cache is unused:

```typescript
export class BaseRepository {
  constructor(
    protected db: DatabaseType,
    protected kysely: Kysely<Database>
  ) {}

  protected runTransaction<T>(fn: () => T): T {
    try {
      const transactionFn = this.db.transaction(fn)
      return transactionFn()
    } catch (error) {
      throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
    }
  }
}
```

Note: Keep `runTransaction` if any repository still uses it. Otherwise, use Kysely's `this.kysely.transaction().execute()`.

**Step 2: Update DatabaseService constructor**

Remove `this.statementCache = new Map()` and stop passing it to repositories.

**Step 3: Update all repository constructors**

Remove `statementCache` parameter from all repository constructors.

**Step 4: Run tests**

Run: `make ci`
Expected: All PASS.

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: remove manual statement cache (Kysely handles prepared statements)"
```

---

### Task 2.8: Consolidate Schema into Migration System

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/main/database/schema.ts`
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Move initial schema creation into migration 0**

In `migrations.ts`, add a migration 0 that creates all base tables (currently in `schema.ts`). The `initializeSchema()` function in `schema.ts` becomes a thin wrapper that calls `runMigrations()`.

**Step 2: Update DatabaseService constructor**

Replace:
```typescript
initializeSchema(this.db)
runMigrations(this.db)
```
With:
```typescript
runAllMigrations(this.db)  // Single entry point
```

**Step 3: Keep `schema.ts` for FTS5 rebuild logic only**

FTS5 tables need special handling (drop/recreate on schema changes). Keep this logic but call it from within migrations.

**Step 4: Run migration tests**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: All PASS.

Run: `npx vitest run tests/main/database/schema.test.ts`
Expected: All PASS (or update tests to match new entry point).

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: consolidate schema.ts into migration system"
```

---

## Phase 3: Per-Database Authentication

### Task 3.1: Install Auth Dependencies

**Step 1: Install packages**

```bash
npm install @node-rs/argon2 nanoid
```

**Step 2: Verify no native rebuild issues**

```bash
make rebuild-node
npx vitest run --reporter=verbose 2>&1 | head -20
```

Expected: No errors — `@node-rs/argon2` ships NAPI prebuilt binaries.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @node-rs/argon2 and nanoid for authentication"
```

---

### Task 3.2: Add Users Table Migration

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/shared/types/database-schema.ts` (add UsersTable)
- Create: `tests/main/database/auth.test.ts`

**Step 1: Write the failing test**

Create `tests/main/database/auth.test.ts`:

```typescript
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Users table migration', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should create users table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).all()
    expect(tables).toHaveLength(1)
  })

  it('should have correct columns', () => {
    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    const names = columns.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('username')
    expect(names).toContain('password_hash')
    expect(names).toContain('role')
    expect(names).toContain('is_active')
    expect(names).toContain('must_change_password')
    expect(names).toContain('failed_login_count')
    expect(names).toContain('locked_until')
    expect(names).toContain('password_changed_at')
  })

  it('should create database_settings table with accounts/encryption flags', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='database_settings'"
    ).all()
    expect(tables).toHaveLength(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/auth.test.ts`
Expected: FAIL — tables don't exist yet.

**Step 3: Add migration**

In `migrations.ts`, add migration version N→N+1:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS database_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Also add `UsersTable` and `DatabaseSettingsTable` to `database-schema.ts`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/auth.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/database/migrations.ts src/shared/types/database-schema.ts tests/main/database/auth.test.ts
git commit -m "feat: add users and database_settings tables via migration"
```

---

### Task 3.3: Create AuthService

**Files:**
- Create: `src/main/services/auth/AuthService.ts`
- Create: `src/main/services/auth/index.ts`
- Test: `tests/main/database/auth.test.ts`

**Step 1: Write failing tests**

Add to `tests/main/database/auth.test.ts`:

```typescript
import { AuthService } from '../../../src/main/services/auth'

describe('AuthService', () => {
  let authService: AuthService

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const kysely = createKysely(db)
    authService = new AuthService(kysely)
  })

  describe('account setup', () => {
    it('should create first user as admin', async () => {
      const result = await authService.createFirstUser('admin1', 'Admin User', 'password123')
      expect(result.role).toBe('admin')
      expect(result.username).toBe('admin1')
    })

    it('should reject second call to createFirstUser', async () => {
      await authService.createFirstUser('admin1', 'Admin', 'pass')
      await expect(authService.createFirstUser('admin2', 'Admin2', 'pass'))
        .rejects.toThrow('Admin user already exists')
    })

    it('should generate a recovery key', async () => {
      const { recoveryKey } = await authService.createFirstUser('admin1', 'Admin', 'pass')
      expect(recoveryKey).toBeDefined()
      expect(recoveryKey.length).toBeGreaterThan(10)
    })
  })

  describe('authentication', () => {
    beforeEach(async () => {
      await authService.createFirstUser('admin1', 'Admin', 'correct-password')
    })

    it('should authenticate with correct password', async () => {
      const result = await authService.authenticate('admin1', 'correct-password')
      expect(result.success).toBe(true)
      expect(result.user?.username).toBe('admin1')
    })

    it('should reject wrong password', async () => {
      const result = await authService.authenticate('admin1', 'wrong-password')
      expect(result.success).toBe(false)
    })

    it('should increment failed login count', async () => {
      await authService.authenticate('admin1', 'wrong')
      await authService.authenticate('admin1', 'wrong')
      const user = await authService.getUser('admin1')
      expect(user?.failed_login_count).toBe(2)
    })
  })

  describe('user management', () => {
    beforeEach(async () => {
      await authService.createFirstUser('admin1', 'Admin', 'pass')
    })

    it('should create regular user (admin action)', async () => {
      const user = await authService.createUser('user1', 'User One', 'temppass', 'admin1')
      expect(user.role).toBe('user')
      expect(user.must_change_password).toBe(1)
    })

    it('should deactivate user (not delete)', async () => {
      await authService.createUser('user1', 'User One', 'pass', 'admin1')
      await authService.deactivateUser('user1')
      const user = await authService.getUser('user1')
      expect(user?.is_active).toBe(0)
    })

    it('should reset password', async () => {
      await authService.createUser('user1', 'User', 'oldpass', 'admin1')
      await authService.resetPassword('user1', 'newpass')
      const result = await authService.authenticate('user1', 'newpass')
      expect(result.success).toBe(true)
    })
  })
})
```

**Step 2: Implement AuthService**

Create `src/main/services/auth/AuthService.ts`:

```typescript
import { hash, verify } from '@node-rs/argon2'
import { nanoid } from 'nanoid'
import type { Kysely } from 'kysely'
import type { Database } from '../../../shared/types/database-schema'

const ARGON2_OPTIONS = {
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 4,
}

export class AuthService {
  constructor(private kysely: Kysely<Database>) {}

  async createFirstUser(username: string, displayName: string, password: string) {
    // Check no admin exists
    const existing = await this.kysely
      .selectFrom('users')
      .where('role', '=', 'admin')
      .selectAll()
      .executeTakeFirst()

    if (existing) throw new Error('Admin user already exists')

    const passwordHash = await hash(password, ARGON2_OPTIONS)
    const recoveryKey = nanoid(32)
    // Store recovery key hash in database_settings
    const recoveryKeyHash = await hash(recoveryKey, ARGON2_OPTIONS)

    await this.kysely.insertInto('database_settings')
      .values({ key: 'recovery_key_hash', value: recoveryKeyHash })
      .execute()

    const result = await this.kysely.insertInto('users').values({
      username,
      display_name: displayName,
      password_hash: passwordHash,
      role: 'admin',
      password_changed_at: new Date().toISOString(),
    }).executeTakeFirstOrThrow()

    return {
      id: Number(result.insertId),
      username,
      role: 'admin' as const,
      recoveryKey,
    }
  }

  async authenticate(username: string, password: string) {
    const user = await this.kysely
      .selectFrom('users')
      .selectAll()
      .where('username', '=', username)
      .where('is_active', '=', 1)
      .executeTakeFirst()

    if (!user) return { success: false, user: null }

    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return { success: false, user: null, locked: true }
    }

    const valid = await verify(user.password_hash, password)

    if (!valid) {
      await this.kysely.updateTable('users')
        .set({ failed_login_count: user.failed_login_count + 1 })
        .where('id', '=', user.id)
        .execute()
      return { success: false, user: null }
    }

    // Reset failed count on success
    await this.kysely.updateTable('users')
      .set({ failed_login_count: 0, locked_until: null })
      .where('id', '=', user.id)
      .execute()

    return { success: true, user }
  }

  async createUser(username: string, displayName: string, tempPassword: string, createdBy: string) {
    const creator = await this.getUser(createdBy)
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS)

    const result = await this.kysely.insertInto('users').values({
      username,
      display_name: displayName,
      password_hash: passwordHash,
      role: 'user',
      must_change_password: 1,
      created_by: creator?.id,
      password_changed_at: new Date().toISOString(),
    }).executeTakeFirstOrThrow()

    return {
      id: Number(result.insertId),
      username,
      role: 'user' as const,
      must_change_password: 1,
    }
  }

  async getUser(username: string) {
    return this.kysely.selectFrom('users')
      .selectAll()
      .where('username', '=', username)
      .executeTakeFirst()
  }

  async deactivateUser(username: string) {
    await this.kysely.updateTable('users')
      .set({ is_active: 0, updated_at: new Date().toISOString() })
      .where('username', '=', username)
      .execute()
  }

  async resetPassword(username: string, newPassword: string) {
    const passwordHash = await hash(newPassword, ARGON2_OPTIONS)
    await this.kysely.updateTable('users')
      .set({
        password_hash: passwordHash,
        must_change_password: 1,
        failed_login_count: 0,
        locked_until: null,
        password_changed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('username', '=', username)
      .execute()
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/auth.test.ts`
Expected: All PASS.

**Step 4: Commit**

```bash
git add src/main/services/auth/ tests/main/database/auth.test.ts
git commit -m "feat: add AuthService with Argon2id hashing and user management"
```

---

### Task 3.4: Integrate Auth into Database Creation & Opening Flow

**Files:**
- Modify: `src/main/services/DatabaseManager.ts`
- Modify: `src/main/database/DatabaseService.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/preload/index.ts` (add auth IPC channels)

**Step 1: Add auth state to DatabaseService**

```typescript
// DatabaseService additions:
private authService: AuthService | null = null
private currentUser: { id: number; username: string; role: string } | null = null

get auth(): AuthService | null { return this.authService }
get user(): { id: number; username: string; role: string } | null { return this.currentUser }

setCurrentUser(user: { id: number; username: string; role: string } | null): void {
  this.currentUser = user
}

isAccountsEnabled(): boolean {
  const setting = this.kysely
    .selectFrom('database_settings')
    .select('value')
    .where('key', '=', 'accounts_enabled')
    .executeTakeFirst()
  return setting?.value === 'true'
}
```

**Step 2: Add database creation options**

Update `DatabaseManager.create()` to accept options:

```typescript
interface CreateDatabaseOptions {
  path: string
  password?: string        // encryption
  enableAccounts?: boolean // user accounts
  adminUsername?: string   // first admin user
  adminDisplayName?: string
  adminPassword?: string   // admin password (can differ from encryption password)
}
```

**Step 3: Add auth IPC handlers**

Create `src/main/ipc/handlers/auth.ts`:

```typescript
export function registerAuthHandlers(deps: HandlerDependencies): void {
  ipcMain.handle('auth:login', async (_event, username: string, password: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      if (!db.auth) throw new Error('Accounts not enabled')
      const result = await db.auth.authenticate(username, password)
      if (result.success && result.user) {
        db.setCurrentUser({ id: result.user.id, username: result.user.username, role: result.user.role })
      }
      return result
    })
  })

  ipcMain.handle('auth:currentUser', async () => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.user
    })
  })

  ipcMain.handle('auth:isAccountsEnabled', async () => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.isAccountsEnabled()
    })
  })

  // ... createUser, listUsers, deactivateUser, resetPassword, changePassword
}
```

**Step 4: Update preload to expose auth API**

Add to `src/preload/index.ts`:

```typescript
auth: {
  login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
  currentUser: () => ipcRenderer.invoke('auth:currentUser'),
  isAccountsEnabled: () => ipcRenderer.invoke('auth:isAccountsEnabled'),
  createUser: (username: string, displayName: string, tempPassword: string) =>
    ipcRenderer.invoke('auth:createUser', username, displayName, tempPassword),
  listUsers: () => ipcRenderer.invoke('auth:listUsers'),
  deactivateUser: (username: string) => ipcRenderer.invoke('auth:deactivateUser', username),
  resetPassword: (username: string, newPassword: string) =>
    ipcRenderer.invoke('auth:resetPassword', username, newPassword),
  changePassword: (oldPassword: string, newPassword: string) =>
    ipcRenderer.invoke('auth:changePassword', oldPassword, newPassword),
  logout: () => ipcRenderer.invoke('auth:logout'),
}
```

**Step 5: Update audit log to use current user**

In `AuditLogRepository`, update `appendAuditEntry` to receive `userName` from `DatabaseService.user`:

The IPC handlers that call `appendAuditEntry` should pass `db.user?.username ?? 'anonymous'`.

**Step 6: Run tests**

Run: `make ci`
Expected: All PASS.

**Step 7: Commit**

```bash
git add -u
git add src/main/ipc/handlers/auth.ts
git commit -m "feat: integrate auth into database creation, opening, and IPC"
```

---

### Task 3.5: Add Auth Pinia Store and Login UI

**Files:**
- Create: `src/renderer/src/stores/authStore.ts`
- Create: `src/renderer/src/components/LoginView.vue`
- Create: `src/renderer/src/components/UserManagement.vue`
- Modify: `src/renderer/src/components/CreateDatabaseDialog.vue` (add toggles)

**Step 1: Create auth store**

```typescript
// src/renderer/src/stores/authStore.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<{ id: number; username: string; role: string } | null>(null)
  const accountsEnabled = ref(false)

  const isAuthenticated = computed(() => currentUser.value !== null || !accountsEnabled.value)
  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const displayName = computed(() => currentUser.value?.username ?? 'anonymous')

  async function checkAccountsEnabled() {
    if (typeof window.api === 'undefined') return
    accountsEnabled.value = await window.api.auth.isAccountsEnabled()
  }

  async function login(username: string, password: string) {
    const result = await window.api.auth.login(username, password)
    if (result.success && result.user) {
      currentUser.value = result.user
    }
    return result
  }

  function logout() {
    currentUser.value = null
    window.api.auth.logout()
  }

  return { currentUser, accountsEnabled, isAuthenticated, isAdmin, displayName, checkAccountsEnabled, login, logout }
})
```

**Step 2: Create LoginView component**

A simple login form with username/password fields, error display, and password change prompt when `must_change_password` is true.

**Step 3: Update CreateDatabaseDialog**

Add two independent toggle switches:
- "Enable encryption" (with password field)
- "Enable user accounts" (with admin username/display name/password fields)

**Step 4: Create UserManagement component**

Admin-only panel showing user list with actions: create user, deactivate, reset password.

**Step 5: Test manually and commit**

```bash
git add src/renderer/src/stores/authStore.ts
git add src/renderer/src/components/LoginView.vue
git add src/renderer/src/components/UserManagement.vue
git add -u
git commit -m "feat: add auth store, login view, and user management UI"
```

---

## Phase 4: IPC Handler Refactor & Validation

### Task 4.1: Refactor IPC Handler Registration

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: All 22+ handler files in `src/main/ipc/handlers/`

**Step 1: Define HandlerDependencies type**

Create or add to `src/main/ipc/types.ts`:

```typescript
import type { IpcMain } from 'electron'
import type { DatabaseService } from '../../database'

export interface HandlerDependencies {
  ipcMain: IpcMain
  getDb: () => DatabaseService
}
```

**Step 2: Refactor each handler file**

For each handler file, change from self-registering side effect to exported `register()` function. Example for `cases.ts`:

```typescript
// BEFORE (self-registers on import):
import { ipcMain } from 'electron'
ipcMain.handle('cases:list', async () => { ... })

// AFTER (explicit registration):
import type { HandlerDependencies } from '../types'

export function registerCaseHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.cases.getAllCases()
    })
  })
  // ... other handlers
}
```

**Step 3: Update `ipc/index.ts`**

```typescript
import { ipcMain } from 'electron'
import { getDatabaseService } from '../database'
import { registerCaseHandlers } from './handlers/cases'
import { registerVariantHandlers } from './handlers/variants'
// ... all other handlers

export function registerIpcHandlers(): void {
  const deps: HandlerDependencies = {
    ipcMain,
    getDb: getDatabaseService,
  }

  registerCaseHandlers(deps)
  registerVariantHandlers(deps)
  registerAnnotationHandlers(deps)
  // ... all other handlers
}
```

**Step 4: Run tests**

Run: `make ci`
Expected: All PASS.

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: replace IPC side-effect registration with explicit register() functions"
```

---

### Task 4.2: Add Zod Validation to All Handlers

**Files:**
- Modify: `src/shared/types/ipc-schemas.ts` (add missing schemas)
- Modify: All handler files missing validation (see list from codebase review)

**Step 1: Add missing Zod schemas**

Add to `ipc-schemas.ts`:

```typescript
// Annotation schemas
export const VariantKeySchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1),
})

export const AnnotationUpdatesSchema = z.object({
  global_comment: z.string().nullish(),
})

export const PerCaseAnnotationUpdatesSchema = z.object({
  starred: z.number().int().min(0).max(1).optional(),
  per_case_comment: z.string().nullish(),
  acmg_classification: z.string().nullish(),
  acmg_criteria: z.string().nullish(),
})

// Tag schemas
export const TagCreateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const TagUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

// Generic ID schemas
export const PositiveIntSchema = z.number().int().positive()
export const PositiveIntArraySchema = z.array(z.number().int().positive())

// Auth schemas
export const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1),
})

export const CreateUserSchema = z.object({
  username: z.string().min(1).max(100),
  displayName: z.string().max(200).optional(),
  tempPassword: z.string().min(8),
})
```

**Step 2: Apply validation to each handler**

Apply the `safeParse` pattern (already used in `variants.ts` and `cohort.ts`) to all handlers. Priority:

1. Write handlers: `annotations.ts`, `tags.ts`, `case-metadata.ts`, `gene-lists.ts`
2. Auth handlers: `auth.ts`
3. Read handlers: `cases.ts`, `export.ts`, `hpo.ts`, `transcripts.ts`

Follow existing pattern:
```typescript
const validated = SomeSchema.safeParse(input)
if (!validated.success) {
  mainLogger.error(`Invalid channel:name params: ${validated.error.message}`, 'handler')
  throw new Error('Invalid parameters')
}
```

**Step 3: Run tests**

Run: `make ci`
Expected: All PASS.

**Step 4: Commit**

```bash
git add -u
git commit -m "feat: add Zod validation to all IPC handlers"
```

---

### Task 4.3: Replace window.api Guards with useApiService

**Files:**
- Modify: All composables and components that check `typeof window.api === 'undefined'`

**Step 1: Find all instances**

Search for `typeof window.api` across `src/renderer/`. Replace each with:

```typescript
const { api, isAvailable } = useApiService()
if (!isAvailable.value) return
// Use api! instead of window.api
```

**Step 2: Run tests**

Run: `make ci`
Expected: All PASS.

**Step 3: Commit**

```bash
git add -u
git commit -m "refactor: replace scattered window.api guards with useApiService"
```

---

## Phase 5: Vue Router & Component Decomposition

### Task 5.1: Install and Configure Vue Router

**Files:**
- Modify: `package.json`
- Create: `src/renderer/src/router/index.ts`
- Modify: `src/renderer/src/main.ts`

**Step 1: Install vue-router**

```bash
npm install vue-router
```

**Step 2: Create router configuration**

Create `src/renderer/src/router/index.ts`:

```typescript
import { createRouter, createMemoryHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/cases',
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../components/LoginView.vue'),
  },
  {
    path: '/cases',
    name: 'cases',
    component: () => import('../views/CasesView.vue'),
  },
  {
    path: '/case/:id',
    name: 'case',
    component: () => import('../views/CaseView.vue'),
    children: [
      {
        path: '',
        redirect: { name: 'case-variants' },
      },
      {
        path: 'variants',
        name: 'case-variants',
        component: () => import('../views/CaseVariantsView.vue'),
      },
      {
        path: 'cohort',
        name: 'case-cohort',
        component: () => import('../views/CaseCohortView.vue'),
      },
      {
        path: 'burden',
        name: 'case-burden',
        component: () => import('../views/CaseBurdenView.vue'),
      },
      {
        path: 'info',
        name: 'case-info',
        component: () => import('../views/CaseInfoView.vue'),
      },
    ],
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
  },
]

const router = createRouter({
  history: createMemoryHistory(),  // Electron app — no URL bar
  routes,
})

// Auth guard
router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  if (to.name !== 'login' && authStore.accountsEnabled && !authStore.isAuthenticated) {
    return { name: 'login' }
  }
})

export default router
```

Note: Use `createMemoryHistory()` for Electron (no real URL bar), not `createWebHistory()`.

**Step 3: Register router in main.ts**

```typescript
import router from './router'

app.use(pinia)
app.use(router)  // Add after Pinia
app.use(vuetify)
```

**Step 4: Verify app still boots**

Run: `make dev`
Expected: App boots without errors.

**Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/router/ src/renderer/src/main.ts
git commit -m "feat: install Vue Router with route structure and auth guards"
```

---

### Task 5.2: Decompose App.vue

**Files:**
- Modify: `src/renderer/src/App.vue` (slim down to ~100 lines)
- Create: `src/renderer/src/components/AppLayout.vue`
- Create: `src/renderer/src/components/AppNavigation.vue`
- Create: `src/renderer/src/components/AppDialogHost.vue`
- Create: `src/renderer/src/views/CasesView.vue`
- Create: `src/renderer/src/views/CaseView.vue`
- Create: `src/renderer/src/views/CaseVariantsView.vue`
- Create: `src/renderer/src/views/CaseCohortView.vue`
- Create: `src/renderer/src/views/CaseBurdenView.vue`
- Create: `src/renderer/src/views/CaseInfoView.vue`
- Create: `src/renderer/src/views/SettingsView.vue`

**Step 1: Create view wrapper components**

Each view component wraps existing functionality:
- `CaseVariantsView.vue` → contains `FilterToolbar` + `VariantTable` + `VariantDetailsPanel`
- `CaseCohortView.vue` → contains `CohortView`
- `CaseBurdenView.vue` → contains `GeneBurdenView`
- `CaseInfoView.vue` → contains `CaseDataInfoTab`
- `CasesView.vue` → case list overview
- `SettingsView.vue` → settings panel

**Step 2: Create AppLayout**

Shell component with `<AppNavigation>` + `<router-view>` + `<AppDialogHost>`:

```vue
<template>
  <v-app>
    <AppNavigation />
    <v-main>
      <router-view />
    </v-main>
    <AppFooter />
    <AppDialogHost />
  </v-app>
</template>
```

**Step 3: Move dialog management to AppDialogHost**

Extract all dialog state and components (`ImportDialog`, `BatchImportDialog`, `DatabaseOverviewDialog`, etc.) from App.vue into `AppDialogHost.vue`.

**Step 4: Move navigation to AppNavigation**

Extract sidebar, case list, tab switching into `AppNavigation.vue`. Replace tab-based navigation with `router.push()` calls.

**Step 5: Slim down App.vue**

App.vue becomes:

```vue
<template>
  <AppLayout />
</template>

<script setup lang="ts">
import AppLayout from './components/AppLayout.vue'
</script>
```

**Step 6: Verify app works**

Run: `make dev`
Expected: App navigates between views correctly.

**Step 7: Commit**

```bash
git add src/renderer/src/views/ src/renderer/src/components/AppLayout.vue src/renderer/src/components/AppNavigation.vue src/renderer/src/components/AppDialogHost.vue
git add -u
git commit -m "refactor: decompose App.vue into AppLayout, views, and router-based navigation"
```

---

### Task 5.3: Decompose VariantTable.vue

**Files:**
- Modify: `src/renderer/src/components/VariantTable.vue` (slim down)
- Create: `src/renderer/src/components/variant-table/VariantTableToolbar.vue`
- Create: `src/renderer/src/components/variant-table/VariantTableHeaders.vue`
- Create: `src/renderer/src/components/variant-table/VariantTableRow.vue`
- Create: `src/renderer/src/components/variant-table/VariantTablePagination.vue`

**Step 1: Extract toolbar**

Move the top toolbar section (search, filter chips, column visibility) into `VariantTableToolbar.vue` with props for current filters and emits for filter changes.

**Step 2: Extract custom headers**

Move header rendering logic into `VariantTableHeaders.vue`.

**Step 3: Extract row template**

Move the `<template #item>` slot content into `VariantTableRow.vue` with props for the variant data.

**Step 4: Extract pagination**

Move pagination controls into `VariantTablePagination.vue`.

**Step 5: Update VariantTable.vue**

`VariantTable.vue` becomes the orchestrator (~300 lines), composing the child components:

```vue
<template>
  <div>
    <VariantTableToolbar v-bind="toolbarProps" @update:filters="..." />
    <v-data-table-server ...>
      <template #headers>
        <VariantTableHeaders :columns="..." />
      </template>
      <template #item="{ item }">
        <VariantTableRow :variant="item" @click="..." />
      </template>
      <template #bottom>
        <VariantTablePagination v-bind="paginationProps" />
      </template>
    </v-data-table-server>
  </div>
</template>
```

**Step 6: Test**

Run: `make dev` and verify variant table works.

**Step 7: Commit**

```bash
git add src/renderer/src/components/variant-table/
git add -u
git commit -m "refactor: decompose VariantTable.vue into toolbar, headers, row, and pagination"
```

---

### Task 5.4: Decompose Remaining Large Components

**Files:** See design section 5c for full list.

Apply the same decomposition pattern for each component. Work through them in order:

**Step 1: DatabaseOverviewDialog.vue → OverviewStatsGrid, OverviewCaseList, OverviewCharts**

**Step 2: CaseDataInfoTab.vue → DataInfoForm, ExternalIdsEditor, FilterSummary**

**Step 3: CohortDataTable.vue → CohortTableHeaders, CohortTableRow (exists), CohortExpansion**

**Step 4: AcmgClassificationPanel.vue → AcmgEvidenceGrid, AcmgSummaryBar**

**Step 5: CohortTable.vue → CohortTableToolbar, CohortPagination**

**Step 6: BatchImportDialog.vue → BatchFileList, BatchProgressBar, DuplicateHandler**

**Commit after each component:**

```bash
git commit -m "refactor: decompose DatabaseOverviewDialog into child components"
git commit -m "refactor: decompose CaseDataInfoTab into child components"
git commit -m "refactor: decompose CohortDataTable into child components"
git commit -m "refactor: decompose AcmgClassificationPanel into child components"
git commit -m "refactor: decompose CohortTable into child components"
git commit -m "refactor: decompose BatchImportDialog into child components"
```

---

### Task 5.5: Refactor Singleton Composables to provide/inject

**Files:**
- Modify: `src/renderer/src/composables/useFilters.ts`
- Modify: `src/renderer/src/views/CaseCohortView.vue` (provide filters)
- Modify: Components that call `useFilters()` (inject instead)
- Test: `tests/renderer/composables/useFilters.test.ts`

**Step 1: Convert useFilters to factory pattern**

```typescript
import { provide, inject } from 'vue'
import type { InjectionKey } from 'vue'

export const FiltersKey: InjectionKey<UseFiltersReturn> = Symbol('filters')

export function createFilters(): UseFiltersReturn {
  // Move all current module-level state INTO this function
  const filters = ref<FilterState>(...)
  // ... all refs and logic
  return { filters, ... }
}

export function useFilters(): UseFiltersReturn {
  const filters = inject(FiltersKey)
  if (!filters) throw new Error('useFilters() called without provider')
  return filters
}
```

**Step 2: Provide in CaseCohortView**

```vue
<script setup>
import { provide } from 'vue'
import { FiltersKey, createFilters } from '../composables/useFilters'

const filters = createFilters()
provide(FiltersKey, filters)
</script>
```

**Step 3: Remove `_resetFiltersForTesting()` hack**

No longer needed — each test creates its own instance.

**Step 4: Update tests**

```typescript
// Tests now use createFilters() directly
const filters = createFilters()
```

**Step 5: Run tests**

Run: `npx vitest run tests/renderer/composables/useFilters.test.ts`
Expected: All PASS.

**Step 6: Commit**

```bash
git add -u
git commit -m "refactor: replace singleton useFilters with provide/inject pattern"
```

---

## Phase 6: Test Coverage

### Task 6.1: Encryption/Password Flow Tests

**Files:**
- Modify: `tests/main/database/sqlcipher.test.ts`

**Step 1: Add comprehensive tests**

```typescript
describe('encryption edge cases', () => {
  it('should handle empty password string')
  it('should handle unicode characters in password')
  it('should handle very long passwords (1000+ chars)')
  it('should handle special characters: backslash, null byte, emoji')
  it('should fail with wrong password and throw WrongPasswordError')
  it('should rekey from encrypted to unencrypted')
  it('should rekey from unencrypted to encrypted')
})
```

**Step 2: Implement and run**

Run: `npx vitest run tests/main/database/sqlcipher.test.ts`

**Step 3: Commit**

```bash
git commit -m "test: add comprehensive encryption/password flow tests"
```

---

### Task 6.2: Auth Flow Tests

**Files:**
- Modify: `tests/main/database/auth.test.ts`

**Step 1: Add comprehensive tests**

```typescript
describe('auth edge cases', () => {
  it('should handle concurrent login attempts')
  it('should handle deactivated user login')
  it('should enforce must_change_password')
  it('should validate password recovery with master key')
  it('should reject recovery with wrong key')
  it('should list all users (admin only)')
  it('should prevent non-admin from creating users')
  it('should prevent deactivating last admin')
})
```

**Step 2: Commit**

```bash
git commit -m "test: add comprehensive auth flow tests"
```

---

### Task 6.3: Component Tests for Decomposed Components

**Files:**
- Create: `tests/renderer/components/VariantTableToolbar.test.ts`
- Create: `tests/renderer/components/VariantTableRow.test.ts`
- Create: `tests/renderer/components/LoginView.test.ts`
- Create: `tests/renderer/components/AppNavigation.test.ts`

**Step 1: Write component tests following existing patterns**

Use the patterns from `CohortFilterBar.test.ts` and `CohortTableRow.test.ts`:
- Mount with Vuetify instance
- Stub complex children
- Mock `window.api` with `createMockApi()`
- Test rendering, user interactions, emitted events

**Step 2: Run**

Run: `npx vitest run tests/renderer/components/`

**Step 3: Commit**

```bash
git commit -m "test: add component tests for decomposed VariantTable and auth UI"
```

---

### Task 6.4: IPC Handler Tests

**Files:**
- Create: `tests/main/handlers/annotations-handlers.test.ts`
- Create: `tests/main/handlers/tags-handlers.test.ts`
- Create: `tests/main/handlers/case-metadata-handlers.test.ts`
- Create: `tests/main/handlers/auth-handlers.test.ts`

**Step 1: Follow existing handler test patterns**

Use patterns from `variants-handlers.test.ts`:
- Create in-memory DatabaseService
- Insert test data
- Call handler functions directly (now possible with explicit `register()` pattern)
- Assert response structure and data

**Step 2: Run**

Run: `npx vitest run tests/main/handlers/`

**Step 3: Commit**

```bash
git commit -m "test: add IPC handler tests for annotations, tags, metadata, and auth"
```

---

### Task 6.5: Export Functionality Tests

**Files:**
- Create: `tests/main/handlers/export-handlers.test.ts`

**Step 1: Test export with various filter combinations**

```typescript
describe('export handlers', () => {
  it('should export all variants for a case')
  it('should export filtered variants')
  it('should export cohort data')
  it('should produce valid CSV/XLSX format')
})
```

**Step 2: Commit**

```bash
git commit -m "test: add export functionality tests"
```

---

### Task 6.6: Final CI Verification

**Step 1: Run full CI pipeline**

```bash
make ci-full
```

Expected: All lint, typecheck, and tests pass on current platform.

**Step 2: Bump version**

Update `package.json` version to `0.21.0`.

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.21.0"
```

---

## Summary: Task Count by Phase

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 2 | Critical fixes & config |
| 2 | 8 | Kysely migration & DB refactor |
| 3 | 5 | Per-database authentication |
| 4 | 3 | IPC handler refactor & validation |
| 5 | 5 | Vue Router & component decomposition |
| 6 | 6 | Test coverage |
| **Total** | **29** | |

## Dependency Graph

```
Phase 1 (config + SQL fix) → Phase 2 (Kysely) → Phase 3 (auth, needs Kysely)
                                                → Phase 4 (IPC refactor, needs God Object removal)
                                                → Phase 5 (Vue Router + decomposition, independent of backend)
All phases → Phase 6 (test coverage)
```

Phases 4 and 5 can run in parallel after Phase 2 is complete.
