# Unified Annotation Scope Control

**Date:** 2026-03-12
**Status:** Approved
**Branch:** TBD (feature/annotation-scope-unification)

## Problem

In Case View, annotation filters (starred, ACMG, comment) only query **per-case** annotations for starred and ACMG (comment already checks both). Users cannot filter for globally starred or globally classified variants. Additionally, annotation actions (star/ACMG/comment clicks in table rows) always target per-case annotations with no way to set global annotations from Case View.

The annotation dialog components (`VariantAnnotationDialogs.vue` and `CohortAnnotationDialogs.vue`) are nearly identical but duplicated, differing only in whether they call per-case or global methods.

## Solution

A single **"Case / All" segmented button** in the Case View FilterToolbar that controls both:

1. **Filter scope** — whether star/comment/ACMG filters match per-case only or per-case OR global
2. **Action scope** — whether star/ACMG/comment clicks in table rows set per-case or global annotations

In Cohort View, this control is hidden since everything is naturally global. The annotation dialog components are unified into a single shared component.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope options | "Case" / "All" (two-way) | Simpler than three-way; "All" means per-case OR global for filters, global for actions |
| Scope granularity | One shared toggle for all three filters | Star/ACMG/comment are typically reviewed together in clinical workflows |
| Action scope control | Same toolbar toggle controls actions | One mental model — the toggle governs the entire annotation layer |
| UI control type | Segmented button (v-btn-toggle) | Standard Material pattern for binary mode switches, always visible |
| Placement | Before star/comment/ACMG filter buttons | Groups logically with annotation controls |
| Default | "Case" on Case View load | Preserves current behavior, no surprise for existing users |
| Toggle label | "All" not "Global" | Avoids confusion: filters show union (case + global), actions target global. "All" accurately describes the filter behavior. |

### Scope Semantics

The "All" mode has intentionally different semantics for filters vs. actions:

| Aspect | Case mode | All mode |
|--------|-----------|----------|
| **Filter behavior** | Matches per-case annotations only | Matches per-case OR global annotations (union) |
| **Action behavior** | Clicks set per-case annotations | Clicks set global annotations |
| **Display** | Per-case state as primary icon, global as ring indicator | Global state as primary icon, per-case as ring indicator (swapped) |

This is consistent because "All" broadens the view to include everything, and when acting in that broadened context, the natural target is the global (shared) annotation.

## Architecture

### Data Flow

```
FilterToolbar (annotationScope: 'case' | 'all')
  ├── AnnotationScopeToggle.vue (UI control)
  ├── Star/Comment/ACMG filter buttons (query scope depends on toggle)
  └── emits annotationScope via useFilterState to parent (CaseView)
        └── VariantTable
              └── AnnotationsCell (display + action scope depends on toggle)
                    └── AnnotationDialogs (unified, scope-aware)
```

### Component Inventory

#### New Components

**`src/renderer/src/components/AnnotationScopeToggle.vue`** — shared segmented button component.

- `v-btn-toggle` with mandatory selection, two buttons:
  - "Case" with `mdi-briefcase-outline` icon
  - "All" with `mdi-earth` icon
- Props: `modelValue: 'case' | 'all'`
- Emits: `update:modelValue`
- Compact density, small size, placed inline in toolbar
- Tooltips:
  - Case: "Case mode: filter and annotate for this case only"
  - All: "All mode: filter includes global annotations, actions target global"

#### Modified Components

**`FilterToolbar.vue`**
- Add `AnnotationScopeToggle` before star filter button
- Add `annotationScope` to filter state via `useFilterState`
- Update hint text: when scope is "all" and no results, show "No variants match. This includes global annotations from other cases."

**`CohortFilterBar.vue`**
- No scope toggle (always global)
- No structural changes, but benefits from shared annotation dialogs refactor

**`AnnotationsCell.vue`**
- New prop: `annotationScope: 'case' | 'all'` (default `'case'`)
- **No new events** — keeps existing `star-toggle`, `acmg-select`, `comment-click` events
- The parent component (`AnnotationDialogs` / `VariantTable`) routes to the correct `useAnnotations` method based on scope. The cell does not need to know about scope routing — it just emits intent.
- **Display swap in "All" mode**: when `annotationScope === 'all'`, swap primary/secondary display:
  - Star: global starred state as primary icon, per-case as ring indicator
  - ACMG: global classification as primary chip, per-case as ring indicator
  - Comment: global comment as primary icon, per-case as ring indicator

**`VariantAnnotationDialogs.vue` → `src/renderer/src/components/AnnotationDialogs.vue` (moved + unified)**
- New prop: `scope: 'case' | 'all'`
- New optional prop: `caseId: number | null` (null in cohort mode)
- Variant type: accepts `Variant | CohortVariant` via a minimal `AnnotationTarget` interface (`chr`, `pos`, `ref`, `alt`, optional `id`, `gene_symbol`)
- `variantId` required only when `scope === 'case'`; optional/ignored when `scope === 'all'` or in cohort mode
- When `scope === 'case'`: calls `toggleStar()`, `setAcmgClassification()`, `upsertPerCaseComment()` (requires caseId + variantId)
- When `scope === 'all'`: calls `toggleGlobalStar()`, `setGlobalAcmgClassification()`, `upsertGlobalComment()`
- CommentDialog: shows both tabs when `scope === 'case'` and caseId is set; shows global tab only when `scope === 'all'` or caseId is null

**`CohortAnnotationDialogs.vue`** — deleted, replaced by unified `AnnotationDialogs.vue` with `scope="all"`.
- **Export logic**: the `exportToExcel` function and `exporting` ref currently in `CohortAnnotationDialogs.vue` must be extracted to `CohortTable.vue` (the parent) before deletion, since export is unrelated to annotations.

**`VariantTable.vue`**
- Accepts `annotationScope` prop, passes to `AnnotationsCell` and `AnnotationDialogs`

**`CaseView.vue`**
- Receives `annotationScope` from `FilterToolbar`, passes to `VariantTable`

**`CohortTable.vue`**
- Uses unified `AnnotationDialogs` with `scope="all"` and `caseId="null"`
- Absorbs export logic from deleted `CohortAnnotationDialogs`

**`useAnnotationDialogs.ts`** (composable)
- Accept `scope: Ref<AnnotationScope>` parameter
- `AnnotationFunctions` interface extended with global methods: `toggleGlobalStar`, `setGlobalAcmgClassification`, `upsertGlobalComment`
- Internal logic branches on scope to call per-case vs global methods from `useAnnotations`

**`useFilterState.ts`** (composable)
- Add `annotationScope` to filter state
- Include `annotation_scope` in the `VariantFilter` object emitted via `onFiltersUpdate` callback

### Type Changes

**`VariantFilter` (`src/main/database/types.ts` — canonical definition)**
- Add field: `annotation_scope?: 'case' | 'all'`
- Default: `'case'` (backward compatible)

**New type: `AnnotationScope`**
- `type AnnotationScope = 'case' | 'all'`
- Defined in `src/shared/types/annotations.ts` for use across main and renderer

**New interface: `AnnotationTarget`**
- Minimal interface shared between `Variant` and `CohortVariant`:
  ```typescript
  interface AnnotationTarget {
    chr: string
    pos: number
    ref: string
    alt: string
    id?: number        // present in Variant, absent in CohortVariant
    gene_symbol?: string | null
  }
  ```
- Defined in `src/shared/types/annotations.ts`

### SQL Filter Changes

**`VariantRepository.ts` — `buildFilterConditions()`**

When `annotation_scope === 'case'` (current behavior, no changes):

```sql
-- Starred
id IN (SELECT variant_id FROM case_variant_annotations
       WHERE case_id = ? AND starred = 1)

-- ACMG
id IN (SELECT variant_id FROM case_variant_annotations
       WHERE case_id = ? AND acmg_classification IN (?...))

-- Comment (already checks both — no change in either mode)
(id IN (SELECT variant_id FROM case_variant_annotations
        WHERE case_id = ? AND per_case_comment IS NOT NULL AND per_case_comment != '')
 OR EXISTS (SELECT 1 FROM variant_annotations va
            WHERE va.chr = variants.chr AND va.pos = variants.pos
            AND va.ref = variants.ref AND va.alt = variants.alt
            AND va.global_comment IS NOT NULL AND va.global_comment != ''))
```

When `annotation_scope === 'all'` (new — union semantics):

```sql
-- Starred: per-case OR global
(id IN (SELECT variant_id FROM case_variant_annotations
        WHERE case_id = ? AND starred = 1)
 OR EXISTS (SELECT 1 FROM variant_annotations va
            WHERE va.chr = variants.chr AND va.pos = variants.pos
            AND va.ref = variants.ref AND va.alt = variants.alt
            AND va.starred = 1))

-- ACMG: per-case OR global
(id IN (SELECT variant_id FROM case_variant_annotations
        WHERE case_id = ? AND acmg_classification IN (?...))
 OR EXISTS (SELECT 1 FROM variant_annotations va
            WHERE va.chr = variants.chr AND va.pos = variants.pos
            AND va.ref = variants.ref AND va.alt = variants.alt
            AND va.acmg_classification IN (?...)))

-- Comment: no change (already checks both)
```

### Database Index Requirement

The global-scope SQL queries use `EXISTS` with a 4-column match on `variant_annotations(chr, pos, ref, alt)`. An index is required for performance:

```sql
CREATE INDEX IF NOT EXISTS idx_variant_annotations_coords
ON variant_annotations(chr, pos, ref, alt);
```

**Status:** This index already exists — created in migration v2 when annotation tables were introduced. No new migration needed.

### Cohort View SQL

No changes — cohort queries already use global-only `variant_annotations` table via EXISTS.

## DRY Refactoring Summary

| Before | After |
|--------|-------|
| `VariantAnnotationDialogs.vue` (case-specific) | `AnnotationDialogs.vue` (unified, scope-aware, at `src/renderer/src/components/`) |
| `CohortAnnotationDialogs.vue` (global-specific) | Deleted — cohort uses `AnnotationDialogs` with `scope="all"` |
| `useAnnotationDialogs.ts` (per-case only) | Extended to accept scope, branches internally |
| Duplicated star/ACMG/comment handler logic | Single set of handlers that branch on `scope` prop |
| Export logic in CohortAnnotationDialogs | Moved to `CohortTable.vue` |

## Behavioral Details

- Default scope on Case View load: **"Case"** (preserves current UX)
- Scope persists during session but resets on case switch
- When scope changes with active annotation filters, filters re-query automatically
- Scope toggle is not rendered in Cohort View (always global)
- `AnnotationsCell` visual behavior:
  - Case mode: per-case state as primary icon, global as ring indicator (current behavior)
  - All mode: global state as primary icon, per-case as ring indicator (swapped)
- CommentDialog tab behavior:
  - Case mode with caseId: shows both "Global" and "This Case" tabs
  - All mode (or no caseId): shows "Global" tab only
- Hint bar text:
  - Case mode: "No variants match the annotation filter. Star or comment on variants first, then filter."
  - All mode: "No variants match the annotation filter. This includes global annotations from other cases."

## Testing Strategy

- Unit tests for `buildFilterConditions` with both scope values
- Unit tests for unified `AnnotationDialogs` with both scope values
- Unit tests for `useAnnotationDialogs` scope branching
- E2E: toggle scope, star a variant, verify correct table updated (per-case vs global)
- E2E: toggle scope, apply star filter, verify correct variants shown
- E2E: verify display swap (primary/ring indicator) when toggling scope
- Regression: cohort view unchanged behavior
- Regression: case view default "Case" mode matches pre-change behavior

## Files Changed

### New
- `src/renderer/src/components/AnnotationScopeToggle.vue`
- `src/shared/types/annotations.ts` (AnnotationScope type, AnnotationTarget interface)

### Modified
- `src/renderer/src/components/FilterToolbar.vue` — add scope toggle, pass scope in filters
- `src/renderer/src/components/table-cells/AnnotationsCell.vue` — scope prop, display swap logic
- `src/renderer/src/components/VariantTable.vue` — pass scope
- `src/renderer/src/views/CaseView.vue` — pass scope
- `src/renderer/src/components/CohortTable.vue` — use unified dialogs, absorb export logic
- `src/renderer/src/composables/useAnnotationDialogs.ts` — accept scope, branch per-case vs global
- `src/renderer/src/composables/useFilterState.ts` — add annotationScope to filter state
- `src/main/database/VariantRepository.ts` — scope-aware filter conditions
- `src/main/database/types.ts` — add annotation_scope to VariantFilter

### Moved + Unified
- `src/renderer/src/components/variant-table/VariantAnnotationDialogs.vue` → `src/renderer/src/components/AnnotationDialogs.vue` (unified, scope-aware)

### Deleted
- `src/renderer/src/components/cohort/CohortAnnotationDialogs.vue` — replaced by unified component
