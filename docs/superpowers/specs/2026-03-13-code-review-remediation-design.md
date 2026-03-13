# Code Review Remediation — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Address all remaining findings from the July 2025 code review report

---

## Context

A full codebase code review (July 2025) identified 20 findings across security, performance, and maintainability. As of March 2026, 6 have been resolved (H-04, M-01, M-02, M-04, M-07, L-01). This spec covers the remaining 10 findings, organized into two phases by impact.

### Findings Status Summary

| Finding | Description | Status |
|---------|-------------|--------|
| H-01 | SQL string concatenation in VariantRepository | **Open — Phase 1** |
| H-02 | Missing database indexes | Partially fixed |
| H-03 | Unbounded export blocks main thread | **Open — Phase 1** |
| H-04 | N+1 annotation loading | Fixed |
| H-05 | Oversized useFilterState.ts (878 lines) | **Open — Phase 1** |
| M-01 | File path validation | Fixed |
| M-02 | Unbounded annotation cache | Fixed |
| M-03 | Complex subqueries without indexes | Mitigated by H-02 |
| M-04 | Filter options not cached | Fixed |
| M-05 | Unsafe casts in ZipExtractor | Documented workaround (library limitation) |
| M-06 | `as any` casts in renderer | **Open — Phase 2** |
| M-07 | `ref<Map>` mutations | Not a problem (design is correct) |
| M-08 | Singleton composables lack docs | **Open — Phase 2** |
| M-09 | IPC parameters typed as `unknown` | **Open — Phase 2** |
| L-01 | Duplicated variant key generation | Consolidated |
| L-02 | Silent error swallowing | **Open — Phase 2** |
| L-03 | Large Vue components | **Open — Phase 2** |
| L-04 | Missing test coverage for useFilterState | **Open — Phase 1 (via TDD)** |
| L-05 | JSON.parse(JSON.stringify) for reactivity stripping | Intentional |
| L-06 | Missing module-level docs on shared types | **Open — Phase 2** |

---

## Phase 1: High-Impact Items

### 1.1 — H-01: Migrate VariantRepository Complex Queries to Kysely

**Problem:** `VariantRepository.ts` builds WHERE and ORDER BY clauses via string concatenation across ~150 lines in `buildFilterConditions()`. While values are parameterized, the clause structure is string-built — an anti-pattern that risks regression.

**Background:** Kysely was introduced in commit `c49ce7d` (March 10, 2026). The design doc planned a full migration but the implementer pragmatically kept complex dynamic SQL as raw strings. The infrastructure (BaseRepository with `execAll`/`execFirst`/`execRun`, full type definitions for all 23 tables) is already in place.

**Approach:** Kysely expression builder with `$if` chaining.

**Testing strategy:** TDD — write comprehensive filter tests before migrating (also addresses L-04). Capture expected query results for filter combinations, then refactor with confidence.

#### Filter Conditions (~17 distinct parameters, 3 tiers)

Note: `consequence` (single) and `consequences` (array) are mutually exclusive — the Kysely migration must preserve this `else if` logic.

**Simple (7) — direct `.where()` / `.$if()`:**
- `case_id` (equality, required)
- `gene_symbol` (LIKE substring)
- `consequence` / `consequences` (single equality OR IN array — mutually exclusive)
- `chr`, `pos`, `ref`, `alt` (equality)

**Array/Range (4) — `.where('col', 'in', arr)` + null-aware range:**
- `funcs` (IN array)
- `clinvars` (IN array)
- `gnomad_af_max` (range with NULL: `gnomad_af IS NULL OR gnomad_af <= ?`)
- `cadd_min` (range with NULL: `cadd IS NULL OR cadd >= ?`)

**Complex (6 parameters, some with two scope-dependent SQL paths) — expression builder with `exists()`, `or()`, subqueries:**
- `tag_ids` — `id IN (SELECT variant_id FROM variant_tags WHERE ...)`
- `starred_only` — case scope: subquery only; all scope: OR of subquery + EXISTS on `variant_annotations`
- `has_comment` — case scope: subquery only; all scope: OR of subquery + EXISTS on `variant_annotations`
- `acmg_classifications` — case scope: subquery with IN; all scope: OR of subquery + EXISTS with IN
- `column_filters` (dynamic, up to N columns) — LIKE with CAST for numerics
- `search_query` — FTS5 MATCH via `sql` template tag (no native Kysely support)

#### Implementation Pattern

Note: Kysely's `.where()` parameterizes value arguments — the template literal in `like` patterns (e.g., `` `%${filter.gene_symbol}%` ``) is parameterized by Kysely in the compiled SQL, NOT interpolated into the SQL string.

```typescript
private buildVariantQuery(filter: VariantFilter) {
  let query = this.kysely
    .selectFrom('variants')
    .selectAll()
    .where('case_id', '=', filter.case_id)
    // Simple filters via $if
    .$if(!!filter.gene_symbol, (qb) =>
      qb.where('gene_symbol', 'like', `%${filter.gene_symbol}%`))
    // consequence vs consequences — mutually exclusive
    .$if(!!filter.consequences?.length, (qb) =>
      qb.where('consequence', 'in', filter.consequences!))
    .$if(!filter.consequences?.length && !!filter.consequence, (qb) =>
      qb.where('consequence', '=', filter.consequence!))
    // Range filters with NULL handling
    .$if(filter.gnomad_af_max != null, (qb) =>
      qb.where(({ or, eb }) => or([
        eb('gnomad_af', 'is', null),
        eb('gnomad_af', '<=', filter.gnomad_af_max!)
      ])))
    // Complex: EXISTS subqueries
    .$if(!!filter.starred_only, (qb) =>
      qb.where(({ exists, selectFrom, or }) => ...))
    // FTS5: sql template tag (no native MATCH support)
    .$if(!!filter.search_query, (qb) =>
      qb.where('id', 'in', sql`SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${ftsQuery}`))

  return query
}
```

#### Sort Clause Migration

Replace `buildSortClause()` string concatenation with `.orderBy()` using existing `SORTABLE_COLUMNS` whitelist.

**Limitation:** Kysely v0.28.x does not natively support `NULLS FIRST` / `NULLS LAST` in its `.orderBy()` API. The current code uses `NULLS FIRST` for DESC and `NULLS LAST` for ASC. Use `sql` template literals for sort clauses to preserve this behavior:

```typescript
import { sql } from 'kysely'

private applySort(query, sortBy?: SortItem[]) {
  if (!sortBy?.length) {
    return query
      .orderBy(sql`pos ASC NULLS LAST`)
      .orderBy(sql`id ASC`)
  }
  for (const sort of sortBy) {
    const col = SORTABLE_COLUMNS[sort.key]
    if (!col) continue
    const dir = sort.order === 'desc' ? 'DESC' : 'ASC'
    const nulls = sort.order === 'desc' ? 'NULLS FIRST' : 'NULLS LAST'
    query = query.orderBy(sql`${sql.ref(col)} ${sql.raw(dir)} ${sql.raw(nulls)}`)
  }
  if (!sortBy.some(s => s.key === 'id')) {
    query = query.orderBy(sql`id ASC`)
  }
  return query
}
```

#### Shared Builder

`getVariants()` and `getAllVariantsForExport()` both call `buildVariantQuery()`:

- `getVariants()` adds `.limit()`, `.offset()`, sort, and runs a separate count query
- `getAllVariantsForExport()` adds `.orderBy('chr').orderBy('pos')`, no limit

#### What Stays as Raw SQL

- `searchVariants()` — FTS5-heavy with `MATCH` and `bm25()`, stays as `sql` template
- `buildSearchCondition()` — FTS token parsing, stays as `sql` template within `buildVariantQuery()`

#### Verification

Run `EXPLAIN QUERY PLAN` on migrated queries to confirm equivalent query plans.

---

### 1.2 — H-03: Export to Worker Thread + Hard Limit

**Problem:** Variant export loads ALL matching rows into memory and generates XLSX synchronously on the main thread. For 50k+ variants this freezes the UI.

**Approach:** Two changes:

1. **Hard limit (100k rows)** on `getAllVariantsForExport()`, matching the cohort export pattern already in place
2. **Worker thread** for XLSX generation, following the existing worker pattern in `src/main/workers/`

#### Worker Design

Follow the existing import worker pattern (`src/main/workers/import-worker-client.ts`):

1. **Main thread (pre-worker):** Show save dialog via `dialog.showSaveDialog()` to get output file path. Run a count query to check if results exceed 100k — if so, return an error before spawning the worker.
2. **Main thread → worker:** Send `{ dbPath, encryptionKey, filterParams, outputFilePath }` as start message (same pattern as import worker which receives `dbPath` and `encryptionKey`).
3. **Worker:** Opens its own `better-sqlite3-multiple-ciphers` connection with the provided credentials. Queries variants + builds XLSX incrementally. SQLite WAL mode supports concurrent reads, so the worker's read-only connection is safe alongside the main thread's connection.
4. **Worker → main thread:** Progress reporting via `postMessage` (row count / total).
5. **Main thread → renderer:** Forwards progress via IPC.
6. **On completion:** Worker closes its DB connection and returns the output file path.

#### Error Handling

- Worker catches errors and posts error message back to main thread
- Main thread serializes error for renderer via existing `wrapHandler()` pattern
- Row count check happens on main thread BEFORE worker spawn (avoids loading 100k+ rows only to discard them)

---

### 1.3 — H-05: Split useFilterState.ts

**Problem:** 878-line composable handling filter state, presets, gene autocomplete, and export — violates Single Responsibility Principle.

**Split into three composables:**

| Composable | Responsibility | ~Lines |
|------------|---------------|--------|
| `useFilterState` | Core filter state, mutations, reset, gene autocomplete | ~400 |
| `useFilterPresets` | Preset CRUD: save, load, apply, delete | ~200 |
| `useFilterExport` | Export triggering and format logic | ~150 |

#### Dependencies

```
useFilterState (core)
  ├── useFilterPresets (imports filter state to apply presets)
  └── useFilterExport (imports filter state to build export params)
```

#### Shared Types

The file's top ~120 lines contain type definitions (`FilterState`, `ActiveFilter`, `UseFilterStateOptions`, `ExportResult`, `UseFilterStateReturn`) that will be needed by all three composables. Extract these to a `filter-types.ts` file in the same directory.

#### DRY Opportunity

Lines ~494-554 (`emitFilters`) and ~709-759 (`exportToExcel`) contain nearly identical filter-building logic. The `useFilterExport` extraction should deduplicate this.

#### Migration Strategy

1. Extract shared types to `filter-types.ts`
2. Extract `useFilterPresets` first (most independent)
3. Extract `useFilterExport` second (deduplicate filter-building logic)
4. Update consumers (CaseView, VariantTable area)
5. Verify all existing tests still pass

---

## Phase 2: Remaining Fixes

### 2.1 — M-06: Fix `as any` Casts in Renderer

- Audit `WindowAPI` type in `src/shared/types/api.ts` against actual preload API shape
- Add missing method signatures
- Remove all ~20 `as any` casts on `window.api` across renderer (found in `useFilterState.ts`, `CohortTable.vue`, `useVariantData.ts`, `useCohortData.ts`, `useCarriers.ts`, `GeneBurdenTable.vue`, `RegionFileImportDialog.vue`, `GeneListEditorDialog.vue`)
- Root cause: `WindowAPI` type is missing namespaces for newer features (`regionFiles`, `geneLists`, etc.)

### 2.2 — M-08: JSDoc on Singleton Composables

- Add `@singleton` JSDoc warnings to composables using module-scoped `ref()`:
  - `useAnnotations`, `useCarriers`, `useTags`
- Document: shared-state behavior, cache clearing expectations, case-switch cleanup

### 2.3 — M-09: Stronger IPC Parameter Typing

- Two distinct problems in `src/preload/index.ts`:
  - `unknown` params (e.g., line 143 `runAssociation: (config: unknown)`) — need full Zod schemas
  - `Record<string, unknown>` params (e.g., lines 332, 383) — already provide some structure but should be tightened to specific typed interfaces
- Use `z.infer<>` to generate TypeScript types from Zod schemas
- Extends existing Zod validation pattern used elsewhere

### 2.4 — L-02: Clean Up Silent Catch Blocks

- Replace empty `.catch(() => {})` with either:
  - Named function: `const silentIgnore = () => {}` with JSDoc explaining intent
  - Or inline comment explaining why error is intentionally discarded
- Targets: `authStore.ts:46`, `import-worker-client.ts:101`, `DatabaseService.ts:229`

### 2.5 — L-03: Split Large Vue Components

- Extract sub-components from:
  - `CohortDataTable.vue` (557 lines) — column definitions, row handlers
  - `VariantTable.vue` (553 lines) — column config, toolbar, dialogs
  - `CaseList.vue` (482 lines) — list item rendering, action dialogs
  - `BatchImportDialog.vue` (458 lines) — step content sections
  - `VariantDetailsPanel.vue` (461 lines) — panel sections
- Skip `DnaIcon.vue` (589 lines) — it's SVG path data, splitting doesn't help

### 2.6 — L-06: Module-Level JSDoc on Shared Types

- Add module-level JSDoc to type barrel files in `src/shared/types/`
- Document type hierarchy, cross-references, and which process each type is used in

---

## Success Criteria

### Phase 1
- All 553+ existing tests continue to pass
- New filter tests cover all ~17 filter parameters including scope-dependent paths (TDD for H-01)
- `EXPLAIN QUERY PLAN` confirms equivalent query performance after Kysely migration
- Export handles 100k+ variant cases without UI freeze
- `useFilterState.ts` is under 500 lines after split

### Phase 2
- Zero `as any` casts remain on `window.api` (~20 instances removed)
- All `Record<string, unknown>` IPC params in preload replaced with typed Zod schemas
- All singleton composables have `@singleton` JSDoc warnings
- All silent catch blocks have explanatory comments or named ignore functions
- No single-file Vue component exceeds 400 lines (excluding `DnaIcon.vue`)
- All type barrel files in `src/shared/types/` have module-level JSDoc
