# Annotation Scope Unification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Case / All" scope toggle to Case View that controls whether annotation actions and filters target per-case or global annotations, and unify the duplicated annotation dialog components.

**Architecture:** A single `AnnotationScope` type ('case' | 'all') flows from a toolbar toggle through the filter state composable to the SQL query builder (for filters) and through the component prop chain to annotation cells and dialogs (for actions). The two nearly-identical annotation dialog components are unified into one scope-aware component.

**Tech Stack:** Vue 3, Vuetify 3, TypeScript, SQLite (better-sqlite3), Pinia, electron-vite

**Spec:** `.planning/specs/2026-03-12-annotation-scope-unification-design.md`

---

## Chunk 1: Types, SQL, and Filter State (Backend + State Layer)

### Task 1: Create shared AnnotationScope type

**Files:**
- Create: `src/shared/types/annotations.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/shared/types/annotations.ts

/**
 * Annotation scope for Case View toggle.
 * - 'case': per-case annotations only (default)
 * - 'all': per-case OR global annotations (union for filters, global for actions)
 */
export type AnnotationScope = 'case' | 'all'

/**
 * Minimal variant identity shared between Variant and CohortVariant.
 * Used by unified AnnotationDialogs to avoid coupling to either full type.
 */
export interface AnnotationTarget {
  chr: string
  pos: number
  ref: string
  alt: string
  /** Present in Variant (case view), absent in CohortVariant (cohort view) */
  id?: number
  gene_symbol?: string | null
  /** Optional fields for ACMG evidence dialog display */
  cdna?: string | null
  aa_change?: string | null
  gnomad_af?: number | null
  /** CADD score — named `cadd` in Variant, `cadd_phred` in CohortVariant */
  cadd?: number | null
  cadd_phred?: number | null
  clinvar?: string | null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types/annotations.ts
git commit -m "feat: add AnnotationScope type and AnnotationTarget interface"
```

---

### Task 2: Add annotation_scope to VariantFilter type

**Files:**
- Modify: `src/main/database/types.ts:75-112`

- [ ] **Step 1: Add the field to VariantFilter**

In `src/main/database/types.ts`, add after line 111 (`column_filters?: Record<string, string>`):

```typescript
  /** Annotation scope for star/ACMG filters: 'case' = per-case only, 'all' = per-case OR global */
  annotation_scope?: 'case' | 'all'
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/main/database/types.ts
git commit -m "feat: add annotation_scope field to VariantFilter"
```

---

### Task 3: Update SQL filter builder for scope-aware queries

**Files:**
- Modify: `src/main/database/VariantRepository.ts:235-261`

- [ ] **Step 1: Update starred_only filter condition**

Replace the starred_only block (lines 235-240) with:

```typescript
    if (filter.starred_only === true) {
      if (filter.annotation_scope === 'all') {
        conditions.push(
          `(id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND starred = 1)
            OR EXISTS (
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = variants.chr AND va.pos = variants.pos
                AND va.ref = variants.ref AND va.alt = variants.alt
                AND va.starred = 1
            ))`
        )
      } else {
        conditions.push(
          `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND starred = 1)`
        )
      }
      params.push(filter.case_id)
    }
```

- [ ] **Step 2: Update acmg_classifications filter condition**

Replace the acmg_classifications block (lines 255-261) with:

```typescript
    if (filter.acmg_classifications !== undefined && filter.acmg_classifications.length > 0) {
      const placeholders = filter.acmg_classifications.map(() => '?').join(', ')
      if (filter.annotation_scope === 'all') {
        conditions.push(
          `(id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND acmg_classification IN (${placeholders}))
            OR EXISTS (
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = variants.chr AND va.pos = variants.pos
                AND va.ref = variants.ref AND va.alt = variants.alt
                AND va.acmg_classification IN (${placeholders})
            ))`
        )
        params.push(filter.case_id, ...filter.acmg_classifications, ...filter.acmg_classifications)
      } else {
        conditions.push(
          `id IN (SELECT variant_id FROM case_variant_annotations WHERE case_id = ? AND acmg_classification IN (${placeholders}))`
        )
        params.push(filter.case_id, ...filter.acmg_classifications)
      }
    }
```

Note: `has_comment` already checks both per-case and global — no change needed regardless of scope.

- [ ] **Step 3: Verify typecheck passes**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "feat: scope-aware starred and ACMG SQL filters"
```

---

### Task 4: Add annotationScope to FilterState and emitFilters

**Files:**
- Modify: `src/renderer/src/composables/useFilterState.ts:37-49` (FilterState interface)
- Modify: `src/renderer/src/composables/useFilterState.ts:485-541` (emitFilters function)

- [ ] **Step 1: Add annotationScope to FilterState interface**

In `src/renderer/src/composables/useFilterState.ts`, add to the `FilterState` interface (after line 48, `acmgClassifications: string[]`):

```typescript
  annotationScope: 'case' | 'all'
```

- [ ] **Step 2: Set default in initial state**

Find the initial state assignment (search for `starredOnly: false`). Add after `acmgClassifications: []`:

```typescript
    annotationScope: 'case' as const,
```

- [ ] **Step 3: Include annotation_scope in emitFilters**

In the `emitFilters` function, add after the `acmg_classifications` block (around line 538):

```typescript
    // Annotation scope
    if (filters.value.annotationScope === 'all') {
      variantFilter.annotation_scope = 'all'
    }
```

- [ ] **Step 4: Add annotationScope to clearAllFilters and resetForCaseSwitch**

Find `clearAllFilters` function. Add reset for annotationScope alongside other resets:

```typescript
    filters.value.annotationScope = 'case'
```

Also find `resetForCaseSwitch` function (around line 611). Add scope reset there too (spec says scope resets on case switch):

```typescript
    filters.value.annotationScope = 'case'
```

- [ ] **Step 5: Add to activeFiltersList if scope is 'all'**

Find `activeFiltersList` computed. Add an entry when scope is 'all' so users see it in the active filters chips:

```typescript
    if (filters.value.annotationScope === 'all') {
      list.push({ id: 'annotationScope', label: 'Scope', value: 'All (global)' })
    }
```

And in `clearFilter`, add a case for `'annotationScope'`:

```typescript
    case 'annotationScope':
      filters.value.annotationScope = 'case'
      break
```

- [ ] **Step 6: Update exportToExcel filter builder**

Find `exportToExcel` function (around line 684). In the filter object it builds for export, add annotation_scope so exports respect the current scope:

```typescript
    // Add annotation scope to export filters
    if (filters.value.annotationScope === 'all') {
      exportFilters.annotation_scope = 'all'
    }
```

- [ ] **Step 7: Verify typecheck passes**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/composables/useFilterState.ts
git commit -m "feat: add annotationScope to filter state and emit logic"
```

---

## Chunk 2: Scope Toggle UI Component + FilterToolbar Integration

### Task 5: Create AnnotationScopeToggle component

**Files:**
- Create: `src/renderer/src/components/AnnotationScopeToggle.vue`

- [ ] **Step 1: Create the component**

```vue
<template>
  <v-btn-toggle
    :model-value="modelValue"
    mandatory
    density="compact"
    variant="outlined"
    divided
    class="annotation-scope-toggle"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-btn value="case" size="small">
      <v-icon start size="small">mdi-briefcase-outline</v-icon>
      Case
      <v-tooltip activator="parent" location="bottom">
        Case mode: filter and annotate for this case only
      </v-tooltip>
    </v-btn>
    <v-btn value="all" size="small">
      <v-icon start size="small">mdi-earth</v-icon>
      All
      <v-tooltip activator="parent" location="bottom">
        All mode: filter includes global annotations, actions target global
      </v-tooltip>
    </v-btn>
  </v-btn-toggle>
</template>

<script setup lang="ts">
import type { AnnotationScope } from '../../../shared/types/annotations'

defineProps<{
  modelValue: AnnotationScope
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AnnotationScope]
}>()
</script>

<style scoped>
.annotation-scope-toggle {
  height: 32px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/AnnotationScopeToggle.vue
git commit -m "feat: add AnnotationScopeToggle component"
```

---

### Task 6: Integrate scope toggle into FilterToolbar

**Files:**
- Modify: `src/renderer/src/components/FilterToolbar.vue`

- [ ] **Step 1: Add import**

Add to the imports section:

```typescript
import AnnotationScopeToggle from './AnnotationScopeToggle.vue'
```

- [ ] **Step 2: Add scope toggle to template**

In the `#filters` slot, add the scope toggle **before** the star toggle button (before line 30, the `<!-- Star toggle -->` comment):

```vue
      <!-- Annotation scope toggle -->
      <AnnotationScopeToggle v-model="filters.annotationScope" class="mr-2" />
```

- [ ] **Step 3: Update hint text for scope**

In the `#hints` slot (line 133-143), update the condition and text to be scope-aware:

Replace:
```vue
        <div
          v-if="(filters.starredOnly || filters.hasCommentOnly) && filteredCount === 0"
          class="annotation-hint-bar"
        >
          <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
          <span class="text-body-small">
            No variants match the annotation filter. Star or comment on variants first, then filter.
          </span>
        </div>
```

With:
```vue
        <div
          v-if="(filters.starredOnly || filters.hasCommentOnly) && filteredCount === 0"
          class="annotation-hint-bar"
        >
          <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
          <span class="text-body-small">
            {{
              filters.annotationScope === 'all'
                ? 'No variants match the annotation filter. This includes global annotations from other cases.'
                : 'No variants match the annotation filter. Star or comment on variants first, then filter.'
            }}
          </span>
        </div>
```

- [ ] **Step 4: Emit annotationScope to parent**

The `useFilterState` composable already watches `filters` deeply and calls `emitFilters()`, which now includes `annotation_scope`. No additional wiring needed — the scope is already part of `filters.value.annotationScope`.

- [ ] **Step 5: Verify typecheck and lint**

Run: `make lint && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/FilterToolbar.vue
git commit -m "feat: integrate annotation scope toggle into FilterToolbar"
```

---

### Task 7: Pass annotationScope through CaseView → VariantTable

**Files:**
- Modify: `src/renderer/src/views/CaseView.vue`
- Modify: `src/renderer/src/components/VariantTable.vue`

- [ ] **Step 1: Add annotationScope state to CaseView**

In `src/renderer/src/views/CaseView.vue`, add import and ref:

```typescript
import { ref } from 'vue'
import type { AnnotationScope } from '../../../shared/types/annotations'

// After useAppState() destructuring:
const annotationScope = ref<AnnotationScope>('case')
```

Note: `ref` may already be imported from the existing `computed` import — just add it there.

- [ ] **Step 2: Capture scope from FilterToolbar emit**

Update `handleFiltersUpdate` to capture the scope:

```typescript
function handleFiltersUpdate(filters: Omit<VariantFilter, 'case_id'>): void {
  currentFilters.value = filters
  annotationScope.value = (filters.annotation_scope as AnnotationScope) ?? 'case'
  if (initialSearch.value !== undefined && filters.search_query != null) {
    initialSearch.value = undefined
  }
}
```

- [ ] **Step 3: Pass scope to VariantTable**

Add `:annotation-scope="annotationScope"` to the `<VariantTable>` component in the template.

- [ ] **Step 4: Accept scope prop in VariantTable**

In `src/renderer/src/components/VariantTable.vue`, update the Props interface:

```typescript
import type { AnnotationScope } from '../../../shared/types/annotations'

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
  annotationScope?: AnnotationScope
}
```

Add default:

```typescript
const props = withDefaults(defineProps<Props>(), {
  annotationScope: 'case'
})
```

- [ ] **Step 5: Verify typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/views/CaseView.vue src/renderer/src/components/VariantTable.vue
git commit -m "feat: pass annotationScope from CaseView through VariantTable"
```

---

## Chunk 3: AnnotationsCell Scope Awareness

### Task 8: Add scope prop and display swap to AnnotationsCell

**Files:**
- Modify: `src/renderer/src/components/table-cells/AnnotationsCell.vue`

- [ ] **Step 1: Add scope prop**

Add to the Props interface:

```typescript
import type { AnnotationScope } from '../../../../shared/types/annotations'
```

Add to `interface Props`:

```typescript
  /** Annotation scope: controls display priority and action routing */
  annotationScope?: AnnotationScope
```

Add default:

```typescript
const props = withDefaults(defineProps<Props>(), {
  isGlobalStarred: false,
  globalAcmgClassification: null,
  hasGlobalComment: false,
  showGlobalIndicators: true,
  annotationScope: 'case'
})
```

- [ ] **Step 2: Add computed properties for display swap**

Add after the `hasAnyComment` computed:

```typescript
// Display swap: in "all" mode, global becomes primary, per-case becomes ring indicator
const displayStarred = computed(() =>
  props.annotationScope === 'all' ? props.isGlobalStarred : props.isStarred
)
const displayGlobalStarred = computed(() =>
  props.annotationScope === 'all' ? props.isStarred : props.isGlobalStarred
)
const displayAcmg = computed(() =>
  props.annotationScope === 'all' ? props.globalAcmgClassification : props.acmgClassification
)
const displayGlobalAcmg = computed(() =>
  props.annotationScope === 'all' ? props.acmgClassification : props.globalAcmgClassification
)
const displayHasComment = computed(() =>
  props.annotationScope === 'all' ? props.hasGlobalComment : props.hasComment
)
const displayHasGlobalComment = computed(() =>
  props.annotationScope === 'all' ? props.hasComment : props.hasGlobalComment
)
```

- [ ] **Step 3: Update template to use display computeds**

Replace all direct prop references in the template with the computed equivalents:

- `isStarred` → `displayStarred`
- `isGlobalStarred` → `displayGlobalStarred`
- `acmgClassification` → `displayAcmg`
- `globalAcmgClassification` → `displayGlobalAcmg`
- `hasComment` → `displayHasComment`
- `hasGlobalComment` → `displayHasGlobalComment`

Also update `hasAnyComment`:

```typescript
const hasAnyComment = computed(() => displayHasComment.value || displayHasGlobalComment.value)
```

And update the tooltip text to reflect swapped context:

For star tooltips (inside the `v-if="showGlobalIndicators"` block):
```vue
      <span v-if="displayGlobalStarred && displayStarred">Starred (case + global)</span>
      <span v-else-if="displayGlobalStarred">
        {{ annotationScope === 'all' ? 'Case star (click to toggle global)' : 'Global star (click to add case star)' }}
      </span>
      <span v-else-if="displayStarred">
        {{ annotationScope === 'all' ? 'Starred globally' : 'Starred for this case' }}
      </span>
      <span v-else>Click to star</span>
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `make lint && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/table-cells/AnnotationsCell.vue
git commit -m "feat: scope-aware display swap in AnnotationsCell"
```

---

### Task 9: Wire scope to AnnotationsCell in VariantTable

**Files:**
- Modify: `src/renderer/src/components/VariantTable.vue:60-73`

- [ ] **Step 1: Pass scope prop to AnnotationsCell**

In the `item.annotations` template slot, add the `:annotation-scope` prop:

```vue
          <AnnotationsCell
            :is-starred="isStarred(item.chr, item.pos, item.ref, item.alt)"
            :is-global-starred="isGlobalStarred(item.chr, item.pos, item.ref, item.alt)"
            :acmg-classification="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
            :global-acmg-classification="getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
            :has-comment="!!getPerCaseComment(item.chr, item.pos, item.ref, item.alt)"
            :has-global-comment="!!getGlobalComment(item.chr, item.pos, item.ref, item.alt)"
            :show-global-indicators="true"
            :annotation-scope="annotationScope"
            @star-toggle="annotationDialogsRef?.handleStarToggle(item)"
            @acmg-select="(c) => annotationDialogsRef?.handleQuickAcmgSelect(item, c)"
            @acmg-evidence-click="annotationDialogsRef?.openAcmgEvidenceDialog(item)"
            @comment-click="annotationDialogsRef?.openCommentDialog(item)"
          />
```

Note: The event handlers still call the same methods on `annotationDialogsRef` — the dialogs component will be updated in Task 11 to route based on scope.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/VariantTable.vue
git commit -m "feat: pass annotationScope to AnnotationsCell in VariantTable"
```

---

## Chunk 4: Unified Annotation Dialogs

### Task 10: Extend useAnnotationDialogs composable for scope branching

**Files:**
- Modify: `src/renderer/src/composables/useAnnotationDialogs.ts`

- [ ] **Step 1: Add global methods to AnnotationFunctions interface**

Add to the `AnnotationFunctions` interface (after line 57, before the closing `}`):

```typescript
  // Global variants (used when scope === 'all' or in cohort mode)
  toggleGlobalStar?: (chr: string, pos: number, ref: string, alt: string) => Promise<void>
  setGlobalAcmgClassification?: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null
  ) => Promise<void>
  setGlobalAcmgClassificationWithEvidence?: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    classification: AcmgClassification | null,
    evidenceJson: string
  ) => Promise<void>
  getGlobalAcmgEvidence?: (chr: string, pos: number, ref: string, alt: string) => string | null
  getGlobalComment?: (chr: string, pos: number, ref: string, alt: string) => string | null
  getPerCaseComment?: (chr: string, pos: number, ref: string, alt: string) => string | null
```

- [ ] **Step 2: Add scope parameter to composable signature**

Update the function signature:

```typescript
import type { AnnotationScope } from '../../../shared/types/annotations'

export function useAnnotationDialogs(
  caseId: Ref<number | null>,
  annotations: AnnotationFunctions,
  scope?: Ref<AnnotationScope>
) {
```

Note: `caseId` changes from `Ref<number>` to `Ref<number | null>` to support cohort mode (no caseId).

- [ ] **Step 3: Update variant type to accept AnnotationTarget**

Change `Variant` references to a union:

```typescript
import type { AnnotationTarget } from '../../../shared/types/annotations'

type DialogVariant = Variant | AnnotationTarget
```

Update refs:

```typescript
const selectedVariantForComment = ref<DialogVariant | null>(null)
const selectedVariantForAcmg = ref<DialogVariant | null>(null)
```

- [ ] **Step 4: Add scope-aware action methods**

Replace `handleStarToggle`:

```typescript
  const handleStarToggle = async (item: DialogVariant): Promise<void> => {
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.toggleGlobalStar) {
      await annotations.toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
    } else if (caseId.value !== null && item.id !== undefined) {
      await annotations.toggleStar(caseId.value, item.id, item.chr, item.pos, item.ref, item.alt)
    }
  }
```

Replace `handleQuickAcmgSelect`:

```typescript
  const handleQuickAcmgSelect = async (
    item: DialogVariant,
    classification: AcmgClassification | null
  ): Promise<void> => {
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.setGlobalAcmgClassification) {
      await annotations.setGlobalAcmgClassification(
        item.chr, item.pos, item.ref, item.alt, classification
      )
    } else if (caseId.value !== null && item.id !== undefined) {
      await annotations.setAcmgClassification(
        caseId.value, item.id, item.chr, item.pos, item.ref, item.alt, classification
      )
    }
  }
```

Replace `handleAcmgEvidenceChange`:

```typescript
  const handleAcmgEvidenceChange = async (payload: {
    classification: AcmgClassification | null
    evidenceJson: string
  }): Promise<void> => {
    const v = selectedVariantForAcmg.value
    if (v === null) return
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.setGlobalAcmgClassificationWithEvidence) {
      await annotations.setGlobalAcmgClassificationWithEvidence(
        v.chr, v.pos, v.ref, v.alt, payload.classification, payload.evidenceJson
      )
    } else if (caseId.value !== null && v.id !== undefined) {
      await annotations.setAcmgClassificationWithEvidence(
        caseId.value, v.id, v.chr, v.pos, v.ref, v.alt, payload.classification, payload.evidenceJson
      )
    }
  }
```

Replace `handleCommentSave`:

```typescript
  const handleCommentSave = async (data: {
    globalComment: string | null
    perCaseComment: string | null
    globalChanged: boolean
    perCaseChanged: boolean
  }): Promise<void> => {
    if (!selectedVariantForComment.value) return
    const v = selectedVariantForComment.value
    const effectiveScope = scope?.value ?? 'case'

    if (data.globalChanged) {
      await annotations.upsertGlobalComment(v.chr, v.pos, v.ref, v.alt, data.globalComment)
    }
    if (data.perCaseChanged && effectiveScope === 'case' && caseId.value !== null && v.id !== undefined) {
      await annotations.upsertPerCaseComment(
        caseId.value, v.id, v.chr, v.pos, v.ref, v.alt, data.perCaseComment
      )
    }

    commentDialogOpen.value = false
  }
```

Update `acmgEvidenceJson` to be scope-aware:

```typescript
  const acmgEvidenceJson = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    const effectiveScope = scope?.value ?? 'case'
    if (effectiveScope === 'all' && annotations.getGlobalAcmgEvidence) {
      return annotations.getGlobalAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
    }
    return annotations.getAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
  })
```

Update `acmgVariantData` to handle `CohortVariant.cadd_phred` (both fields are now on `AnnotationTarget`):

```typescript
  const acmgVariantData = computed(() => {
    const v = selectedVariantForAcmg.value
    if (v === null) return null
    return {
      gnomad_af: v.gnomad_af ?? null,
      cadd: v.cadd ?? ('cadd_phred' in v ? v.cadd_phred : null) ?? null,
      clinvar: v.clinvar ?? null
    }
  })
```

- [ ] **Step 5: Verify typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/composables/useAnnotationDialogs.ts
git commit -m "feat: scope-aware useAnnotationDialogs with global method branching"
```

---

### Task 11: Unify AnnotationDialogs component

**Files:**
- Move + Modify: `src/renderer/src/components/variant-table/VariantAnnotationDialogs.vue` → `src/renderer/src/components/AnnotationDialogs.vue`
- Modify: `src/renderer/src/components/VariantTable.vue` (update import path)

- [ ] **Step 1: Create unified AnnotationDialogs.vue**

Create `src/renderer/src/components/AnnotationDialogs.vue`:

```vue
<template>
  <v-snackbar v-model="snackbar.visible" :color="snackbar.color" :timeout="3000" location="bottom">
    {{ snackbar.message }}
  </v-snackbar>

  <CommentDialog
    v-model="commentDialogOpen"
    :global-comment="
      selectedVariantForComment
        ? getGlobalComment(
            selectedVariantForComment.chr,
            selectedVariantForComment.pos,
            selectedVariantForComment.ref,
            selectedVariantForComment.alt
          )
        : null
    "
    :per-case-comment="
      effectiveScope === 'case' && selectedVariantForComment
        ? getPerCaseComment(
            selectedVariantForComment.chr,
            selectedVariantForComment.pos,
            selectedVariantForComment.ref,
            selectedVariantForComment.alt
          )
        : null
    "
    :global-timestamps="getGlobalTimestamps(selectedVariantForComment)"
    :per-case-timestamps="effectiveScope === 'case' ? getPerCaseTimestamps(selectedVariantForComment) : null"
    @save="handleCommentSave"
  />

  <AcmgEvidenceDialog
    ref="acmgEvidenceDialogRef"
    :evidence-json="acmgEvidenceJson"
    :variant-data="acmgVariantData"
    :variant-label="acmgVariantLabel"
    :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
    :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
    @change="handleAcmgEvidenceChange"
  />
</template>

<script setup lang="ts">
import { toRef, computed } from 'vue'
import CommentDialog from './CommentDialog.vue'
import AcmgEvidenceDialog from './AcmgEvidenceDialog.vue'
import { useAnnotationDialogs } from '../composables/useAnnotationDialogs'
import { useVariantLinks } from '../composables/useVariantLinks'
import type { useAnnotations } from '../composables/useAnnotations'
import type { AnnotationScope } from '../../../shared/types/annotations'

interface Props {
  caseId: number | null
  annotationScope?: AnnotationScope
  annotationActions: {
    getAcmgEvidence: ReturnType<typeof useAnnotations>['getAcmgEvidence']
    toggleStar: ReturnType<typeof useAnnotations>['toggleStar']
    setAcmgClassification: ReturnType<typeof useAnnotations>['setAcmgClassification']
    setAcmgClassificationWithEvidence: ReturnType<typeof useAnnotations>['setAcmgClassificationWithEvidence']
    upsertGlobalComment: ReturnType<typeof useAnnotations>['upsertGlobalComment']
    upsertPerCaseComment: ReturnType<typeof useAnnotations>['upsertPerCaseComment']
    getAnnotations: ReturnType<typeof useAnnotations>['getAnnotations']
    getGlobalComment: ReturnType<typeof useAnnotations>['getGlobalComment']
    getPerCaseComment: ReturnType<typeof useAnnotations>['getPerCaseComment']
    // Global methods (used when scope === 'all')
    toggleGlobalStar?: ReturnType<typeof useAnnotations>['toggleGlobalStar']
    setGlobalAcmgClassification?: ReturnType<typeof useAnnotations>['setGlobalAcmgClassification']
    setGlobalAcmgClassificationWithEvidence?: ReturnType<typeof useAnnotations>['setGlobalAcmgClassificationWithEvidence']
    getGlobalAcmgEvidence?: ReturnType<typeof useAnnotations>['getGlobalAcmgEvidence']
  }
}

const props = withDefaults(defineProps<Props>(), {
  annotationScope: 'case'
})

const effectiveScope = computed(() => props.annotationScope)

const { snackbar } = useVariantLinks()

const {
  commentDialogOpen,
  selectedVariantForComment,
  selectedVariantForAcmg,
  acmgEvidenceDialogRef,
  acmgEvidenceJson,
  acmgVariantData,
  acmgVariantLabel,
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleQuickAcmgSelect,
  handleAcmgEvidenceChange,
  handleCommentSave,
  getGlobalTimestamps,
  getPerCaseTimestamps
} = useAnnotationDialogs(
  toRef(props, 'caseId'),
  {
    getAcmgEvidence: props.annotationActions.getAcmgEvidence,
    toggleStar: props.annotationActions.toggleStar,
    setAcmgClassification: props.annotationActions.setAcmgClassification,
    setAcmgClassificationWithEvidence: props.annotationActions.setAcmgClassificationWithEvidence,
    upsertGlobalComment: props.annotationActions.upsertGlobalComment,
    upsertPerCaseComment: props.annotationActions.upsertPerCaseComment,
    getAnnotations: props.annotationActions.getAnnotations,
    toggleGlobalStar: props.annotationActions.toggleGlobalStar,
    setGlobalAcmgClassification: props.annotationActions.setGlobalAcmgClassification,
    setGlobalAcmgClassificationWithEvidence: props.annotationActions.setGlobalAcmgClassificationWithEvidence,
    getGlobalAcmgEvidence: props.annotationActions.getGlobalAcmgEvidence,
    getGlobalComment: props.annotationActions.getGlobalComment,
    getPerCaseComment: props.annotationActions.getPerCaseComment
  },
  effectiveScope
)

// Re-export comment accessors for template
const { getGlobalComment, getPerCaseComment } = props.annotationActions

// Suppress unused ref warning
void acmgEvidenceDialogRef

defineExpose({
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleQuickAcmgSelect
})
</script>
```

- [ ] **Step 2: Update VariantTable.vue import and usage**

In `src/renderer/src/components/VariantTable.vue`:

Replace import:
```typescript
// Old
import VariantAnnotationDialogs from './variant-table/VariantAnnotationDialogs.vue'
// New
import AnnotationDialogs from './AnnotationDialogs.vue'
```

Update template usage:
```vue
    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="caseId"
      :annotation-scope="annotationScope"
      :annotation-actions="annotationActions"
    />
```

Update the `annotationActions` object to include global methods:
```typescript
const annotationActions = {
  getAcmgEvidence,
  toggleStar,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations,
  getGlobalComment,
  getPerCaseComment,
  // Global methods for scope='all'
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
}
```

Add missing destructured methods from `useAnnotations()`:
```typescript
const {
  // ... existing ...
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
} = useAnnotations()
```

- [ ] **Step 3: Verify typecheck and lint**

Run: `make lint && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AnnotationDialogs.vue src/renderer/src/components/VariantTable.vue
git commit -m "feat: unified AnnotationDialogs component with scope support"
```

---

## Chunk 5: Cohort View Migration + Cleanup

### Task 12: Migrate CohortTable to unified AnnotationDialogs

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue`
- Modify: `src/renderer/src/components/cohort/CohortDataTable.vue` (if it references CohortAnnotationDialogs)

- [ ] **Step 1: Read CohortTable.vue to understand current wiring**

Read the file to find how `CohortAnnotationDialogs` is currently used — its ref, how export logic is called, and how annotation actions are passed.

- [ ] **Step 2: Extract export logic and snackbar from CohortAnnotationDialogs to CohortTable**

Move from `CohortAnnotationDialogs.vue` into `CohortTable.vue`:

- `exporting` ref
- `snackbar` ref (with `actionText`, `actionCallback`, `timeout` — richer than `useVariantLinks` snackbar)
- `exportToExcel` async function (depends on `props.filterState`, `api`, `snackbar`, `exporting`)
- Add snackbar template to `CohortTable.vue` template:
```vue
<v-snackbar v-model="snackbar.visible" :color="snackbar.color" :timeout="snackbar.timeout" location="bottom right">
  {{ snackbar.message }}
  <template #actions>
    <v-btn v-if="snackbar.actionText" variant="text" @click="snackbar.actionCallback?.()">{{ snackbar.actionText }}</v-btn>
    <v-btn variant="text" @click="snackbar.visible = false">Close</v-btn>
  </template>
</v-snackbar>
```
- Update `CohortFilterBar` binding: change `:exporting="annotationDialogsRef?.exporting ?? false"` to `:exporting="exporting"`

- [ ] **Step 3: Replace CohortAnnotationDialogs with unified AnnotationDialogs**

Replace import:
```typescript
// Old
import CohortAnnotationDialogs from './cohort/CohortAnnotationDialogs.vue'
// New
import AnnotationDialogs from './AnnotationDialogs.vue'
```

Update template:
```vue
    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="null"
      annotation-scope="all"
      :annotation-actions="annotationActions"
    />
```

Update `annotationActions` to use the global method naming expected by unified AnnotationDialogs:
```typescript
const annotationActions = {
  // Per-case stubs (not used in cohort mode, but required by interface)
  getAcmgEvidence: getGlobalAcmgEvidence,
  toggleStar: async () => {},
  setAcmgClassification: async () => {},
  setAcmgClassificationWithEvidence: async () => {},
  upsertPerCaseComment: async () => {},
  // Shared
  upsertGlobalComment,
  getAnnotations,
  getGlobalComment,
  getPerCaseComment: () => null,
  // Global methods
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
}
```

Also update the `handleAcmgSelect` handler that calls the dialogs ref. The old `CohortAnnotationDialogs` exposed `handleAcmgSelect(payload)` taking `{ item, classification }`. The unified `AnnotationDialogs` exposes `handleQuickAcmgSelect(item, classification)` as two arguments. Update the caller:
```typescript
// Old: annotationDialogsRef.value?.handleAcmgSelect({ item, classification })
// New: annotationDialogsRef.value?.handleQuickAcmgSelect(item, classification)
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `make lint && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CohortTable.vue src/renderer/src/components/cohort/CohortDataTable.vue
git commit -m "feat: migrate CohortTable to unified AnnotationDialogs"
```

---

### Task 13: Delete old files and clean up

**Files:**
- Delete: `src/renderer/src/components/cohort/CohortAnnotationDialogs.vue`
- Delete: `src/renderer/src/components/variant-table/VariantAnnotationDialogs.vue`

- [ ] **Step 1: Verify no remaining imports of deleted files**

Run grep to check:
```bash
grep -r "CohortAnnotationDialogs" src/renderer/src/ --include="*.vue" --include="*.ts"
grep -r "VariantAnnotationDialogs" src/renderer/src/ --include="*.vue" --include="*.ts"
```

Expected: No results (all references updated in previous tasks)

- [ ] **Step 2: Delete old files**

```bash
git rm src/renderer/src/components/cohort/CohortAnnotationDialogs.vue
git rm src/renderer/src/components/variant-table/VariantAnnotationDialogs.vue
```

- [ ] **Step 3: Full lint, typecheck, and test**

```bash
make lint && npx vue-tsc --noEmit && make rebuild-node && make test
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove old duplicated annotation dialog components"
```

---

## Chunk 6: Final Verification

### Task 14: Build and visual verification

- [ ] **Step 1: Build the app**

```bash
npx electron-vite build
```

Expected: Build succeeds

- [ ] **Step 2: Launch with Playwright and verify Case View**

Launch the app, navigate to a case, verify:
- Scope toggle visible in toolbar (Case / All buttons)
- Default is "Case"
- Star/ACMG/comment filters work in Case mode (same as before)
- Toggle to "All" — filters now include globally annotated variants
- Star a variant in "All" mode — verify it sets the global star (check via toggle back to Case mode)

- [ ] **Step 3: Verify Cohort View unchanged**

Navigate to cohort view, verify:
- No scope toggle visible
- Star/ACMG/comment work as before (global only)
- No regressions

- [ ] **Step 4: Final commit with all changes**

```bash
make lint && npx vue-tsc --noEmit
git add -A
git status
```

Review and commit any remaining fixes.
