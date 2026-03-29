# Performance Phase 1: Zero-Risk Quick Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 10 zero-risk config/CSS/trivial code changes that improve perceived speed with no behavioral impact.

**Architecture:** All changes are independent — each modifies a different file with no cross-dependencies. The PR touches main process config, renderer CSS, Vue composables, and component templates.

**Tech Stack:** Electron BrowserWindow config, Vue 3 (markRaw, onActivated, KeepAlive), CSS containment, Vuetify v-data-table scoped styles.

**Spec:** `.planning/specs/2026-03-25-full-perf-sweep-design.md` — Phase 1

---

### Task 1: BrowserWindow backgroundColor + V8 Cache + Defer Auto-Updater

**Files:**
- Modify: `src/main/index.ts:38-51` (BrowserWindow constructor)
- Modify: `src/main/index.ts:132-134` (auto-updater init)

- [ ] **Step 1: Add backgroundColor to BrowserWindow**

In `src/main/index.ts`, inside the `createWindow()` function, add `backgroundColor` to the BrowserWindow constructor options (after `show: false`):

```typescript
const mainWindow = new BrowserWindow({
  width: APP_CONFIG.WINDOW_WIDTH,
  height: APP_CONFIG.WINDOW_HEIGHT,
  show: false,
  backgroundColor: '#faf8f6',
  title: 'Varlens',
  autoHideMenuBar: true,
  icon: getAppIcon(),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    v8CacheOptions: 'bypassHeatCheck'
  }
})
```

- [ ] **Step 2: Defer auto-updater initialization**

In `src/main/index.ts`, find the lines (around 132-134):
```typescript
initAutoUpdater()
scheduleUpdateChecks()
```

Replace with:
```typescript
setImmediate(() => {
  initAutoUpdater()
  scheduleUpdateChecks()
})
```

This defers auto-updater work to after the window paints.

- [ ] **Step 3: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "perf: add backgroundColor, V8 cache, and defer auto-updater

Adds backgroundColor '#faf8f6' to eliminate white flash on launch.
Enables v8CacheOptions 'bypassHeatCheck' for faster subsequent starts.
Defers initAutoUpdater/scheduleUpdateChecks via setImmediate."
```

---

### Task 2: KeepAlive for Router Views with Stale Data Mitigation

**Files:**
- Modify: `src/renderer/src/App.vue:39-41` (router-view template)
- Modify: `src/renderer/src/composables/useAppState.ts` (add generation counter)
- Modify: `src/renderer/src/views/CaseView.vue` (add onActivated hook)
- Modify: `src/renderer/src/views/CohortView.vue` (add onActivated hook)

- [ ] **Step 1: Add generation counter to useAppState**

In `src/renderer/src/composables/useAppState.ts`, add a `dataGeneration` ref to the state. This counter is incremented whenever cases are imported, deleted, or annotations change.

In the `AppStateReturn` interface, add:
```typescript
dataGeneration: Ref<number>
```

In `createAppState()`, add:
```typescript
const dataGeneration = ref(0)
```

Add to the return object:
```typescript
dataGeneration,
```

- [ ] **Step 2: Wrap router-view with KeepAlive in App.vue**

In `src/renderer/src/App.vue`, replace:
```html
<v-main>
  <router-view />
</v-main>
```

With:
```html
<v-main>
  <router-view v-slot="{ Component }">
    <keep-alive :max="2">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</v-main>
```

- [ ] **Step 3: Increment generation counter on data mutations**

In `src/renderer/src/App.vue`, in the existing `handleImportComplete`, `handleBatchImportComplete`, and `handleCaseDeleted` methods, add:
```typescript
appState.dataGeneration.value++
```

Check each handler in App.vue and add the increment where case data changes.

- [ ] **Step 4: Add onActivated hook to CaseView**

In `src/renderer/src/views/CaseView.vue`, add `onActivated` import and a generation check:

```typescript
import { ref, computed, onActivated } from 'vue'
```

Add after the `useAppState()` destructure:
```typescript
const lastSeenGeneration = ref(appState.dataGeneration.value)

onActivated(() => {
  if (appState.dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = appState.dataGeneration.value
    // Trigger refresh by re-emitting current filters
    if (selectedCaseId.value) {
      variantTableRef.value?.refresh()
    }
  }
})
```

Note: You'll need to also destructure `dataGeneration` from `useAppState()`. And access `variantTableRef` from the existing destructure.

- [ ] **Step 5: Add onActivated hook to CohortView**

In `src/renderer/src/views/CohortView.vue`, add similar generation check:

```typescript
import { onActivated, ref } from 'vue'
```

Add after the existing destructure:
```typescript
const { dataGeneration } = useAppState()
const lastSeenGeneration = ref(dataGeneration.value)

onActivated(() => {
  if (dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = dataGeneration.value
    cohortViewRef.value?.refresh?.()
  }
})
```

- [ ] **Step 6: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: No errors

- [ ] **Step 7: Run tests**

Run: `make test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.vue src/renderer/src/composables/useAppState.ts src/renderer/src/views/CaseView.vue src/renderer/src/views/CohortView.vue
git commit -m "perf: add KeepAlive for router views with stale data detection

Wraps router-view with KeepAlive to preserve Case/Cohort view DOM on
tab switch. Adds dataGeneration counter to useAppState, incremented on
import/delete. onActivated hooks check generation and refresh if stale."
```

---

### Task 3: Remove Table Row Hover Transitions + Add CSS Containment

**Files:**
- Modify: `src/renderer/src/components/VariantTable.vue` (scoped CSS section)

- [ ] **Step 1: Remove hover transition from table rows**

In `src/renderer/src/components/VariantTable.vue`, find the CSS block (around line 668-672):
```css
/* Clickable table rows with improved hover */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
  transition: background-color 0.15s ease;
}
```

Remove the `transition` line:
```css
/* Clickable table rows with improved hover */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
}
```

Also remove the transition from the selected row style (around line 683):
```css
:deep(.v-data-table tbody tr.variant-row--selected) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent) !important;
  border-left: 4px solid rgb(var(--v-theme-primary)) !important;
  transition: background-color 0.15s ease;
}
```

Remove the `transition: background-color 0.15s ease;` line from this block too.

- [ ] **Step 2: Add CSS containment to table cells**

In the same scoped CSS section of `VariantTable.vue`, add after the existing `:deep(.v-table__wrapper)` rule:

```css
/* CSS containment: each cell is layout-independent */
:deep(.v-data-table tbody td) {
  contain: layout style;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/VariantTable.vue
git commit -m "perf: remove table row transitions and add CSS containment

Removes background-color transitions from table rows for instant hover
response. Adds contain: layout style to table cells for browser paint
optimization."
```

---

### Task 4: Remove Plot Deep Watchers

**Files:**
- Modify: `src/renderer/src/components/association/ManhattanPlot.vue:117`
- Modify: `src/renderer/src/components/association/VolcanoPlot.vue:108`

- [ ] **Step 1: Fix ManhattanPlot watcher**

In `src/renderer/src/components/association/ManhattanPlot.vue`, find (line 117):
```typescript
watch(() => props.results, render, { deep: true })
```

Replace with:
```typescript
watch(() => props.results, render)
```

- [ ] **Step 2: Fix VolcanoPlot watcher**

In `src/renderer/src/components/association/VolcanoPlot.vue`, find (line 108):
```typescript
watch(() => props.results, render, { deep: true })
```

Replace with:
```typescript
watch(() => props.results, render)
```

- [ ] **Step 3: Run lint**

Run: `make lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/association/ManhattanPlot.vue src/renderer/src/components/association/VolcanoPlot.vue
git commit -m "perf: remove deep watchers from plot components

Results arrays are replaced wholesale by the parent, never mutated.
Shallow reference comparison is sufficient and avoids deep-traversing
large result arrays on every change."
```

---

### Task 5: Cache parseCohortNames in CaseList

**Files:**
- Modify: `src/renderer/src/components/CaseList.vue` (template + script)

- [ ] **Step 1: Examine current usage**

Read `src/renderer/src/components/CaseList.vue` around lines 90-115 to understand the template structure. The function `parseCohortNames(caseItem.cohort_names)` is called 3 times per row: once for the `v-for`, once for the `v-if` length check, and once for the overflow count.

- [ ] **Step 2: Add a helper to avoid repeated calls**

The simplest fix is to use a local variable in the template. In Vue 3, you can use a `v-for` with destructuring or a helper computed. However, since this is inside a `v-for` iterating cases, the cleanest approach is to extract the parsed names into the `v-for` scope using a wrapping helper.

Replace the template section (around lines 92-111) that has:
```html
<v-chip
  v-for="name in parseCohortNames(caseItem.cohort_names).slice(0, 3)"
  :key="name"
  :color="getCohortColor(name)"
  size="x-small"
  label
>
  {{ name }}
</v-chip>
<v-chip
  v-if="parseCohortNames(caseItem.cohort_names).length > 3"
  size="x-small"
  color="grey"
  label
>
  +{{ parseCohortNames(caseItem.cohort_names).length - 3 }}
</v-chip>
```

With a pattern that calls `parseCohortNames` only once. Add a computed map in the script section:

```typescript
// Cache parsed cohort names per case to avoid repeated string splits in template
const parsedCohortMap = computed(() => {
  const map = new Map<number, string[]>()
  for (const c of cases.value) {
    map.set(c.id, parseCohortNames(c.cohort_names))
  }
  return map
})
```

Then update the template to use the cached map:
```html
<v-chip
  v-for="name in (parsedCohortMap.get(caseItem.id) ?? []).slice(0, 3)"
  :key="name"
  :color="getCohortColor(name)"
  size="x-small"
  label
>
  {{ name }}
</v-chip>
<v-chip
  v-if="(parsedCohortMap.get(caseItem.id) ?? []).length > 3"
  size="x-small"
  color="grey"
  label
>
  +{{ (parsedCohortMap.get(caseItem.id) ?? []).length - 3 }}
</v-chip>
```

Note: Check that `cases` is the reactive ref containing the case list (it may be named differently — read the file to confirm the exact variable name).

- [ ] **Step 3: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/CaseList.vue
git commit -m "perf: cache parseCohortNames results per case in CaseList

Adds computed parsedCohortMap to avoid calling parseCohortNames 3 times
per row on every render cycle. The computed caches results keyed by
case ID."
```

---

### Task 6: markRaw on IPC Variant Data

**Files:**
- Modify: `src/renderer/src/composables/useOffsetPagination.ts:101`
- Test: `tests/renderer/composables/useOffsetPagination.test.ts`

- [ ] **Step 1: Add markRaw import and apply to items**

In `src/renderer/src/composables/useOffsetPagination.ts`, add `markRaw` to the Vue import:
```typescript
import { ref, shallowRef, watch, markRaw, type Ref } from 'vue'
```

Find the line (around line 101) where items are assigned:
```typescript
items.value = result.data
```

Replace with:
```typescript
items.value = result.data.map(item => markRaw(item))
```

- [ ] **Step 2: Run existing tests**

Run: `npm run rebuild:node && npx vitest run tests/renderer/composables/useOffsetPagination.test.ts`
Expected: All existing tests pass

- [ ] **Step 3: Run full test suite**

Run: `make test`
Expected: All tests pass (markRaw should be transparent to existing behavior)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useOffsetPagination.ts
git commit -m "perf: apply markRaw to individual items from IPC results

Prevents Vue from creating deep reactive proxies on variant objects
that are read-only and replaced wholesale on each page load. Applied
per-item (not on the array) to preserve shallowRef tracking."
```

---

### Task 7: Remove Global Chip Animations

**Files:**
- Modify: `src/renderer/src/assets/styles/custom.css` (lines 139-175)

- [ ] **Step 1: Remove chip transitions and animations**

In `src/renderer/src/assets/styles/custom.css`, remove the entire section from line 139 to 175:

```css
/* ===== Micro-interaction Polish ===== */

/* Smooth transitions on all interactive elements */
.v-chip {
  transition:
    box-shadow 0.15s ease,
    transform 0.15s ease !important;
}

.v-chip:hover {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
}

/* Filter section hover enhancement */
.filter-section-wrapper {
  transition: background-color 0.15s ease !important;
}

.filter-section-wrapper:hover {
  background-color: rgba(0, 0, 0, 0.05) !important;
}

/* Applied filter chips entrance animation */
.applied-filters-bar .v-chip {
  animation: chipEnter 0.15s ease-out;
}

@keyframes chipEnter {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/styles/custom.css
git commit -m "perf: remove global chip transitions and entrance animations

Eliminates unnecessary compositor work on all v-chip elements and
filter bar chip entrance animations."
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full CI**

Run: `make ci`
Expected: lint + typecheck + test all pass

- [ ] **Step 2: Build and check output**

Run: `npx electron-vite build && ls -lhS out/renderer/assets/`
Expected: Build succeeds. Bundle sizes should be unchanged (Phase 1 changes are runtime-only).

- [ ] **Step 3: Measure baseline for Phase 2 comparison**

Record the current asset sizes for later comparison:
```bash
echo "=== Phase 1 baseline ===" && ls -lhS out/renderer/assets/
```

Save output for comparison after Phase 2.
