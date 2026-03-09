# VarLens v0.21.0 — Codebase Improvements Design

**Date**: 2026-03-09
**Based on**: `.planning/docs/CODEBASE-REVIEW.md`
**Goal**: Fix critical/high issues, prepare for cloud migration (Kysely + PostgreSQL) and medical readiness (audit-compliant user accounts)

---

## Execution Order

Bottom-up: stabilize the data layer first, then layer authentication, IPC improvements, and finally UI refactoring.

---

## Phase 1: Critical Fixes & Configuration

### 1a. SQL Injection in Encryption Pragma

Escape single quotes in `DatabaseService.ts` for `key` and `rekey` pragmas:

```typescript
const safeKey = encryptionKey.replace(/'/g, "''")
this.db.pragma(`key='${safeKey}'`)
```

### 1b. Centralized Configuration Module

Create `src/shared/config/`:

```
src/shared/config/
├── database.config.ts    # pragma values, batch sizes, cache TTL
├── api.config.ts         # VEP URLs, timeouts, rate limits
├── app.config.ts         # window dimensions, pagination, debounce, snackbar
├── domain.config.ts      # CADD max, AF ranges, consequence groups
└── index.ts              # re-exports
```

All hardcoded magic numbers replaced with named `as const` exports.

---

## Phase 2: Kysely Migration & Database Refactor

### 2a. Kysely Setup

- Add `kysely` + better-sqlite3 dialect
- Define full typed `Database` schema in `src/shared/types/database.ts`
- Create Kysely instance factory in `DatabaseService` wrapping the existing better-sqlite3 connection

### 2b. Repository Migration (All 8 at Once)

Replace raw SQL in all repositories with Kysely typed query builder:

- `BaseRepository` — remove manual `Map<string, Statement>` cache (Kysely handles prepared statements)
- All repositories — `.prepare(sql)` calls become `.selectFrom()`, `.insertInto()`, `.updateTable()`, `.deleteFrom()` chains
- `VariantRepository` — duplicated filter logic in `getVariants()` / `getAllVariantsForExport()` becomes shared `applyVariantFilters(query, filter)` chaining `.where()` calls
- FTS5 queries — use Kysely `sql` template tag for SQLite-specific `MATCH` and `rank`

### 2c. DatabaseService God Object Refactor

Replace 60+ delegate methods with repository getters:

```typescript
class DatabaseService {
  get cases(): CaseRepository { return this._cases }
  get variants(): VariantRepository { return this._variants }
  get annotations(): AnnotationRepository { return this._annotations }
  // ...
}
```

IPC handlers update from `db.getCase(id)` to `db.cases.getCase(id)`.

### 2d. Typed Query Results

Remove all `as` casts on database results. Kysely returns typed results from the `Database` schema. Zod `typedAll()` wrapper unnecessary.

### 2e. Migration System Consolidation

Merge `schema.ts` initial table creation into the migration system. Migration 0 = initial schema. Single evolution path.

---

## Phase 3: Per-Database Authentication

### 3a. Two Independent Toggles at Database Creation

| | No Accounts | Accounts |
|---|---|---|
| **No Encryption** | Fully open, `"anonymous"` audit | Login required, named audit |
| **Encryption** | Password to open, `"anonymous"` audit | Password to open + login, named audit |

Both choices are made at database creation time. Accounts cannot be disabled once enabled (audit trail integrity).

### 3b. Authentication Stack

- **`@node-rs/argon2`** — Argon2id hashing, NAPI prebuilt (no Electron rebuild)
- **`nanoid`** — session tokens, recovery codes
- OWASP defaults: 64MB memory, 3 iterations, parallelism 4

### 3c. User Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
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
```

### 3d. Two-Role Model

- **`admin`** — create/delete users, reset passwords, manage settings
- **`user`** — perform analysis operations
- Both roles fully audit-logged
- Accounts soft-disabled (never deleted) to preserve audit references

### 3e. First User & Recovery

- First user created when accounts are enabled becomes `admin` automatically
- One-time master recovery key generated and shown once at setup
- Admin-only password reset (temporary password + `must_change_password` flag)

### 3f. Session Management

- Current user in Pinia store (renderer) + `DatabaseService` (main process)
- Session token in memory, cleared on app close
- `audit_log.user_name` populated from authenticated user or `"anonymous"`

### 3g. Database Opening Flow

- Attempt unencrypted open; if fails, prompt for encryption password
- If accounts enabled: show login screen after database opens
- If accounts disabled: set identity to `"anonymous"`

---

## Phase 4: IPC Handler Refactor & Validation

### 4a. Explicit Handler Registration

Replace side-effect self-registration with exported `register()` functions:

```typescript
export function registerCaseHandlers(deps: HandlerDependencies): void {
  ipcMain.handle('cases:list', () => wrapHandler(...))
}
```

### 4b. Consistent Zod Validation

Add Zod schemas to all unvalidated handlers. Priority: write operations first (annotations, tags, case-metadata, gene-lists), then reads (export, settings, recent-databases).

### 4c. Window.api Guards

Replace ~20 scattered `typeof window.api === 'undefined'` checks with consistent `useApiService()` usage.

### 4d. Boolean Field Normalization

Kysely column type mappings to convert SQLite `0/1` to TypeScript `boolean` at the query boundary.

---

## Phase 5: Vue Router & Component Decomposition

### 5a. Vue Router

Route structure:

```
/                         → redirect to /cases
/cases                    → Case list / overview
/case/:id                 → Case detail
/case/:id/variants        → Variant table (default sub-route)
/case/:id/cohort          → Cohort analysis
/case/:id/burden          → Gene burden analysis
/case/:id/info            → Case data info
/settings                 → App settings
```

Route guards for authentication when accounts are enabled.

### 5b. App.vue Decomposition

| New Component | Responsibility |
|---|---|
| `AppLayout.vue` | Shell — sidebar/nav, router-view outlet |
| `AppNavigation.vue` | Navigation rail/drawer |
| `AppDialogHost.vue` | Global dialogs |
| `LoginView.vue` | Login screen (accounts mode) |
| `App.vue` | Slim root — mounts router, provides global state |

### 5c. Large Component Decompositions

| Component | Splits Into |
|---|---|
| `VariantTable.vue` (1067) | `VariantTableToolbar`, `VariantTableHeaders`, `VariantTableRow`, `VariantTablePagination` |
| `DatabaseOverviewDialog.vue` (763) | `OverviewStatsGrid`, `OverviewCaseList`, `OverviewCharts` |
| `CaseDataInfoTab.vue` (683) | `DataInfoForm`, `ExternalIdsEditor`, `FilterSummary` |
| `CohortDataTable.vue` (646) | `CohortTableHeaders`, `CohortTableRow`, `CohortExpansion` |
| `AcmgClassificationPanel.vue` (561) | `AcmgEvidenceGrid`, `AcmgSummaryBar` |
| `CohortTable.vue` (557) | `CohortTableToolbar`, `CohortPagination` |
| `BatchImportDialog.vue` (540) | `BatchFileList`, `BatchProgressBar`, `DuplicateHandler` |

### 5d. Singleton Composable Refactor

Replace module-level state in `useFilters()` with `provide`/`inject` scoped to route views.

---

## Phase 6: Test Coverage

Priority order:

1. Encryption/password flows (key, rekey, wrong password, special characters)
2. User auth flows (login, create user, admin reset, recovery key, lockout)
3. Decomposed component tests (VariantTable children, etc.)
4. Annotation/metadata IPC handler tests
5. Export functionality tests

---

## Dependencies

| Package | Purpose | Native rebuild? |
|---|---|---|
| `kysely` | Type-safe query builder | No |
| `kysely` better-sqlite3 dialect | SQLite adapter for Kysely | No |
| `@node-rs/argon2` | Argon2id password hashing | No (NAPI prebuilt) |
| `nanoid` | Session tokens, recovery codes | No |
| `vue-router` | URL-based navigation | No |

---

## Out of Scope (v0.21.0)

- PostgreSQL adapter (Kysely enables it, but not implemented yet)
- OAuth/OIDC (cloud version)
- RBAC beyond admin/user
- Session timeout / password aging
- Formal IEC 62304 documentation (SDP, SAD, FMEA)
- Account lockout timing (schema supports it, logic deferred)
