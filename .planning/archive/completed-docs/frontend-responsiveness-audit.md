# Frontend Responsiveness & Snappiness Audit

**Date**: 2026-03-25
**Branch**: `perf/phase5-large-migrations`
**Context**: Phases 1–4 of the perf sweep are shipped (bundle 15MB→5MB, lazy routes, async dialogs, shallowRef caches, worker pool). This audit targets the *next layer*: perceived responsiveness, animation speed, blocking patterns, and UI micro-interactions — making VarLens feel as fast as VS Code.

---

## Executive Summary

The app has excellent fundamentals (server-side pagination, shallowRef caches, lazy components, V8 code caching). The remaining responsiveness gaps are:

1. **Vuetify default animations are mobile-tuned (300ms)** — desktop should be 100–150ms
2. **Deep watchers** on filter/column objects cause unnecessary traversals (7+ instances)
3. **Sequential IPC awaits** in `onMounted` that could be parallelized
4. **No optimistic updates** — every mutation round-trips to SQLite before UI reflects change
5. **Missing skeleton/Suspense fallbacks** for lazy-loaded detail panel sections
6. **Ripple effect enabled globally** — adds DOM elements + paint on every click

---

## 1. Animation & Transition Speed

### Problem

Vuetify 3 ships with mobile-optimized transition durations (~300ms). Material Design 3 specifies desktop apps should use 100–200ms. VarLens currently uses Vuetify defaults with no overrides.

### Current State

All custom CSS transitions in the codebase are well-tuned (100–200ms):
- Skip link: `0.2s` (`custom.css:92`)
- Resize handles: `0.15s` (`App.vue:375`, `FilterDrawerShell.vue:129`)
- Column drag: `0.15s` (`ColumnsDrawer.vue:202`)
- Toolbar icon rotation: `0.2s` (`AppToolbar.vue:256`)
- Table row hover: `0.15s` (`CohortDataTable.vue:684`)
- Log viewer slide: `0.2s` (`LogViewer.vue:381`)
- Color swatch: `0.1s` (`ColorSwatchPicker.vue:51`)

But **Vuetify's built-in transitions** (dialogs, menus, drawers, expansion panels, tooltips) all run at 300ms default.

### Recommendations

**A. Global Vuetify defaults in `vuetify.ts`:**

```ts
defaults: {
  global: {
    density: 'compact',
    ripple: false,                      // HIGH IMPACT: kill ripple everywhere
  },
  VBtn: { density: 'compact', ripple: false },
  VDialog: { eager: false },            // don't pre-render until opened
  VMenu: { openDelay: 0, closeDelay: 0 },
  VTooltip: {
    openDelay: 400,                     // prevent accidental tooltips
    closeDelay: 0,
    transition: 'fade-transition',
    contentClass: 'bg-secondary',
  },
  VNavigationDrawer: { disableResizeWatcher: true },
  VSelect: { ..., transition: 'fade-transition' },
  VAutocomplete: { ..., transition: 'fade-transition' },
  // ... keep existing compact/outlined settings
}
```

**B. CSS transition duration overrides (add to `custom.css`):**

```css
/* Desktop-fast Vuetify transitions: 100ms enter, 75ms exit */
.fade-transition-enter-active,
.scale-transition-enter-active,
.slide-x-transition-enter-active,
.slide-y-transition-enter-active,
.scroll-y-transition-enter-active,
.dialog-transition-enter-active { transition-duration: 100ms !important; }

.fade-transition-leave-active,
.scale-transition-leave-active,
.slide-x-transition-leave-active,
.slide-y-transition-leave-active,
.scroll-y-transition-leave-active,
.dialog-transition-leave-active { transition-duration: 75ms !important; }

.v-overlay__scrim { transition-duration: 100ms !important; }

/* Navigation drawer: instant open, fast close */
.v-navigation-drawer {
  transition-duration: 150ms !important;
}
```

**C. Reduce count-pulse animation from 300ms → 200ms** (`SlimFilterToolbar.vue:241`).

**Impact**: Every interaction (menu open, dialog appear, drawer slide, tooltip show) feels 2–3× faster.

---

## 2. Deep Watchers — Excessive Reactivity Traversal

### Problem

7+ deep watchers traverse entire nested objects on every change, causing unnecessary CPU work during filtering/searching.

### Instances Found

| File | Line | Watch Target | Fix |
|------|------|-------------|-----|
| `FilterToolbar.vue` | ~353 | Filter presets | Watch specific preset ID instead |
| `CaseList.vue` | 313–314 | `selectedCohortIds`, `selectedHpoIds` | Consolidate into single watch; arrays are shallow — remove `deep` |
| `CohortFilterBar.vue` | 262, 444 | Filters object, preset state | Watch computed JSON key or individual props |
| `useVariantData.ts` | 133 | `columnFilterState.columnFilters` | Use computed serialized key instead of deep watch |
| `useOffsetPagination.ts` | 216 | `sortBy` | sortBy is simple array — remove `deep` |
| `useFilterState.ts` | 426 | Filter state | Watch computed hash of changed fields |

### Recommended Pattern

```ts
// BEFORE: deep watch traverses entire object tree
watch(filters, handler, { deep: true })

// AFTER: computed key only triggers on actual changes
const filterKey = computed(() => JSON.stringify(filters.value))
watch(filterKey, handler)
```

For arrays like `selectedCohortIds`, `deep: true` is unnecessary — arrays of primitives already trigger on push/splice.

**Impact**: ~20–30% reduction in wasted CPU during rapid filter changes.

---

## 3. Sequential IPC Awaits (Blocking onMounted)

### Problem

Several components chain sequential `await` calls in `onMounted`, doubling or tripling the perceived load time.

### Instances Found

**FilterToolbar.vue:582–585:**
```ts
onMounted(async () => {
  await loadFilterOptions(props.caseId)    // IPC round-trip #1
  await loadPresets()                       // IPC round-trip #2 (blocked on #1)
})
```
Fix: `await Promise.all([loadFilterOptions(props.caseId), loadPresets()])`

**Case metadata loading** (CaseMetadataCard → composable):
Typical sequence: `get()` → `listCohorts()` → `getHpoTerms()` → `getDataInfo()` → `listExternalIds()` — 5 sequential IPC calls.
Fix: Create `case-metadata:getAll` batch IPC handler returning all data in one call, or `Promise.all()` the independent calls.

**Database open sequence:**
`database.open()` → `database.info()` → `database.recentList()` — 3 serial calls.
Fix: Combine into single IPC that returns `{ db, info, recents }`.

**Impact**: 200–600ms saved on case load and filter initialization (measurable with DevTools Network panel).

---

## 4. Optimistic Updates

### Problem

Every user mutation (tag, comment, ACMG classification, flag) awaits IPC round-trip before updating the UI. The user sees a spinner or no change for 50–200ms.

### Best Candidates

| Action | Current Behavior | Optimistic Pattern |
|--------|-----------------|-------------------|
| Tag add/remove | Await IPC → update store | Update store → fire IPC → rollback on error |
| Comment submit | Await IPC → refresh list | Add to local list → fire IPC → remove on error |
| ACMG classification | Await IPC → refresh | Update local → fire IPC → rollback on error |
| Column visibility toggle | Immediate (already good) | — |
| Bookmark/flag toggle | Await IPC → update | Toggle locally → fire IPC → rollback on error |

### Pattern

```ts
async function toggleTag(variantId: string, tag: Tag) {
  // Optimistic: update immediately
  const prev = store.getTagState(variantId)
  store.toggleTag(variantId, tag)
  try {
    await window.api.annotations.setTag(variantId, tag)
  } catch {
    store.restoreTagState(variantId, prev) // rollback
    showError('Failed to update tag')
  }
}
```

**Impact**: Interactions feel instantaneous (<16ms) instead of waiting 50–200ms for SQLite round-trip.

---

## 5. Missing Skeleton / Suspense Fallbacks

### Problem

`VariantDetailsPanel.vue` uses `defineAsyncComponent` for 5 sections (ExternalLinks, Comments, Tags, ACMG, ActivityLog) but provides **no loading fallback**. User sees blank space then content pops in.

### Fix

```vue
<Suspense>
  <template #default>
    <CommentsSection :case-id="caseId" :variant="variant" />
  </template>
  <template #fallback>
    <v-skeleton-loader type="list-item-three-line" />
  </template>
</Suspense>
```

Or use `defineAsyncComponent`'s built-in loading option:
```ts
const CommentsSection = defineAsyncComponent({
  loader: () => import('./CommentsSection.vue'),
  loadingComponent: SkeletonCard,
  delay: 0,
})
```

### Also Missing
- **CaseList infinite scroll**: No skeleton rows while fetching next batch — add placeholder `v-skeleton-loader` rows.

**Impact**: Eliminates content "pop-in" — users perceive the panel as loading progressively rather than blinking.

---

## 6. CSS Performance Properties

### `content-visibility: auto`

The highest-impact CSS property for rendering performance. Skips layout/paint for off-screen content entirely.

```css
/* Apply to variant detail panel sections that are below the fold */
.variant-detail-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 200px;
}

/* Apply to individual variant table rows */
.v-data-table__tr {
  contain: layout style paint;
}

/* Off-screen filter drawer content */
.filter-section-content {
  content-visibility: auto;
  contain-intrinsic-size: auto 300px;
}
```

Real-world benchmarks show 7× rendering improvement (232ms → 30ms) for long lists.

### `will-change` for Animated Elements

```css
.v-navigation-drawer {
  will-change: transform;
}
.v-overlay__scrim {
  will-change: opacity;
}
```

Apply only to elements that actually animate. Remove after animation completes to free GPU memory.

**Impact**: Significant reduction in rendering time for scrollable content and drawer animations.

---

## 7. Reactive State Optimization

### Already Good
- `useAnnotations.ts`: Uses `shallowRef` + `triggerRef()` for 5000-entry LRU cache ✓
- `useVariantData.ts`: Uses `markRaw()` on loaded variant arrays ✓
- Pinia stores are minimal (5 refs in databaseStore) ✓

### Remaining Issues

| File | Issue | Fix |
|------|-------|-----|
| `logStore.ts` | `entries` is `ref<LogEntry[]>` (up to MAX_LOG_ENTRIES) | Use `shallowRef` — log entries are display-only |
| `useFilterState.ts:201–273` | `activeFiltersList` computed rebuilds entire list on any change | Split into per-category computeds or memoize |
| `CohortTable.vue:178` | `cohortColumnFilters` is `ref<ColumnFiltersParam>` | Use `shallowRef` with manual trigger |

### v-memo for Table Rows

```vue
<tr v-for="item in variants" :key="item.id" v-memo="[item.id === selectedId]">
  <!-- row only re-renders when its selected state changes -->
</tr>
```

This is especially impactful for the variant table where 50–100 rows render per page but only the selected row changes.

**Impact**: Reduced GC pressure and fewer Vue reactivity traversals.

---

## 8. Event Handler Optimization

### Unthrottled Scroll Handler

**LogViewer.vue:75** — `@scroll="handleScroll"` fires on every scroll event (potentially hundreds/sec).

Fix: Use `requestAnimationFrame` batching:
```ts
let ticking = false
function handleScroll(e: Event) {
  if (!ticking) {
    requestAnimationFrame(() => {
      doScrollWork(e)
      ticking = false
    })
    ticking = true
  }
}
```

### DslSearchBar setTimeout Leak

**DslSearchBar.vue:184** — `setTimeout(() => { showMenu.value = false }, 200)` not cleaned up on unmount.

Fix: Store timeout ID and clear in `onBeforeUnmount`.

---

## 9. v-if vs v-show for Frequently Toggled Elements

### Should Switch to v-show

| Component | Element | Why |
|-----------|---------|-----|
| `LogViewer.vue:70` | Virtual scroll container | Toggles on filter; rebuilds v-virtual-scroll each time |
| `FilterToolbar.vue:76` | ACMG chip group | Toggles on responsive breakpoint |
| Expansion panels in `FilterDrawer.vue` | Filter section content | Frequently expanded/collapsed; destroys/recreates forms |

### Should Keep v-if (Correct)

- Heavy dialogs (`AppDialogHost.vue`): Rarely opened, expensive — lazy-load with v-if ✓
- `VariantDetailsPanel` async sections: v-if + defineAsyncComponent is correct ✓

---

## 10. Pre-emptive Loading

### Hover-to-Prefetch Pattern

When user hovers over a variant row, begin loading the detail panel data before they click:

```ts
function onRowMouseEnter(variantId: string) {
  requestIdleCallback(() => {
    prefetchVariantDetails(variantId)
  })
}
```

This moves the perceived latency to zero for the detail panel open — data is ready by the time the user clicks.

### Candidates
- Variant detail panel data on row hover
- Next page of variant results (already implemented in `useOffsetPagination` ✓)
- Case metadata when hovering case list item

---

## 11. Missing :key Bindings

Minor but can cause unnecessary re-renders:

| File | Loop | Fix |
|------|------|-----|
| `CaseList.vue:100` | Cohort name chips (inner loop) | Add `:key="name"` |
| `FilterDrawer.vue` | Preset loops (`visiblePresets`, `impactPresets`, etc.) | Add `:key="preset.id"` |
| `PresetBar.vue` | `visiblePresets` loop | Add `:key="preset.id"` |
| `AcmgClassificationPanel.vue` | `activeCodes`, `STRENGTH_OPTIONS` loops | Add `:key` |

---

## 12. Summary: Prioritized Action Items

### Tier 1 — High Impact, Low Effort (Do First)

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 1 | Disable ripple globally (`ripple: false`) | `vuetify.ts` | 1 line |
| 2 | CSS transition duration overrides (100ms enter, 75ms exit) | `custom.css` | 15 lines |
| 3 | Parallelize `onMounted` IPC calls (`Promise.all`) | `FilterToolbar.vue` | 1 line |
| 4 | Add `content-visibility: auto` on detail panel sections | CSS | 5 lines |
| 5 | Replace deep watchers with computed keys | 7 files | 1 line each |

### Tier 2 — High Impact, Medium Effort

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 6 | Optimistic updates for tags, flags, ACMG, comments | Composables + stores | Medium |
| 7 | Suspense/skeleton fallbacks for async detail sections | `VariantDetailsPanel.vue` | Small |
| 8 | Batch case-metadata IPC into single call | Main + preload + composable | Medium |
| 9 | `v-memo` on variant table rows | `VariantTable.vue` | Small |
| 10 | `shallowRef` for log entries and filter objects | `logStore.ts`, `CohortTable.vue` | Small |

### Tier 3 — Polish

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 11 | Hover-to-prefetch variant details | `VariantTable.vue` | Small |
| 12 | Fix missing `:key` bindings | 4 files | Trivial |
| 13 | RAF-batch LogViewer scroll handler | `LogViewer.vue` | Small |
| 14 | Clean up DslSearchBar setTimeout | `DslSearchBar.vue` | Trivial |
| 15 | `v-show` for frequently toggled panels | `FilterDrawer.vue`, `LogViewer.vue` | Small |

---

## Research Sources

### Vue 3 Performance
- [Vue.js Performance Guide](https://vuejs.org/guide/best-practices/performance)
- [Vue.js Reactivity Advanced API — shallowRef](https://vuejs.org/api/reactivity-advanced.html)
- [Lazy Load Components with defineAsyncComponent](https://learnvue.co/articles/lazy-load-components)

### Vuetify 3
- [Vuetify Global Configuration](https://vuetifyjs.com/en/features/global-configuration/)
- [Vuetify Defaults Provider](https://vuetifyjs.com/en/components/defaults-providers/)

### Electron / VS Code
- [Electron Performance Documentation](https://www.electronjs.org/docs/latest/tutorial/performance)
- [How Slack, Notion, and VS Code Improved Electron Performance](https://palette.dev/blog/improving-performance-of-electron-apps)
- [VS Code Architecture Guide](https://thedeveloperspace.com/vs-code-architecture-guide/)

### Perceived Performance / UX
- [NN/G Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [Skeleton Screens vs Loading Spinners](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [Optimistic UI Patterns](https://simonhearne.com/2021/optimistic-ui-patterns/)

### CSS Performance
- [content-visibility (web.dev)](https://web.dev/articles/content-visibility)
- [CSS Containment (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Using)
- [Material Design 3 Motion Tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- [CSS GPU Acceleration Guide](https://www.lexo.ch/blog/2025/01/boost-css-performance-with-will-change-and-transform-translate3d-why-gpu-acceleration-matters/)
