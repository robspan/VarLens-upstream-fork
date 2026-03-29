# VarLens Codebase Review Report

**Date**: 2026-03-09
**Version Reviewed**: 0.20.0 (branch: `feature/gene-burden-association`)
**Reviewer**: Senior Full-Stack Engineer (Electron, SQLite, TypeScript)
**Goal**: Assess long-term maintainability, cloud migration readiness (AWS/PostgreSQL), and medical-grade quality

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Source code | ~43,000 lines (239 files) |
| Test code | ~12,600 lines (51 test files, 62 test suites) |
| Vue components | 76 |
| Composables | 30 |
| Pinia stores | 4 |
| Database repositories | 8 |
| IPC handler modules | 22 |
| Database migrations | 11 (v0.3.0 → v0.21.0) |
| Dependencies | 14 runtime, 29 dev |

VarLens is a well-structured Electron desktop application with many solid engineering decisions already in place. The codebase shows clear architectural thinking, good Electron security practices, and a working repository pattern. Below we rate each dimension and identify improvements ranked by importance.

---

## Ratings (1–10)

| # | Aspect | Score | Summary |
|---|--------|-------|---------|
| 1 | **Architecture & Modularity** | 7.5 | Clean main/preload/renderer separation, repository pattern, strategy pattern for imports, composable-first renderer |
| 2 | **Security** | 6 | Context isolation + CSP + Zod validation — but SQL injection risk in encryption pragma |
| 3 | **Database Design** | 7 | Well-indexed, FTS5, proper migrations, WAL mode, performance pragmas |
| 4 | **Type Safety** | 7 | TypeScript throughout, Zod at IPC boundaries, shared types — many `as` casts on DB results |
| 5 | **Testing** | 6.5 | 62 test suites covering DB/stats/composables/handlers; 70% coverage thresholds configured; gaps in component tests |
| 6 | **DRY / Code Reuse** | 5.5 | 30 composables show good extraction; filter-building duplication and God Object facade remain |
| 7 | **Performance** | 8 | Statement caching, batch inserts, FTS5 optimization, cursor pagination, WAL, worker pool for stats |
| 8 | **Error Handling** | 8 | Custom error hierarchy, IPC error serialization, global crash handlers, optimistic UI with rollback |
| 9 | **Configuration Management** | 6 | Hardcoded magic numbers for pragmas, batch sizes, timeouts; no centralized config module |
| 10 | **CI/CD & Build** | 7 | Multi-platform CI, Makefile, lint+typecheck+test pipeline; no coverage enforcement in CI |
| 11 | **Cloud Migration Readiness** | 3 | Direct SQLite coupling everywhere, no database abstraction interface, no auth layer, no router |
| 12 | **Medical/Regulatory Readiness** | 4 | Audit trail + encryption exist — no user auth, no data validation pipeline, no traceability matrix |

**Overall: 6.3 / 10** — Solid for a research tool; needs strategic investment for medical-grade and cloud readiness.

---

## Detailed Findings

### What's Done Well

These are genuinely strong engineering decisions that should be preserved:

- **Electron security**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP headers via `onHeadersReceived`, single-instance lock
- **Zod IPC validation** on critical paths (variants, cohort, association) — uncommon and impressive for an Electron app
- **Custom error hierarchy** (`DatabaseError` → `NotFoundError`, `UniqueConstraintError`, `WrongPasswordError`) with proper IPC serialization via `wrapHandler()`
- **FTS5 full-text search** with external content table, prefix indexes, proper sync triggers, and bulk-insert optimization (drop/restore triggers)
- **Cursor-based pagination** (not offset-based) — correct for large datasets, handles NULL sort values
- **Prepared statement caching** in `BaseRepository` — avoids re-parse overhead
- **Audit trail** — immutable `audit_log` table with 8 action types
- **Database encryption** via SQLCipher (`better-sqlite3-multiple-ciphers`)
- **Worker pool** for statistical computations — avoids blocking the main process event loop
- **Import strategy pattern** — `StrategyRegistry` with `ColumnarStrategy`, `ObjectStrategy`, `SimpleStrategy`; extensible for future formats
- **Composable-first renderer** — 30 composables extracting reusable logic from components
- **Optimistic UI updates** — annotation cache updates immediately, rolls back on IPC error
- **Comprehensive migration history** — 11 versioned migrations, idempotent, with column-existence guards

---

## Improvements Ranked by Importance

### 1. CRITICAL — SQL Injection in Encryption Pragma

**File**: `src/main/database/DatabaseService.ts:91`

```typescript
// CURRENT — vulnerable to injection via single quotes in password
this.db.pragma(`key='${encryptionKey}'`)

// ALSO in rekey():
this.db.pragma(`rekey='${newPassword}'`)
```

If a user provides a password containing a single quote (e.g., `it's_secure`), this breaks the pragma statement. Worse, it could be exploited to execute arbitrary pragmas.

**Fix**: Escape single quotes or use the parameterized form if the driver supports it:

```typescript
// Option A: Escape
const safeKey = encryptionKey.replace(/'/g, "''")
this.db.pragma(`key='${safeKey}'`)

// Option B: Use PRAGMA via prepared statement (check driver support)
this.db.prepare("PRAGMA key = ?").run(encryptionKey)
```

**Impact**: Security vulnerability in a tool handling medical/genetic data.

---

### 2. HIGH — Database Abstraction Layer for Cloud Migration

**Problem**: `DatabaseService` and all 8 repositories are directly coupled to `better-sqlite3`. There is no interface between application logic and the database engine.

**Current coupling chain**:

```
IPC Handler → getDatabaseService() → DatabaseService → better-sqlite3
                                          ↓
                                    *Repository(db, cache) → this.db.prepare(sql)
```

**Required for PostgreSQL/cloud migration**:

```typescript
// 1. Database adapter interface
interface IDatabaseAdapter {
  prepare(sql: string): IPreparedStatement
  exec(sql: string): void
  transaction<T>(fn: () => T): T
  pragma?(key: string): unknown  // SQLite-only, optional
}

// 2. Repository interfaces
interface ICaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number
  getCase(id: number): Case
  getAllCases(): Case[]
  deleteCase(id: number): void
}

// 3. Factory
function createDatabaseAdapter(config: DatabaseConfig): IDatabaseAdapter {
  if (config.type === 'sqlite') return new SqliteAdapter(config)
  if (config.type === 'postgresql') return new PostgresAdapter(config)
}
```

**Alternatively**: Adopt [Kysely](https://github.com/kysely-org/kysely) — a TypeScript-first query builder that supports both SQLite and PostgreSQL with zero-overhead type safety. This would replace raw SQL strings while maintaining performance.

**Impact**: This is the single highest-impact architectural change for enabling a cloud version.

---

### 3. HIGH — DatabaseService God Object

**File**: `src/main/database/DatabaseService.ts` (618 lines)

`DatabaseService` re-exposes **every single method** from all 8 repositories as pass-through delegates. This violates the Single Responsibility Principle:

```typescript
// Current: 60+ delegate methods like these
createCase(name, filePath, fileSize) { return this.cases.createCase(name, filePath, fileSize) }
getCase(id) { return this.cases.getCase(id) }
deleteCase(id) { this.cases.deleteCase(id) }
// ... repeated for variants, annotations, tags, metadata, audit, geneLists
```

Every new repository method requires adding a delegate. The class grows linearly with features.

**Fix**: Expose repositories directly via getters:

```typescript
class DatabaseService {
  get cases(): CaseRepository { return this._cases }
  get variants(): VariantRepository { return this._variants }
  get annotations(): AnnotationRepository { return this._annotations }
  // ...
}

// Usage: db.cases.getCase(id) instead of db.getCase(id)
```

**Impact**: Reduces maintenance burden, makes the codebase easier to navigate, prepares for interface extraction.

---

### 4. HIGH — Duplicated Filter-Building Logic

**File**: `src/main/database/VariantRepository.ts`

`getVariants()` (lines 263–418) and `getAllVariantsForExport()` (lines 451–552) contain **~80 lines of identical filter-building code**:

```typescript
// Duplicated in BOTH methods:
if (filter.consequences !== undefined && filter.consequences.length > 0) {
  const placeholders = filter.consequences.map(() => '?').join(', ')
  conditions.push(`consequence IN (${placeholders})`)
  params.push(...filter.consequences)
}
// ... 15 more identical filter blocks
```

**Fix**: Extract a shared method:

```typescript
private buildFilterConditions(filter: VariantFilter): {
  conditions: string[]
  params: (string | number | null)[]
} {
  // All filter logic here, once
}

getVariants(filter, limit, cursor?, sortBy?) {
  const { conditions, params } = this.buildFilterConditions(filter)
  // Add pagination/sort logic
}

getAllVariantsForExport(filter) {
  const { conditions, params } = this.buildFilterConditions(filter)
  // Simple SELECT with ORDER BY
}
```

**Impact**: Prevents filter logic from diverging between paginated queries and export queries.

---

### 5. HIGH — Centralized Configuration Module

**Problem**: Hardcoded values scattered across the codebase with no single configuration source.

| Value | Location | Purpose |
|-------|----------|---------|
| `-32000` | `DatabaseService.ts:103` | SQLite cache size (32 MB) |
| `268435456` | `DatabaseService.ts:105` | mmap_size (256 MB) |
| `5000` | `DatabaseService.ts:104` | busy_timeout (ms) |
| `5000` | `VariantRepository.ts:10` | Batch insert size |
| `1440 × 900` | `index.ts:38` | Default window dimensions |
| `67` | `VepApiClient.ts` | Bottleneck minTime (15 req/sec) |
| `55000` | `VepApiClient.ts` | VEP hourly rate limit |
| `30` | `ApiCache.ts` | Cache TTL (days) |
| `100` | Import handler | Progress throttle (ms) |
| `5` | `RecentDatabasesService.ts` | Max recent databases |
| `60` | `ipc-schemas.ts:93` | Max CADD score |
| `1000` | `logStore.ts` | Max log entries |
| `300` | Various composables | Debounce delay (ms) |
| `3000` / `-1` | Various components | Snackbar timeout (success/error) |
| `[10, 25, 50, 100]` | `VariantTable.vue` | Items-per-page options |

**Fix**: Create a centralized config module:

```
src/shared/config/
├── database.config.ts    # pragma values, batch sizes, cache TTL
├── api.config.ts         # URLs, timeouts, rate limits
├── app.config.ts         # window dimensions, pagination defaults
├── domain.config.ts      # CADD max, AF ranges, consequence groups
└── index.ts              # Re-exports
```

```typescript
// Example: src/shared/config/database.config.ts
export const DATABASE_CONFIG = {
  CACHE_SIZE_KB: 32000,
  MMAP_SIZE_BYTES: 268_435_456,
  BUSY_TIMEOUT_MS: 5000,
  BATCH_INSERT_SIZE: 5000,
  CACHE_TTL_DAYS: 30,
  MAX_RECENT_DATABASES: 5,
} as const
```

**Impact**: Single source of truth; enables environment-specific overrides for cloud deployment.

---

### 6. MEDIUM — Unsafe Type Casts on Database Results

**Files**: All repository files

Throughout the repositories, raw SQL results are cast with `as`:

```typescript
const result = this.db.prepare(sql).all(...params) as Variant[]
const countResult = this.db.prepare(countSql).get(...params) as { count: number }
const columns = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
```

These casts provide zero runtime safety. If the SQL changes and columns don't match the type, errors propagate silently as `undefined` fields.

**Fix (incremental)**: Create a typed query wrapper in `BaseRepository`:

```typescript
import { z } from 'zod'

protected typedAll<T>(schema: z.ZodSchema<T>, sql: string, ...params: unknown[]): T[] {
  const raw = this.stmt(sql).all(...params)
  return raw.map(row => schema.parse(row))
}

// Usage:
const CountSchema = z.object({ count: z.number() })
const result = this.typedGet(CountSchema, 'SELECT COUNT(*) as count ...', caseId)
```

**Impact**: Catches schema-data mismatches at the repository boundary rather than in the renderer.

---

### 7. MEDIUM — No User Authentication Model

**Current state**: The `audit_log` table has a `user_name TEXT` column that is always `null` because there is no user identity system. The `settingsStore` has a `userName` field but it's purely cosmetic.

**For medical use and cloud readiness**:

1. **Phase 1 (desktop)**: Add a `User` model backed by settings; populate `audit_log.user_name`
2. **Phase 2 (cloud)**: OAuth 2.0 / OIDC integration (e.g., AWS Cognito)
3. **Phase 3**: Role-based access control (RBAC) — viewer, annotator, admin

**Impact**: Required for audit trail integrity, regulatory compliance, and cloud multi-tenancy.

---

### 8. MEDIUM — IPC Handler Registration via Side Effects

**File**: `src/main/ipc/index.ts`

```typescript
export async function registerIpcHandlers(): Promise<void> {
  await Promise.all([
    import('./handlers/cases'),       // self-registers on import
    import('./handlers/variants'),    // self-registers on import
    // ... 20+ more
  ])
}
```

Handlers self-register via `ipcMain.handle()` as a side effect of being imported. This pattern:

- Makes it impossible to test handlers in isolation without full Electron IPC
- Prevents dependency injection (handlers reach for `getDatabaseService()` globally)
- Creates hidden coupling between handler registration and module loading

**Fix**: Each handler module exports a `register()` function:

```typescript
// handlers/cases.ts
export function registerCaseHandlers(ipcMain: IpcMain, getDb: () => DatabaseService): void {
  ipcMain.handle('cases:list', () => wrapHandler(async () => getDb().getAllCases()))
}

// ipc/index.ts
import { registerCaseHandlers } from './handlers/cases'
export function registerIpcHandlers(ipcMain: IpcMain, getDb: () => DatabaseService): void {
  registerCaseHandlers(ipcMain, getDb)
  registerVariantHandlers(ipcMain, getDb)
  // ...
}
```

**Impact**: Enables unit testing of handlers, dependency injection, and cleaner cloud API migration.

---

### 9. MEDIUM — Missing Test Coverage for Large Components

**Test gaps identified**:

| Area | Status | Risk |
|------|--------|------|
| `VariantTable.vue` (1067 lines) | No component tests | High — core user workflow |
| `DatabaseOverviewDialog.vue` (763 lines) | No component tests | Medium |
| `CaseDataInfoTab.vue` (683 lines) | No component tests | Medium |
| `BatchImportDialog.vue` (540 lines) | No component tests | Medium |
| `FilterToolbar.vue` (416 lines) | No component tests | Medium |
| Annotation IPC handlers | No handler tests | Medium — data integrity |
| Tag IPC handlers | No handler tests | Low |
| Case-metadata IPC handlers | No handler tests | Medium |
| Export functionality | No tests at all | Medium |
| Database encryption/password | Minimal tests | High — security feature |

**Existing strengths**: Database layer, statistics, composables, and import pipeline are well-tested.

**Fix**: Prioritize tests for:
1. Encryption/password flows (security-critical)
2. `VariantTable.vue` (core user workflow)
3. Annotation/metadata IPC handlers (data integrity)
4. Export functionality (data accuracy)

---

### 10. MEDIUM — Large Vue Components Need Decomposition

Several components exceed maintainable size thresholds:

| Component | Lines | Suggested Decomposition |
|-----------|-------|------------------------|
| `VariantTable.vue` | 1067 | Extract: `VariantTableToolbar`, `VariantTablePagination`, `VariantTableHeaders` |
| `App.vue` | 794 | Extract: `AppLayout`, `AppTabManager`, `AppDialogHost` |
| `DatabaseOverviewDialog.vue` | 763 | Extract: `OverviewStatsGrid`, `OverviewCaseList`, `OverviewCharts` |
| `CaseDataInfoTab.vue` | 683 | Extract: `DataInfoForm`, `ExternalIdsEditor`, `FilterSummary` |
| `CohortDataTable.vue` | 646 | Extract: `CohortTableHeaders`, `CohortTableRow`, `CohortExpansion` |
| `DnaIcon.vue` | 589 | SVG icon — acceptable at this size |
| `AcmgClassificationPanel.vue` | 561 | Extract: `AcmgEvidenceGrid`, `AcmgSummaryBar` |
| `CohortTable.vue` | 557 | Extract: `CohortTableToolbar`, `CohortPagination` |
| `BatchImportDialog.vue` | 540 | Extract: `BatchFileList`, `BatchProgressBar`, `DuplicateHandler` |

**Rule of thumb**: Components over ~400 lines typically have multiple responsibilities. Extract logical sections into child components with clear props/emit contracts.

---

### 11. MEDIUM — Inconsistent IPC Validation Coverage

Some handlers validate all inputs with Zod schemas (good):

```typescript
// variants.ts — validates caseId, filters, cursor, limit, sortBy
const validatedCaseId = CaseIdSchema.safeParse(caseId)
```

Other handlers accept raw parameters without validation:

```typescript
// annotations.ts — no Zod validation
ipcMain.handle('annotations:upsertGlobal', async (_event, chr, pos, ref, alt, updates) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.upsertGlobalAnnotation(chr, pos, ref, alt, updates) // trusts input
  })
})
```

**Fix**: Apply Zod validation consistently to all IPC handlers, especially those that write data.

---

### 12. LOW — No Vue Router / URL State

The app uses `v-window` tab switching with no URL routing. All state is lost on page refresh.

**Current approach**: Tab state managed in `App.vue` with `activeTab` ref.

**For cloud migration**: A web version needs:
- Vue Router with route-based state
- Deep-linking to specific cases/variants (e.g., `/case/42/variant/123`)
- Browser back/forward navigation
- Bookmarkable filtered views

---

### 13. LOW — Singleton Composable State Risk

**File**: `src/renderer/src/composables/useFilters.ts`

`useFilters()` maintains module-level state — a single instance shared across all callers. This enables cross-component synchronization (e.g., `CohortFilterBar` ↔ `CohortTable`) but:

- Requires explicit `_resetFiltersForTesting()` for test isolation
- Could cause subtle bugs if future features need independent filter instances
- Makes the data flow harder to trace

**Fix**: Consider dependency injection via `provide`/`inject` or scoped composable factories.

---

### 14. LOW — Repeated `window.api` Guards

The pattern `if (typeof window.api === 'undefined') return` appears ~20+ times across composables and components. The `useApiService()` composable exists but isn't used consistently.

**Fix**: Use `useApiService()` everywhere, or create a global guard at the app entry point.

---

### 15. LOW — Boolean Field Inconsistency in Types

Some database entities use `number` (0/1) for booleans:

```typescript
// database/types.ts
starred: number       // 0 or 1
is_predefined: number // 0 or 1
```

While API-facing types use `boolean`. This creates implicit conversion at the repository boundary.

**Fix**: Add explicit conversion in repositories, or use Zod transforms to normalize at the boundary.

---

### 16. LOW — Statement Cache is Unbounded

**File**: `src/main/database/BaseRepository.ts`

```typescript
protected stmt(sql: string): Statement {
  let statement = this.statementCache.get(sql)
  if (statement === undefined) {
    statement = this.db.prepare(sql)
    this.statementCache.set(sql, statement)
  }
  return statement
}
```

The cache `Map<string, Statement>` grows without bound. For typical usage this is fine (finite set of queries), but dynamic query construction (e.g., varying filter combinations) could leak.

**Fix**: Add a max size with LRU eviction, or document that dynamic queries should not use `stmt()`.

---

### 17. LOW — Migration System Improvements

**File**: `src/main/database/migrations.ts`

Current system works but could be more robust:

- **No rollback capability** — migrations are forward-only
- **No checksums** — no verification that migrations applied correctly
- **Dual schema paths** — `schema.ts` handles initial tables + column migrations, while `migrations.ts` handles versioned migrations. This creates two competing evolution paths.

**Fix**: Consolidate all schema evolution into the migration system. `schema.ts` should contain only the initial v0 schema.

---

## Cloud Migration Roadmap

To prepare for an AWS/PostgreSQL online version:

```
Phase 1: Abstraction Layer (Current Sprint)
├── Extract IDatabaseAdapter interface
├── Extract IRepository interfaces (ICaseRepository, IVariantRepository, etc.)
├── Create centralized config module
└── Replace DatabaseService God Object with repository getters

Phase 2: Query Builder (Next Sprint)
├── Adopt Kysely or similar TypeScript-first query builder
├── Replace raw SQL strings with typed builder calls
├── Maintain SQLite adapter, add PostgreSQL adapter
└── Ensure both pass the same test suite

Phase 3: Authentication (v1.0)
├── Add User model and authentication service
├── Implement JWT/session management
├── Populate audit_log.user_name
└── Add role-based access control

Phase 4: API Layer (v1.1)
├── Create REST/GraphQL API mirroring IPC handlers
├── Share Zod validation schemas between IPC and API
├── Add rate limiting, request logging
└── Deploy to AWS (ECS/Lambda + RDS PostgreSQL)

Phase 5: Web Renderer (v1.2)
├── Add Vue Router for URL-based navigation
├── Replace window.api calls with HTTP client
├── Reuse Vue components and composables
└── Add WebSocket for real-time progress updates
```

---

## Medical/Regulatory Readiness Assessment

Per [IEC 62304](https://www.iso.org/standard/38421.html) (Medical Device Software Lifecycle):

| Requirement | Status | Gap |
|-------------|--------|-----|
| Software development plan | Partial (CLAUDE.md, CI/CD) | No formal SDP document |
| Requirements traceability | Missing | No requirement → code → test mapping |
| Architecture documentation | Partial (CLAUDE.md) | No formal SAD document |
| Software unit verification | Good (unit tests) | Coverage gaps in components |
| Integration testing | Good (E2E tests) | Limited handler integration tests |
| Configuration management | Good (git, CI) | No release checksums |
| Risk management | Missing | No FMEA or risk analysis |
| Audit trail | Good (audit_log table) | No user identity (always null) |
| Data integrity | Good (FK constraints, transactions) | No input validation pipeline |
| Access control | Missing | No authentication or authorization |
| Anomaly resolution | Partial (error handling) | No formal bug tracking process |

**Classification**: Currently suitable for **Class A** (no safety risk) software. For **Class B** (non-serious injury) or higher, significant documentation and process additions are needed.

---

## Summary

VarLens has a strong technical foundation with thoughtful decisions around security, performance, and extensibility. The codebase is well above average for a research tool. The top 5 priorities to set the path toward a medical-grade, cloud-ready product are:

1. **Fix the SQL injection in encryption pragma** (security, immediate)
2. **Extract database abstraction interfaces** (architecture, enables cloud migration)
3. **Refactor DatabaseService God Object** (maintainability, enables #2)
4. **Centralize configuration** (config-driven development, enables environment-specific deployments)
5. **Eliminate filter-building duplication** (DRY, prevents divergence bugs)

These changes are incremental and can be done without rewriting the application. Each improvement compounds — the abstraction layer enables the cloud migration, which enables authentication, which enables medical-grade audit trails.

---

*Report generated from comprehensive codebase analysis including all source files in `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, and `tests/`.*

*Research sources:*
- *[IEC 62304: Software Lifecycle Processes for Medical Devices](https://www.jamasoftware.com/blog/an-in-depth-guide-to-iec-62304-software-lifecycle-processes-for-medical-devices/)*
- *[Building High-Performance Electron Apps](https://www.johnnyle.io/read/electron-performance)*
- *[TypeORM — TypeScript ORM for PostgreSQL and SQLite](https://github.com/typeorm/typeorm)*
- *[Building an Electron App Offline-First](https://medium.com/@AkiBuilds/building-an-electron-app-offline-first-local-first-architecture-for-privacy-desktop-software-ed32bc7384d9)*
- *[Database Migration: TypeScript Journey from MongoDB to PostgreSQL](https://nearform.com/digital-community/database-migration-a-typescript-guided-journey-from-mongodb-to-postgresql/)*
