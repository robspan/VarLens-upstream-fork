# VarLens Performance Optimization Report

**Date:** 2025-03-25
**Goal:** Identify and fix bottlenecks preventing the "instant/snappy" feel comparable to VS Code

---

## Executive Summary

The main performance issues fall into three categories:
1. **Bundle bloat** (15MB renderer, 7.1MB plotly, 3MB+ icon fonts, all Vuetify components loaded)
2. **Missing lazy patterns** (no route splitting, no async components, all dialogs mounted eagerly)
3. **Rendering micro-inefficiencies** (tooltips in every table cell, missing `contain` CSS, no `backgroundColor` on window)

The single biggest wins are: switching Vuetify to tree-shaken auto-import (saves ~1MB JS + ~800KB CSS), switching from `@mdi/font` to `@mdi/js` (saves ~3MB font files), and lazy-loading dialogs and the cohort route.

---

## 1. Vuetify Full Import (HIGH IMPACT)

**File:** `src/renderer/src/plugins/vuetify.ts:2-3`

```typescript
import * as components from 'vuetify/components'   // ALL components
import * as directives from 'vuetify/directives'    // ALL directives
```

This imports **every** Vuetify component into the bundle even if unused. The project already has `vite-plugin-vuetify` with `autoImport: true` in `electron.vite.config.ts:41`, which makes the manual import redundant.

### Recommendation

```typescript
// REMOVE these two lines:
// import * as components from 'vuetify/components'
// import * as directives from 'vuetify/directives'

export default createVuetify({
  // REMOVE: components,
  // REMOVE: directives,
  theme: { ... },
  icons: { ... },
  defaults: { ... }
})
```

With `autoImport: true`, `vite-plugin-vuetify` will tree-shake and only include components actually used in templates. This alone should reduce the JS bundle by **~500KB-1MB** and CSS by **~500-800KB**.

**Effort:** Low (5 min change)
**Impact:** High (significant bundle reduction, faster parse/eval)

---

## 2. Icon Font vs SVG Icons (HIGH IMPACT)

**File:** `src/renderer/src/plugins/vuetify.ts:6`

```typescript
import '@mdi/font/css/materialdesignicons.css'
```

This loads the full Material Design Icons **web font** (3.5MB font files + 1.7MB CSS). The app uses ~100 unique icons out of 7,000+ in the set.

### Recommendation

Switch to `@mdi/js` (tree-shakeable SVG paths):

```typescript
// vuetify.ts
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
// REMOVE: import '@mdi/font/css/materialdesignicons.css'

// In components, import only needed icons:
import { mdiPlus, mdiFilter } from '@mdi/js'
```

This is a larger migration (329 icon usages across 83 files) but eliminates ~4MB of font assets.

**Alternative quick-win:** Use `@mdi/light-font` (subset) or a custom subset build with `@mdi/font` that includes only the ~100 icons actually used. Tools like [webfont-dl](https://github.com/nicolo-ribaudo/webfont-dl) or Fontello can create custom subsets.

**Effort:** High (full migration) / Medium (subset font)
**Impact:** High (4MB less to load/parse)

---

## 3. No Route-Level Code Splitting (MEDIUM IMPACT)

**File:** `src/renderer/src/router/index.ts:1-2`

```typescript
import CaseView from '../views/CaseView.vue'
import CohortView from '../views/CohortView.vue'
```

Both views are eagerly imported. CohortView (and its entire dependency tree including association analysis, charts, gene burden) loads even when the user only uses Case mode.

### Recommendation

```typescript
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/case' },
    {
      path: '/case',
      name: 'case',
      component: () => import('../views/CaseView.vue')
    },
    {
      path: '/cohort',
      name: 'cohort',
      component: () => import('../views/CohortView.vue')
    }
  ]
})
```

**Effort:** Low (2 min)
**Impact:** Medium (defers loading of cohort code until needed)

---

## 4. Eager Dialog Mounting (MEDIUM IMPACT)

**File:** `src/renderer/src/components/AppDialogHost.vue:1-14`

All 10+ dialogs (ImportDialog, BatchImportDialog, LogViewer, FaqDialog, ExternalLinksSettings, TagManagementDialog, DatabaseOverviewDialog, DeleteAllCasesDialog, CaseMetadataModal, DisclaimerDialog) are mounted immediately in the DOM, even though most are rarely opened.

### Recommendation

Use `defineAsyncComponent` + `v-if` with dialog open state:

```typescript
import { defineAsyncComponent } from 'vue'

const FaqDialog = defineAsyncComponent(() => import('./FaqDialog.vue'))
const ExternalLinksSettings = defineAsyncComponent(() => import('./ExternalLinksSettings.vue'))
const TagManagementDialog = defineAsyncComponent(() => import('./TagManagementDialog.vue'))
const DatabaseOverviewDialog = defineAsyncComponent(() => import('./DatabaseOverviewDialog.vue'))
const DeleteAllCasesDialog = defineAsyncComponent(() => import('./DeleteAllCasesDialog.vue'))
// etc.
```

And gate them with `v-if`:
```html
<FaqDialog v-if="faqOpen" ref="faqDialogRef" />
```

**Effort:** Medium (need to add open/closed state tracking)
**Impact:** Medium (fewer components in initial render tree, less memory)

---

## 5. Missing `backgroundColor` on BrowserWindow (LOW-MEDIUM IMPACT)

**File:** `src/main/index.ts:38-51`

The window has no `backgroundColor` set. This means users see a white flash (or transparent/black flash on some platforms) before the renderer paints.

### Recommendation

```typescript
const mainWindow = new BrowserWindow({
  width: APP_CONFIG.WINDOW_WIDTH,
  height: APP_CONFIG.WINDOW_HEIGHT,
  show: false,
  backgroundColor: '#faf8f6',  // Match warmLight theme surface color
  title: 'Varlens',
  // ...
})
```

This eliminates the flash between window creation and first paint.

**Effort:** Trivial (1 line)
**Impact:** Noticeable perceived speed improvement on launch

---

## 6. Table Cell Tooltip Overhead (MEDIUM IMPACT)

**Files:** `src/renderer/src/components/VariantTable.vue` + `src/renderer/src/components/table-cells/*.vue`

The variant table renders tooltips on many cells (AnnotationsCell has 6, ClinVarCell has 4, ConsequenceCell has 4, etc.). Each `v-tooltip` creates a Vuetify overlay component with event listeners. For a table page of 50 rows x multiple columns, this means **hundreds of tooltip component instances**.

### Recommendation

1. **Use native `title` attribute** for simple text tooltips instead of `v-tooltip`:
   ```html
   <!-- Instead of v-tooltip wrapper -->
   <span :title="value">{{ truncated }}</span>
   ```

2. **Use a single delegated tooltip** for the table (one tooltip component that repositions on hover via event delegation):
   ```typescript
   // Single tooltip, positioned on hover via mouseenter event delegation
   const tooltipText = ref('')
   const tooltipTarget = ref<HTMLElement | null>(null)
   ```

3. **At minimum, use `open-on-hover` with `open-delay="300"`** on remaining v-tooltips to reduce overlay creation.

**Effort:** Medium
**Impact:** Medium (fewer component instances = less memory, faster re-renders)

---

## 7. Row Transition Overhead (LOW IMPACT)

**File:** `src/renderer/src/components/VariantTable.vue:667`

```css
:deep(.v-data-table tbody tr) {
  cursor: pointer;
  transition: background-color 0.15s ease;
}
```

CSS transitions on every table row trigger compositor work on hover. For large tables, this adds up.

### Recommendation

Use `will-change: background-color` or remove the transition entirely (instant hover feels snappier than animated hover in data-dense UIs like VS Code):

```css
:deep(.v-data-table tbody tr) {
  cursor: pointer;
  /* Remove transition for instant response */
}
```

**Effort:** Trivial
**Impact:** Low (but contributes to snappy feel)

---

## 8. CSS `contain` for Table Performance (MEDIUM IMPACT)

The variant table and its cells lack CSS containment hints.

### Recommendation

Add containment to improve layout/paint performance:

```css
.table-container {
  contain: strict;  /* Layout, paint, and size containment */
}

:deep(.v-data-table tbody td) {
  contain: content;  /* Each cell is independent */
}
```

`contain: content` tells the browser that each cell's contents don't affect the layout of other cells, enabling significant paint optimizations.

**Effort:** Trivial
**Impact:** Medium (especially with many columns/rows)

---

## 9. Annotation Cache Uses `ref()` Instead of `shallowRef()` (LOW-MEDIUM IMPACT)

**File:** `src/renderer/src/composables/useAnnotations.ts:26-29`

```typescript
const annotationCache = ref<Map<string, AnnotationCache>>(new Map())
const loadingStates = ref<Map<string, boolean>>(new Map())
```

Using `ref()` on a Map makes Vue deeply track every entry. With up to 5000 cached annotations, this creates thousands of reactive proxies.

### Recommendation

```typescript
const annotationCache = shallowRef<Map<string, AnnotationCache>>(new Map())
const loadingStates = shallowRef<Map<string, boolean>>(new Map())
```

Then trigger reactivity manually when updating:
```typescript
function cacheSet(key: string, value: AnnotationCache): void {
  const cache = new Map(annotationCache.value)  // or triggerRef()
  cache.set(key, value)
  annotationCache.value = cache
}
```

Or use `triggerRef(annotationCache)` after mutations.

**Effort:** Low
**Impact:** Low-Medium (reduces reactive proxy overhead for large caches)

---

## 10. `JSON.parse(JSON.stringify(...))` for IPC Serialization (LOW IMPACT)

**File:** `src/renderer/src/components/variant-table/useVariantData.ts:55-56`

```typescript
const plainFilters = JSON.parse(JSON.stringify({ ...rawFilters, ... }))
```

This is done on every page load/filter change. While necessary to strip reactive proxies, `structuredClone()` or `toRaw()` + spread is faster.

### Recommendation

```typescript
import { toRaw } from 'vue'

const plainFilters = structuredClone(toRaw(filters.value))
// or for simple objects:
const plainFilters = { ...toRaw(filters.value), column_filters: { ... } }
```

`structuredClone` is 2-5x faster than `JSON.parse(JSON.stringify(...))` for typical objects. Even better, `toRaw()` + spread avoids cloning entirely for flat objects.

**Effort:** Low
**Impact:** Low (but runs on every query)

---

## 11. Deep Watcher on Column Filters (ALREADY MITIGATED)

**File:** `src/renderer/src/components/variant-table/useVariantData.ts:139`

```typescript
watch(columnFilterState.columnFilters, debouncedColumnFilterReload, { deep: true })
```

This is already debounced (300ms), which is good. However, consider using a serialized key approach (like `filterKey` on line 134) instead of deep watching to avoid Vue traversing the entire filter object tree on every change.

---

## 12. Plotly.js Bundle Size (ALREADY LAZY, BUT LARGE)

**Files:** `ManhattanPlot.vue:30`, `VolcanoPlot.vue:28`

Plotly is correctly lazy-imported (`await import('plotly.js-dist-min')`), but produces a 7.1MB chunk. Consider:

1. **`plotly.js-basic-dist-min`** (~1MB) if you only need scatter/bar charts
2. **Custom Plotly bundle** with only the trace types you use
3. **Alternative:** For Manhattan/Volcano plots specifically, a lightweight canvas-based library (e.g., `@observablehq/plot` or raw Canvas2D) would be 10-100x smaller

**Effort:** Medium-High
**Impact:** Medium (only affects cohort/association views, already lazy)

---

## 13. V8 Code Caching Not Enabled (LOW IMPACT)

**File:** `src/main/index.ts:45-49`

Electron supports V8 code caching which stores compiled JavaScript bytecode so subsequent launches skip parsing/compiling.

### Recommendation

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  v8CacheOptions: 'bypassHeatCheck'  // Cache from first load
}
```

**Effort:** Trivial (1 line)
**Impact:** Low (faster subsequent launches)

---

## 14. Import Status Store Ticks Every Second (MEDIUM IMPACT)

**File:** `src/renderer/src/stores/importStatusStore.ts`

The store uses a `setInterval` updating `elapsedTick` every 1 second to drive elapsed time display. This fires continuously during any import, triggering Vue reactive updates and redraws even if the import status bar is barely visible.

### Recommendation

- Only tick when the import status UI is visible (use Intersection Observer or `v-if`)
- Or use `requestAnimationFrame` instead of `setInterval` with a visibility check
- Or compute elapsed time on-demand from `startTime` rather than incrementing a counter

**Effort:** Low
**Impact:** Medium (eliminates continuous 1Hz reactive updates during imports)

---

## 15. CaseList `getCaseCohorts()` Called Repeatedly in Template (MEDIUM IMPACT)

**File:** `src/renderer/src/components/CaseList.vue:106-115`

```html
<v-chip v-for="cohort in getCaseCohorts(caseItem.id).slice(0, 3)" ...>
<!-- later: -->
<span v-if="getCaseCohorts(caseItem.id).length - 3 > 0">...</span>
```

`getCaseCohorts()` is called 2-3 times per row on every render. This isn't cached as a computed — it's a method call in the template.

### Recommendation

Pre-compute cohorts per case using a computed map:

```typescript
const caseCohortMap = computed(() => {
  const map = new Map<number, Cohort[]>()
  for (const c of cases.value) {
    map.set(c.id, getCaseCohorts(c.id))
  }
  return map
})
```

Then use `caseCohortMap.get(caseItem.id)` in the template.

**Effort:** Low
**Impact:** Medium (eliminates redundant lookups per render cycle)

---

## 16. GeneBurdenTable Loads All Data Without Pagination (MEDIUM IMPACT)

**File:** `src/renderer/src/components/GeneBurdenTable.vue:113-114`

The gene burden table loads the entire dataset on mount via `onMounted(loadGeneBurden)` with no pagination or virtual scrolling. For large databases this can be thousands of rows.

### Recommendation

Add server-side pagination (like VariantTable already does) or use `v-data-table-virtual` for client-side virtualization.

**Effort:** Medium
**Impact:** Medium (prevents freeze on large datasets)

---

## 17. Renderer Build Config Missing Code Splitting (LOW-MEDIUM IMPACT)

**File:** `electron.vite.config.ts:31-45`

The renderer build section has no `rollupOptions.output.manualChunks` configuration. Vite's default chunking may produce suboptimal splits.

### Recommendation

```typescript
renderer: {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vuetify': ['vuetify'],
          'vue-vendor': ['vue', 'vue-router', 'pinia']
        }
      }
    }
  },
  // ... existing config
}
```

This separates vendor code (rarely changes) from app code (changes often), improving cache efficiency and making app updates smaller.

**Effort:** Low
**Impact:** Low-Medium (better chunk caching on updates)

---

## 18. Defer Auto-Updater Initialization (LOW IMPACT)

**File:** `src/main/index.ts`

Auto-updater and update checks should be deferred until after the window is shown, so they don't compete with app startup.

### Recommendation

```typescript
mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  // Defer non-critical init
  setImmediate(() => {
    initAutoUpdater()
    scheduleUpdateChecks()
  })
})
```

**Effort:** Trivial
**Impact:** Low (slightly faster perceived launch)

---

## 19. ManhattanPlot/VolcanoPlot Deep Watch on Results (LOW-MEDIUM IMPACT)

**Files:** `ManhattanPlot.vue:117`, `VolcanoPlot.vue:108`

```typescript
watch(() => props.results, render, { deep: true })
```

Deep-watching large result arrays to trigger expensive Plotly re-renders. A shallow comparison (reference equality) would suffice since results are replaced wholesale, not mutated.

### Recommendation

Remove `{ deep: true }` — the parent already replaces the entire array when results change:

```typescript
watch(() => props.results, render)  // shallow is sufficient
```

**Effort:** Trivial
**Impact:** Low-Medium (avoids deep-traversing large arrays)

---

## 20. `<KeepAlive>` for Route Views (MEDIUM IMPACT)

**File:** `src/renderer/src/App.vue:39-41`

```html
<v-main>
  <router-view />
</v-main>
```

When switching between Case and Cohort views, the entire component tree is destroyed and rebuilt. Using `<KeepAlive>` would preserve the DOM and component state.

### Recommendation

```html
<v-main>
  <router-view v-slot="{ Component }">
    <keep-alive :max="2">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</v-main>
```

**Effort:** Low
**Impact:** Medium (instant tab switching, preserves scroll position and filter state)

---

## 21. All Chip Animations (LOW IMPACT)

**File:** `src/renderer/src/assets/styles/custom.css:142-175`

```css
.v-chip {
  transition: box-shadow 0.15s ease, transform 0.15s ease !important;
}

.applied-filters-bar .v-chip {
  animation: chipEnter 0.15s ease-out;
}
```

Global transitions on all chips add compositor work. Filter bar chips trigger entrance animations on every filter change.

### Recommendation

Remove the global chip transition. Keep animations only where they provide genuine UX value (not on static chips in tables).

---

## Priority Action Plan

### Quick Wins (< 1 hour, do first)
| # | Change | File | Impact |
|---|--------|------|--------|
| 1 | Add `backgroundColor: '#faf8f6'` to BrowserWindow | `src/main/index.ts` | Perceived launch speed |
| 2 | Remove `import * as components/directives` (rely on auto-import) | `src/renderer/src/plugins/vuetify.ts` | **~1-2MB bundle reduction** |
| 3 | Lazy-load CohortView route | `src/renderer/src/router/index.ts` | Faster initial load |
| 4 | Remove table row hover transitions | `VariantTable.vue` CSS | Snappier hover feel |
| 5 | Add `contain: content` to table cells | `VariantTable.vue` CSS | Paint performance |
| 6 | Switch `annotationCache` to `shallowRef` | `useAnnotations.ts` | Less reactive overhead |
| 7 | Replace `JSON.parse(JSON.stringify())` with `structuredClone(toRaw())` | `useVariantData.ts` | Faster serialization |
| 8 | Add `v8CacheOptions: 'bypassHeatCheck'` | `src/main/index.ts` | Faster subsequent launches |
| 9 | Remove `{ deep: true }` from plot watchers | `ManhattanPlot.vue`, `VolcanoPlot.vue` | Avoid deep array traversal |
| 10 | Add `<KeepAlive>` around router-view | `App.vue` | Instant view switching |
| 11 | Cache `getCaseCohorts()` per case | `CaseList.vue` | Eliminate redundant lookups |
| 12 | Defer auto-updater to after window show | `src/main/index.ts` | Faster perceived launch |

### Medium-Term (1-4 hours)
| # | Change | Impact |
|---|--------|--------|
| 13 | `defineAsyncComponent` for rarely-used dialogs | Faster initial render |
| 14 | Replace v-tooltip with native `title` in table cells | Fewer component instances |
| 15 | Switch to `@mdi/js` SVG icons (or create font subset) | **~4MB less assets** |
| 16 | Add `manualChunks` to renderer build config | Better chunk caching |
| 17 | Fix importStatusStore 1-second tick | Eliminate continuous reactive updates |
| 18 | Paginate GeneBurdenTable | Prevent freeze on large datasets |

### Longer-Term
| # | Change | Impact |
|---|--------|--------|
| 19 | Replace plotly.js-dist-min with plotly.js-basic-dist-min or custom bundle | 6MB less (lazy chunk) |
| 20 | Consider virtual scrolling for variant table if pages > 100 rows | DOM node reduction |

---

## How to Measure Progress

1. **Build size**: `ls -lhS out/renderer/assets/` before/after
2. **Time to Interactive**: Electron DevTools Performance tab, measure from `ready-to-show` to first paint
3. **Component count**: Vue DevTools > Performance > component render count
4. **Memory**: Electron DevTools > Memory > heap snapshot before/after optimizations

---

## References

- [Vue 3 Performance Guide](https://vuejs.org/guide/best-practices/performance.html) - shallowRef, v-memo, async components
- [Vuetify Tree Shaking](https://vuetifyjs.com/en/features/treeshaking/) - vite-plugin-vuetify auto-import
- [Electron Performance Tips](https://www.electronjs.org/docs/latest/tutorial/performance) - backgroundColor, preload optimization
- [CSS Containment](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment) - contain property for layout performance
- [@mdi/js Migration](https://pictogrammers.com/docs/library/mdi/getting-started/vuetify/) - SVG icon tree-shaking
