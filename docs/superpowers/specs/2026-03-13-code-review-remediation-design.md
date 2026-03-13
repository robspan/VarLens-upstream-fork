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

#### Filter Conditions (24 total, 3 tiers)

**Simple (7) — direct `.where()` / `.$if()`:**
- `case_id` (equality, required)
- `gene_symbol` (LIKE substring)
- `consequence` (single equality)
- `chr`, `pos`, `ref`, `alt` (equality)

**Array/Range (5) — `.where('col', 'in', arr)` + null-aware range:**
- `consequences` (IN array)
- `funcs` (IN array)
- `clinvars` (IN array)
- `gnomad_af_max` (range with NULL: `gnomad_af IS NULL OR gnomad_af <= ?`)
- `cadd_min` (range with NULL: `cadd IS NULL OR cadd >= ?`)

**Complex (12) — expression builder with `exists()`, `or()`, subqueries:**
- `tag_ids` — `id IN (SELECT variant_id FROM variant_tags WHERE ...)`
- `starred_only` (case scope) — subquery on `case_variant_annotations`
- `starred_only` (all scope) — OR of subquery + EXISTS on `variant_annotations`
- `has_comment` (case scope) — subquery on `case_variant_annotations`
- `has_comment` (all scope) — OR of subquery + EXISTS on `variant_annotations`
- `acmg_classifications` (case scope) — subquery with IN
- `acmg_classifications` (all scope) — OR of subquery + EXISTS with IN
- `column_filters` (4 dynamic) — LIKE with CAST for numerics
- `search_query` — FTS5 MATCH via `sql` template tag (no native Kysely support)

#### Implementation Pattern

```typescript
private buildVariantQuery(filter: VariantFilter) {
  return this.kysely
    .selectFrom('variants')
    .selectAll()
    .where('case_id', '=', filter.case_id)
    // Simple filters via $if
    .$if(!!filter.gene_symbol, (qb) =>
      qb.where('gene_symbol', 'like', `%${filter.gene_symbol}%`))
    .$if(!!filter.consequences?.length, (qb) =>
      qb.where('consequence', 'in', filter.consequences!))
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
}
```

#### Sort Clause Migration

Replace `buildSortClause()` string concatenation with `.orderBy()` using existing `SORTABLE_COLUMNS` whitelist:

```typescript
private applySort(query, sortBy?: SortItem[]) {
  if (!sortBy?.length) return query.orderBy('pos asc').orderBy('id asc')
  for (const sort of sortBy) {
    const col = SORTABLE_COLUMNS[sort.key]
    if (!col) continue
    query = query.orderBy(col, sort.order === 'desc' ? 'desc' : 'asc')
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

- Main thread sends filter params + file path to export worker
- Worker queries database (via its own connection) + builds XLSX incrementally
- Progress reporting via worker `postMessage` (row count / total)
- Main thread forwards progress to renderer via IPC
- On completion, worker returns the output file path

#### Error Handling

- Worker catches errors and posts error message back to main thread
- Main thread serializes error for renderer via existing `wrapHandler()` pattern
- If row count exceeds 100k, return an error before starting export

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

#### Migration Strategy

1. Extract `useFilterPresets` first (most independent)
2. Extract `useFilterExport` second
3. Update consumers (CaseView, VariantTable area)
4. Verify all existing tests still pass

---

## Phase 2: Remaining Fixes

### 2.1 — M-06: Fix `as any` Casts in Renderer

- Audit `WindowAPI` type in `src/shared/types/api.ts` against actual preload API shape
- Add missing method signatures
- Remove all ~10 `as any` casts on `window.api` in renderer composables/components

### 2.2 — M-08: JSDoc on Singleton Composables

- Add `@singleton` JSDoc warnings to composables using module-scoped `ref()`:
  - `useAnnotations`, `useCarriers`, `useTags`
- Document: shared-state behavior, cache clearing expectations, case-switch cleanup

### 2.3 — M-09: Stronger IPC Parameter Typing

- Create dedicated Zod schemas for IPC calls currently typed as `unknown` in `src/preload/index.ts` (lines 143, 332, 383)
- Use `z.infer<>` to generate TypeScript types
- Extends existing Zod validation pattern used elsewhere

### 2.4 — L-02: Clean Up Silent Catch Blocks

- Replace empty `.catch(() => {})` with either:
  - Named function: `const silentIgnore = () => {}` with JSDoc explaining intent
  - Or inline comment explaining why error is intentionally discarded
- Targets: `authStore.ts:46`, `import-worker-client.ts:101`

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

- All 553+ existing tests continue to pass
- New filter tests cover all 24 conditions (TDD for H-01)
- No `as any` casts remain on `window.api`
- Export handles 100k+ variant cases without UI freeze
- `useFilterState.ts` is under 500 lines
- `EXPLAIN QUERY PLAN` confirms equivalent query performance after Kysely migration
