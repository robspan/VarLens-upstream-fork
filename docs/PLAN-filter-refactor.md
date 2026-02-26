# Plan: Filter Toolbar Refactor & Annotation Filters

## UI Audit (Playwright + Code Review)

### Current State Screenshots
- `e2e/screenshots/03-case-view-full.png` — Full case view at 1920x1080
- `e2e/screenshots/07-filter-high-active.png` — HIGH impact filter active
- `e2e/screenshots/09-active-filters-1280x800.png` — Active filters at 1280x800
- `e2e/screenshots/09-active-filters-1024x768.png` — Active filters at 1024x768

### Issue 1: No way to filter by starred/tagged/commented variants

**Problem**: Users can star, tag, and comment on variants but there's no way to filter the table to show only annotated variants. This makes curation workflows impossible at scale — after reviewing 63,000+ variants and starring the interesting ones, there's no way to view only those.

**Current architecture**:
- `variant_annotations` table: global star, global_comment, acmg_classification (keyed by chr:pos:ref:alt)
- `case_variant_annotations` table: per-case star, per_case_comment, acmg_classification (keyed by case_id + variant_id)
- Both tables already have **indexed `starred` columns** (`WHERE starred = 1`)
- `VariantFilter` type (`src/main/database/types.ts:75`) supports `tag_ids` but NOT starred/commented/ACMG filters
- `FilterState` in `useFilterState.ts` has no annotation filter fields
- The query builder in `DatabaseService.ts` already JOINs annotation tables for tag filtering via subquery

**Rating: 9/10 impact, 6/10 effort** — High value feature, database layer already indexed for it.

### Issue 2: Filter bar layout problems

**Problem**: The filter groups ("squares") look messy and get cut off at different viewport widths. Specific issues observed:

1. **Clipping at narrower viewports** (1024x768 screenshot): The Frequency group is half-visible, only showing "F..." with a checkmark floating detached. The CADD, Gene, Search, Tags groups are completely invisible with no clear indication they exist.

2. **Inconsistent group sizing**: Filter groups have different widths creating uneven spacing. The Impact group (267px) vs ClinVar (148px) vs Frequency (~165px) create a ragged look.

3. **Overflow indicator is weak**: The `+N` badge on the right scroll arrow is tiny (0.6rem) and easy to miss. Users may not realize filters are hidden.

4. **`overflow-y: clip` on `.filter-groups-scroll`** clips dropdown menus that need to extend below the toolbar (v-select popups, v-autocomplete).

5. **Drag handles and collapse chevrons take excessive space**: Each group has a 16px drag handle + chevron column, adding ~20px overhead per group × 8 groups = 160px wasted.

6. **The `width: max-content` on `.filter-groups-container`** means the inner content is always 1772px wide regardless of viewport — it never adapts, it only scrolls.

7. **No responsive breakpoint**: At narrow widths, the toolbar should simplify or wrap, not just clip.

**Rating: 7/10 impact, 7/10 effort** — Usability and polish issue, requires CSS refactor + possible template changes.

---

## Plan

### Phase 1: Add Annotation Filters (Backend + State)

**Files to modify:**

#### 1.1 Extend `VariantFilter` type
**File**: `src/main/database/types.ts`
```typescript
export interface VariantFilter {
  // ... existing fields ...
  /** Filter to variants starred in this case */
  starred_only?: boolean
  /** Filter to variants with per-case or global comments */
  has_comment?: boolean
  /** Filter by ACMG classification (OR logic) */
  acmg_classifications?: string[]
}
```

#### 1.2 Add SQL filter conditions in query builder
**File**: `src/main/database/DatabaseService.ts`

In both `getVariants()` (paginated) and the count/export query, add after the `tag_ids` block:

```sql
-- starred_only: JOIN case_variant_annotations WHERE starred = 1
-- has_comment: JOIN case_variant_annotations WHERE per_case_comment IS NOT NULL
--   OR JOIN variant_annotations WHERE global_comment IS NOT NULL
-- acmg_classifications: JOIN case_variant_annotations WHERE acmg_classification IN (...)
```

Use the existing subquery pattern (same as tag_ids) for consistency:
```typescript
if (filter.starred_only) {
  conditions.push(
    `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND starred = 1)`
  )
  params.push(filter.case_id)
}

if (filter.has_comment) {
  conditions.push(
    `(id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND per_case_comment IS NOT NULL AND per_case_comment != '')
      OR (chr || ':' || pos || ':' || ref || ':' || alt) IN
        (SELECT chr || ':' || pos || ':' || ref || ':' || alt FROM variant_annotations WHERE global_comment IS NOT NULL AND global_comment != ''))`
  )
  params.push(filter.case_id)
}

if (filter.acmg_classifications?.length) {
  const placeholders = filter.acmg_classifications.map(() => '?').join(', ')
  conditions.push(
    `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND acmg_classification IN (${placeholders}))`
  )
  params.push(filter.case_id, ...filter.acmg_classifications)
}
```

#### 1.3 Extend shared types
**File**: `src/shared/types/api.ts`

Add `starred_only`, `has_comment`, `acmg_classifications` to the renderer-facing `VariantFilter` re-export if it differs from the DB type.

#### 1.4 Extend FilterState composable
**File**: `src/renderer/src/composables/useFilterState.ts`

```typescript
export interface FilterState {
  // ... existing ...
  starredOnly: boolean
  hasCommentOnly: boolean
  acmgClassifications: string[]
}
```

Update:
- `defaultFilters` — add `starredOnly: false, hasCommentOnly: false, acmgClassifications: []`
- `emitFilters()` — map to `starred_only`, `has_comment`, `acmg_classifications`
- `isFilterGroupActive('annotations')` — return true if any annotation filter active
- `activeFiltersList` — add chips for starred/commented/ACMG
- `clearFilter('starred')` etc. — reset annotation filters
- `clearAllFilters()` — include new fields
- `hasActiveFilters` — include new fields

#### 1.5 Add annotation filter group to preferences
**File**: `src/renderer/src/composables/useFilterPreferences.ts`

Add `'annotations'` to default filter group order (place it first — most used in curation workflow).

### Phase 2: Annotation Filter UI

#### 2.1 Add annotation quick-toggle icons to FilterToolbar results area
**File**: `src/renderer/src/components/FilterToolbar.vue`

Add compact icon toggles in the `.results-section` (right side), before the variant count chip. These are always visible regardless of scroll:

```vue
<!-- Annotation quick toggles — always visible -->
<v-btn-group density="compact" variant="text" divided>
  <v-btn
    size="small"
    :color="filters.starredOnly ? 'amber-darken-2' : undefined"
    :variant="filters.starredOnly ? 'flat' : 'text'"
    @click="filters.starredOnly = !filters.starredOnly"
  >
    <v-icon size="small">{{ filters.starredOnly ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
    <v-tooltip activator="parent" location="bottom">Show starred only</v-tooltip>
  </v-btn>
  <v-btn
    size="small"
    :color="filters.hasCommentOnly ? 'primary' : undefined"
    :variant="filters.hasCommentOnly ? 'flat' : 'text'"
    @click="filters.hasCommentOnly = !filters.hasCommentOnly"
  >
    <v-icon size="small">{{ filters.hasCommentOnly ? 'mdi-comment-text' : 'mdi-comment-text-outline' }}</v-icon>
    <v-tooltip activator="parent" location="bottom">Show commented only</v-tooltip>
  </v-btn>
</v-btn-group>
```

#### 2.2 Add full annotation filter group to FilterDrawer
**File**: `src/renderer/src/components/FilterDrawer.vue`

Add an "Annotations" section with:
- Starred toggle (v-switch or pill button)
- Has comments toggle
- ACMG classification chips (P, LP, VUS, LB, B) with color coding

#### 2.3 Add annotation filter group to inline toolbar
**File**: `src/renderer/src/components/FilterToolbar.vue`

New `group.id === 'annotations'` section in the draggable filter groups, with compact pill toggles for starred/commented and optional ACMG chips.

### Phase 3: Filter Toolbar Layout Refactor

#### 3.1 Fix overflow clipping
**File**: `src/renderer/src/components/FilterToolbar.vue` (styles)

```css
.filter-groups-scroll {
  overflow-x: auto;
  overflow-y: visible; /* was: clip — clips v-menu dropdowns */
}
```

#### 3.2 Normalize filter group widths
**Goal**: All filter groups should have consistent min/max widths for a tidier grid appearance.

```css
.filter-section-wrapper {
  min-width: 180px;    /* consistent minimum */
  max-width: 280px;    /* prevent any group from dominating */
}

/* Text input groups (Search, Gene) need more space */
.filter-section-wrapper:has(.search-section),
.filter-section-wrapper:has(.gene-section) {
  min-width: 200px;
}
```

#### 3.3 Reduce drag handle overhead
Replace the vertical column (drag icon + chevron) with a more compact design:
- Hide drag handles by default, show on hover of the filter group
- Move collapse chevron into the section label row (inline with "Impact", "ClinVar" etc.)
- Saves ~120px of horizontal space across all visible groups

```css
.filter-group-header {
  position: absolute;
  left: 2px;
  top: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}

.filter-section-wrapper:hover .filter-group-header {
  opacity: 1;
}
```

#### 3.4 Improve overflow indicator
Replace the tiny `+N` badge with a more visible treatment:

```vue
<!-- Right scroll arrow with prominent hidden count -->
<v-btn
  v-if="canScrollRight"
  size="small"
  variant="tonal"
  color="primary"
  class="scroll-arrow-right"
  @click="scrollRight"
>
  <v-icon>mdi-chevron-right</v-icon>
  <v-badge v-if="hiddenFilterCount > 0" :content="hiddenFilterCount" color="primary" floating />
</v-btn>
```

#### 3.5 Responsive breakpoint for narrow viewports
**File**: `src/renderer/src/components/FilterToolbar.vue`

At viewport widths < 900px (sidebar open), collapse the inline filter groups entirely and show only:
- Annotation quick-toggles (star, comment)
- Results count chip
- "All Filters" button (opens FilterDrawer)

```vue
<template v-if="isNarrowViewport">
  <!-- Compact mode: just annotation toggles + results + drawer button -->
</template>
<template v-else>
  <!-- Full horizontal filter bar -->
</template>
```

Use the existing `useResponsiveLayout` composable for breakpoint detection.

#### 3.6 Consistent visual rhythm
- Uniform 8px gap between filter groups (currently 4px looks cramped)
- Consistent border-radius (8px on all groups)
- Subtle separator lines between groups instead of background-only differentiation
- Section labels aligned to consistent baseline

### Phase 4: FilterDrawer Sync & Polish

#### 4.1 Update FilterDrawer with annotation filters
Ensure the `provide/inject` pattern in FilterToolbar (line 619-641) includes the new annotation filter state. Since `FilterDrawer` already reads from the shared composable, this should work automatically once `useFilterState` is extended.

#### 4.2 Update CohortFilterBar
**File**: `src/renderer/src/components/cohort/CohortFilterBar.vue`

Add annotation filters to cohort mode too (starred/commented make sense across cohort analysis).

#### 4.3 Active filters summary bar
Ensure the `applied-filters-bar` at the bottom shows annotation filter chips (e.g., "Starred only ✕", "Has comments ✕", "ACMG: P, LP ✕").

### Phase 5: Tests

#### 5.1 Unit tests for annotation filter SQL
**File**: `tests/database.test.ts` (or new `tests/annotation-filters.test.ts`)
- Test `starred_only` filter returns only starred variants
- Test `has_comment` filter returns variants with per-case or global comments
- Test `acmg_classifications` filter with single and multiple values
- Test combined filters (starred + HIGH impact + AF < 1%)

#### 5.2 Unit tests for FilterState composable
- Test `isFilterGroupActive('annotations')` returns correct state
- Test `clearFilter('starred')` resets only starred filter
- Test `clearAllFilters()` resets annotation filters
- Test `activeFiltersList` includes annotation chips when active

---

## File Impact Summary

| File | Changes |
|------|---------|
| `src/main/database/types.ts` | Add 3 fields to `VariantFilter` |
| `src/main/database/DatabaseService.ts` | Add annotation filter SQL (2 query methods) |
| `src/shared/types/api.ts` | Extend shared filter types |
| `src/renderer/src/composables/useFilterState.ts` | Extend FilterState, defaults, emit, clear, active tracking |
| `src/renderer/src/composables/useFilterPreferences.ts` | Add 'annotations' group to defaults |
| `src/renderer/src/components/FilterToolbar.vue` | Annotation toggles in results area + new filter group + CSS refactor |
| `src/renderer/src/components/FilterDrawer.vue` | Annotation filter section |
| `src/renderer/src/components/cohort/CohortFilterBar.vue` | Annotation toggles |
| `src/renderer/src/styles/_filter-common.scss` | Shared filter style updates |
| `tests/` | New annotation filter tests |

## Execution Order

1. **Phase 1** (backend) — no UI changes, independently testable
2. **Phase 2** (annotation UI) — depends on Phase 1, high user value
3. **Phase 3** (layout refactor) — independent of Phases 1-2, purely CSS/template
4. **Phase 4** (sync & polish) — final integration
5. **Phase 5** (tests) — can start in parallel with Phase 2

Estimated scope: ~15 files modified, ~400 lines added, ~100 lines modified.
