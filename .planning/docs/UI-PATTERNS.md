# UI Patterns - VarLens

Prescriptive guidance for Vuetify component patterns in the VarLens codebase.

> **For AI assistants:** This document provides definitive patterns. When implementing UI components, follow these patterns exactly.

**Last updated:** 2026-03-29 — reflects Clinical Slate theme (v0.43.0+), unified import wizard, protein visualization modal.

## Quick Reference

| Pattern | Use | Avoid | Why |
|---------|-----|-------|-----|
| Subtle background | `bg-grey-lighten-3` | Hardcoded hex in templates | Consistent, works in both themes |
| Strong contrast | `secondary` (#455A64) | Hardcoded dark colors | Theme-aware |
| Hover states | `color-mix(in srgb, ...)` | Raw theme CSS variables | Theme-aware opacity mixing |
| Dialog structure | `v-dialog > v-card` | Nested cards or raw content | Consistent, proper focus trap |
| Side panel structure | `v-navigation-drawer > v-card` | Bare drawer | Consistent layout with toolbar |
| Density | Global default `compact` | Overriding to default density | Data-dense research UX |
| Form inputs | `variant="outlined"` | `variant="filled"` or default | Global default, consistent look |

---

## Theme: Clinical Slate

VarLens uses the **Clinical Slate** theme — a cool-toned, WCAG 2.1 AA+ compliant design inspired by NCBI/ClinVar/Broad Institute design language. Both light and dark variants are defined.

### Light Theme (warmLight)

| Token | Value | Contrast on surface | Usage |
|-------|-------|-------------------|-------|
| `primary` | #1E3A5F (slate navy) | 11.1:1 (AAA) | Primary actions, active states, selection |
| `secondary` | #455A64 (blue-grey) | 7.0:1 (AAA) | Strong contrast elements, tooltips |
| `surface` | #FAFBFD | — | Main content background |
| `surface-variant` | #ECF0F4 | — | Adequate contrast with surface (usable, but prefer `bg-grey-lighten-3` for consistency) |
| `background` | #F0F4F8 | — | Page background |
| `on-surface` | #1A1D23 | 16.3:1 (AAA) | Text on surface |
| `error` | #B71C1C (deep red) | 6.3:1 (AA) | Error states |
| `info` | #1565C0 (blue) | 5.5:1 (AA) | Informational messages |
| `success` | #1B5E20 (dark green) | 7.6:1 (AAA) | Success states |
| `warning` | #BF360C (deep orange) | 5.4:1 (AA) | Warning states |

### Dark Theme (warmDark)

| Token | Value | Contrast on surface | Usage |
|-------|-------|-------------------|-------|
| `primary` | #7BAED4 (light slate blue) | 7.1:1 (AAA) | Primary actions |
| `secondary` | #90A4AE (light blue-grey) | 6.5:1 (AA) | Strong contrast elements |
| `surface` | #1A1D22 | — | Main content background |
| `surface-variant` | #252A32 | — | Subtle contrast |
| `background` | #12141A | — | Page background |
| `on-surface` | #E4E7EC | 13.6:1 (AAA) | Text on surface |

### Status/Semantic Colors

Use Vuetify's semantic color names for status indicators:

| Purpose | Color | Example |
|---------|-------|---------|
| Success | `success` | Import complete alerts |
| Error | `error` | Validation errors, failures |
| Warning | `warning` | Cautions |
| Info | `info` | Informational messages |
| Primary | `primary` | Primary actions, badges, selection |
| Secondary | `secondary` | Strong contrast, tooltips |

---

## Global Defaults

Density, variants, and other defaults are set globally in `src/renderer/src/plugins/vuetify.ts` via Vuetify's `defaults` config. You do **not** need to add these props manually unless overriding:

```typescript
defaults: {
  global: { density: 'compact', ripple: false },
  VBtn: { density: 'compact', ripple: false },
  VTextField: { density: 'compact', variant: 'outlined' },
  VSelect: { density: 'compact', variant: 'outlined', transition: 'fade-transition' },
  VAutocomplete: { density: 'compact', variant: 'outlined', transition: 'fade-transition' },
  VDataTable: { density: 'compact' },
  VCard: { elevation: 1 },
  VCardTitle: { class: 'text-subtitle-1 font-weight-medium' },
  VDialog: { eager: false },
  VList: { density: 'compact' },
  VListItem: { density: 'compact' },
  VListSubheader: { class: 'text-overline font-weight-bold' },
  VMenu: { transition: 'fade-transition', openDelay: 0, closeDelay: 0 },
  VExpansionPanel: { elevation: 0 },
  VTooltip: { openDelay: 400, closeDelay: 0, transition: 'fade-transition', contentClass: 'bg-secondary' },
  VNavigationDrawer: { disableResizeWatcher: true },
  VSnackbar: { transition: 'fade-transition' },
}
```

**Key implications:**
- `density="compact"` is the default everywhere — don't add it unless emphasizing intent
- All menus/tooltips/snackbars use `fade-transition` (no slide animations)
- Tooltips have 400ms open delay and dark (`bg-secondary`) background
- Cards have `elevation: 1` by default
- Text fields and selects use `variant="outlined"` by default

---

## Color Patterns

### Background Colors

#### Subtle Contrast (nested tables, expanded rows, filter bars)

**DO:**
```vue
<div class="bg-grey-lighten-3">
  <!-- Content with visible subtle grey background -->
</div>
```

#### Strong Contrast (toolbars, tabs, headers)

**DO:**
```vue
<v-toolbar color="secondary">
  <!-- Dark toolbar (#455A64 light / #90A4AE dark) -->
</v-toolbar>
```

### Hover States — color-mix() Pattern

VarLens uses CSS `color-mix()` for theme-aware hover states. This works correctly in both light and dark themes.

**DO:** (from `data-table-shared.css`)
```css
/* Zebra striping */
.variant-row--striped {
  background-color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 3.5%, transparent);
}

/* Hover state */
tr:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent) !important;
}

/* Selected row */
.variant-row--selected {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent) !important;
  border-left: 4px solid rgb(var(--v-theme-primary)) !important;
}

/* Selected + hover */
.variant-row--selected:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent) !important;
}
```

**Also acceptable** for simple borders/shadows:
```css
border-top: 1px solid rgba(0, 0, 0, 0.12);
```

**DO NOT:**
```css
/* WRONG: Raw theme variable without color-mix, may produce poor results */
background: rgb(var(--v-theme-surface-variant));

/* WRONG: Hardcoded hex in hover states — breaks dark theme */
background: #f0f0f0;
```

---

## Container Patterns

### Dialog Structure

All dialogs follow `v-dialog > v-card` pattern:

```vue
<v-dialog v-model="dialog" max-width="500" :persistent="isLoading">
  <v-card>
    <v-card-title>Dialog Title</v-card-title>
    <v-card-text>
      <!-- Main content -->
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn @click="dialog = false">Cancel</v-btn>
      <v-btn color="primary" @click="handleAction">Confirm</v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```

**Key points:**
- `max-width` constrains dialog size (common values: 400, 500, 600)
- `:persistent="true"` during loading prevents accidental dismissal
- `v-card-actions` always has `<v-spacer />` to right-align buttons
- Cancel button comes before primary action button

**Real examples:** `DeleteCaseDialog.vue`, `PresetSaveDialog.vue`, `CreateDatabaseDialog.vue`

### Fullscreen Dialog Variant

For complex visualizations or multi-step workflows that need maximum space:

```vue
<v-dialog v-model="dialog" fullscreen>
  <v-card class="d-flex flex-column">
    <v-toolbar color="secondary" density="compact">
      <v-btn icon @click="dialog = false">
        <v-icon>mdi-close</v-icon>
      </v-btn>
      <v-toolbar-title>Full Screen Title</v-toolbar-title>
    </v-toolbar>

    <div class="flex-grow-1" style="min-height: 0">
      <!-- Content fills remaining space -->
    </div>
  </v-card>
</v-dialog>
```

**Key points:**
- `fullscreen` prop replaces `max-width`
- Close button in toolbar (not in card-actions)
- `flex-grow-1` + `min-height: 0` for content area to fill space
- Secondary-colored toolbar for strong visual header

**Real example:** `ProteinVisualizationModal.vue`

### Multi-Step Dialog (Import Wizard)

For workflows with distinct steps:

```vue
<v-dialog v-model="dialog" max-width="700" :persistent="isImporting">
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-import</v-icon>
      Wizard Title
    </v-card-title>

    <!-- Step indicator -->
    <div class="d-flex justify-center ga-2 py-2">
      <v-chip
        v-for="(label, i) in steps"
        :key="i"
        :color="i === currentStep ? 'primary' : undefined"
        :variant="i === currentStep ? 'flat' : 'outlined'"
        size="small"
      >
        {{ label }}
      </v-chip>
    </div>

    <v-divider />

    <v-card-text>
      <!-- Step content (conditional rendering) -->
      <template v-if="currentStep === 0">...</template>
      <template v-else-if="currentStep === 1">...</template>
    </v-card-text>

    <v-card-actions>
      <v-spacer />
      <v-btn v-if="canGoBack" @click="prevStep">Back</v-btn>
      <v-btn color="primary" @click="nextStep">
        {{ isLastStep ? 'Finish' : 'Next' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```

**Key points:**
- Step chips show progress (primary = current, outlined = other)
- `:persistent="true"` during active processing
- Back/Next navigation in card-actions
- Divider between step indicator and content

**Real example:** `ImportWizard.vue`

### Side Panel Structure

Side panels use `v-navigation-drawer > v-card`:

```vue
<v-navigation-drawer
  :model-value="open"
  location="right"
  temporary
  :persistent="true"
  :scrim="false"
  :width="panelWidth"
  @update:model-value="emit('update:open', $event)"
>
  <v-card flat class="h-100 d-flex flex-column">
    <!-- Header with close button -->
    <v-toolbar color="transparent" density="compact" flat>
      <v-toolbar-title class="text-body-large">Panel Title</v-toolbar-title>
      <v-btn icon size="small" @click="emit('update:open', false)">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-toolbar>

    <v-divider />

    <!-- Scrollable content -->
    <div class="flex-grow-1 overflow-y-auto pa-3">
      <!-- Panel content -->
    </div>
  </v-card>
</v-navigation-drawer>
```

**Key points:**
- `temporary` for overlay behavior
- `:scrim="false"` prevents background dimming
- `v-card flat` removes card shadow
- `h-100 d-flex flex-column` for full-height layout
- Content area uses `flex-grow-1 overflow-y-auto` for scrolling

**Real examples:** `VariantDetailsPanel.vue`, `ColumnsDrawer.vue`, `FilterDrawer.vue`

### Nested Tables

Nested tables (expanded rows, sub-data) use `bg-grey-lighten-3`:

```vue
<tr>
  <td :colspan="colspan" class="pa-0">
    <v-table density="compact" class="nested-carriers-table bg-grey-lighten-3">
      <thead>
        <tr>
          <th class="text-left">Column 1</th>
          <th class="text-left">Column 2</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.col1 }}</td>
          <td>{{ item.col2 }}</td>
        </tr>
      </tbody>
    </v-table>
  </td>
</tr>
```

**Key points:**
- Parent `<td>` uses `class="pa-0"` to remove padding
- `v-table density="compact"` for data-dense display
- `bg-grey-lighten-3` provides visible nesting contrast
- Add `border-top` in scoped CSS if visual separation needed

**Real example:** `cohort/CarrierExpandedRow.vue`

---

## Data Table Patterns

### Shared CSS (data-table-shared.css)

All data tables (`VariantTable`, `CohortDataTable`) share common styles via `data-table-shared.css`. Import it as a non-scoped style block:

```vue
<style src="./data-table-shared.css"></style>
<style scoped>
  /* Component-specific overrides */
</style>
```

**Provided styles:**
- Flex layout filling available height
- Synchronized top + bottom scrollbars
- Zebra striping (3.5% on-surface mix)
- Selected row highlighting (12% primary mix + left border)
- Hover states (8% primary mix)
- HGVS monospace notation
- Column max-width with ellipsis overflow
- CSS containment (`contain: layout style`) on cells
- Styled scrollbars (thin, subtle)

### Column Overflow

```css
/* Applied globally by data-table-shared.css */
.v-data-table th,
.v-data-table td {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

## Tabbed Interfaces

```vue
<v-tabs v-model="activeTab" density="compact" color="primary">
  <v-tab value="tab1">Tab One</v-tab>
  <v-tab value="tab2">Tab Two</v-tab>
  <v-tab value="tab3">Tab Three</v-tab>
</v-tabs>

<v-tabs-window v-model="activeTab">
  <v-tabs-window-item value="tab1">
    <!-- Tab 1 content -->
  </v-tabs-window-item>
  <v-tabs-window-item value="tab2">
    <!-- Tab 2 content -->
  </v-tabs-window-item>
</v-tabs-window>
```

**Key points:**
- `color="primary"` for active tab indicator
- `density="compact"` for data-dense UX
- Use `v-tabs-window` / `v-tabs-window-item` (not deprecated `v-window`)

**Real examples:** `VariantDetailsPanel.vue`, `ProteinVisualizationModal.vue`, `CohortView.vue`

---

## Expansion Panels

```vue
<v-expansion-panels multiple variant="accordion">
  <v-expansion-panel>
    <v-expansion-panel-title>Section Title</v-expansion-panel-title>
    <v-expansion-panel-text>
      <!-- Section content -->
    </v-expansion-panel-text>
  </v-expansion-panel>
</v-expansion-panels>
```

**Key points:**
- `multiple` allows opening several panels at once
- `variant="accordion"` for bordered, stacked look
- `elevation: 0` is the global default (no shadow)

**Real examples:** `FilterDrawer.vue`, `CohortFilterDrawer.vue`, `ExternalLinksSettings.vue`

---

## Component Patterns

### Chips

```vue
<!-- Status chip -->
<v-chip size="x-small" :color="statusColor" label>
  {{ statusText }}
</v-chip>

<!-- Count badge -->
<v-chip size="x-small" variant="tonal" :color="groupColor">
  {{ selected }}/{{ total }}
</v-chip>
```

**Key points:**
- `size="x-small"` for inline status indicators
- `label` prop for squared corners (better for status tags)
- `variant="tonal"` for softer appearance in counts

### Buttons

```vue
<!-- Primary action -->
<v-btn color="primary" @click="handleAction">
  Action
</v-btn>

<!-- Secondary/Cancel -->
<v-btn @click="handleCancel">
  Cancel
</v-btn>

<!-- Icon button -->
<v-btn icon size="small" @click="handleClick">
  <v-icon>mdi-close</v-icon>
</v-btn>

<!-- Text button (compact) -->
<v-btn size="small" variant="text" @click="handleClick">
  Text Action
</v-btn>
```

### Alerts

```vue
<!-- Error alert -->
<v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-4">
  {{ errorMessage }}
</v-alert>

<!-- Warning alert -->
<v-alert v-if="hasWarning" type="warning" variant="tonal" class="mb-3">
  {{ warningMessage }}
</v-alert>

<!-- Info alert -->
<v-alert type="info" variant="tonal" density="compact">
  {{ infoMessage }}
</v-alert>
```

**Key points:**
- `variant="tonal"` for softer, less alarming appearance
- `density="compact"` for inline alerts
- Standard `type` values: `error`, `warning`, `info`, `success`

---

## Spacing Patterns

### Padding and Margins

Use Vuetify spacing utilities:

| Size | Value | Common Use |
|------|-------|------------|
| `pa-2` | 8px | Table cells, compact containers |
| `pa-3` | 12px | Panel content areas |
| `pa-4` | 16px | Card content, spacious layouts |
| `mb-2` | 8px margin-bottom | Between form fields |
| `mb-4` | 16px margin-bottom | Between sections |
| `mr-2` | 8px margin-right | Icon spacing in buttons |
| `ga-2` | 8px gap | Flex gap between items |

### Common Layout Classes

```vue
<!-- Full height flex column (panels) -->
<div class="h-100 d-flex flex-column">

<!-- Scrollable content area -->
<div class="flex-grow-1 overflow-y-auto">

<!-- Centered content -->
<div class="d-flex align-center justify-center">

<!-- Inline elements with gap spacing -->
<div class="d-flex align-center ga-2">
```

---

## Anti-Patterns

### NEVER Use

1. **Hardcoded hex colors in templates**
   - Use Vuetify color names or CSS variables
   - Exception: `rgba()` values in scoped CSS for borders/shadows

2. **Raw theme CSS variables for backgrounds without `color-mix()`**
   - `rgb(var(--v-theme-surface-variant))` — use `color-mix()` instead
   - Ensures proper opacity blending in both themes

3. **Bare content in dialogs**
   - Always wrap in `v-card` inside `v-dialog`
   - Ensures proper structure and accessibility

4. **Overriding density to default**
   - VarLens is data-dense research software
   - Global default is `compact` — don't change it

5. **Slide transitions on menus/tooltips**
   - All transitions are `fade-transition` globally
   - Don't add `transition="slide-y-transition"` etc.

### Common Mistakes

```css
/* WRONG: Raw theme variable without color-mix */
.item:hover {
  background: rgb(var(--v-theme-surface-variant));
}

/* RIGHT: Theme-aware with opacity */
.item:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
}
```

```vue
<!-- WRONG: Missing card wrapper -->
<v-dialog v-model="dialog">
  <div>Content</div>
</v-dialog>

<!-- RIGHT: Proper structure -->
<v-dialog v-model="dialog">
  <v-card>
    <v-card-text>Content</v-card-text>
  </v-card>
</v-dialog>
```

---

## Accessibility Notes

### Contrast

All semantic colors in Clinical Slate meet WCAG 2.1 AA or AAA on their respective surfaces. Primary (#1E3A5F) achieves 11.1:1 — well above the 4.5:1 AA minimum for normal text.

### Focus Management

- Dialogs automatically trap focus
- `:persistent="true"` during loading prevents escape key dismissal
- Side panels should have close button with `@click="emit('update:open', false)"`
- Focus rings: 2px outline on interactive elements (defined in `custom.css`)

### ARIA Labels

```vue
<!-- Combobox pattern -->
<v-text-field
  role="combobox"
  :aria-expanded="menuOpen"
  :aria-label="label + (hasSelection ? ` (${count} selected)` : '')"
/>

<!-- Listbox pattern -->
<v-card role="listbox" :aria-label="label + ' options'">
```

### Keyboard Navigation

- `@keydown.escape` on menus to close
- Tab order follows visual order
- Interactive elements must be focusable
