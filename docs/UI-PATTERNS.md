# UI Patterns - Varlens

Prescriptive guidance for Vuetify component patterns in the Varlens codebase.

> **For AI assistants:** This document provides definitive patterns. When implementing UI components, follow these patterns exactly.

## Quick Reference

| Pattern | Use | Avoid | Why |
|---------|-----|-------|-----|
| Subtle background | `bg-grey-lighten-3` | `bg-surface-variant` | Warm palette makes surface-variant invisible |
| Strong contrast background | `secondary` (#424242) | `surface-variant` | Visible contrast for toolbars/tabs |
| Dialog structure | `v-dialog > v-card` | Nested cards or raw content | Consistent structure, proper focus trap |
| Side panel structure | `v-navigation-drawer > v-card` | Bare drawer | Consistent layout with toolbar |
| Hover states (scoped CSS) | `rgba(0, 0, 0, 0.02-0.05)` | Theme CSS variables | Works regardless of theme |
| Nested table background | `bg-grey-lighten-3` class | Inline styles | Consistent, maintainable |
| Density | `density="compact"` | Default density | Data-dense research UX |

---

## Color Patterns

### Background Colors

The warm palette theme has `surface-variant` (#f5f2ef) nearly identical to `surface` (#faf8f6). This causes invisible backgrounds.

#### Subtle Contrast (nested tables, expanded rows, filter bars)

**DO:**
```vue
<div class="bg-grey-lighten-3">
  <!-- Content with visible subtle grey background -->
</div>
```

**DO NOT:**
```vue
<!-- BROKEN: Invisible on warm palette -->
<div class="bg-surface-variant">
```

#### Strong Contrast (toolbars, tabs, headers)

**DO:**
```vue
<v-toolbar color="secondary">
  <!-- Dark toolbar (#424242) -->
</v-toolbar>
```

**DO NOT:**
```vue
<!-- BROKEN: Warm palette makes this white-on-white -->
<v-toolbar color="surface-variant">
```

### Hover States in Scoped CSS

Use neutral RGBA values that work regardless of theme. Avoid theme CSS variables in hover states.

**DO:**
```css
.group-header {
  background: rgba(0, 0, 0, 0.03);
}

.group-header:hover {
  background: rgba(0, 0, 0, 0.05);
}

.item-row:hover {
  background: rgba(0, 0, 0, 0.02);
}
```

**DO NOT:**
```css
/* BROKEN: Uses theme variable that may be invisible */
.group-header {
  background: rgb(var(--v-theme-surface-variant), 0.3);
}
```

### Status/Semantic Colors

Use Vuetify's semantic color names:

| Purpose | Color | Example |
|---------|-------|---------|
| Success | `success` | Import complete alerts |
| Error | `error` | Validation errors, failures |
| Warning | `warning` | Cautions, heterozygous variants |
| Info | `info` | Informational messages |
| Primary | `primary` (#a09588) | Primary actions, badges |
| Secondary | `secondary` (#424242) | Strong contrast elements |

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

**Real example:** `ImportDialog.vue`

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
      <v-toolbar-title class="text-subtitle-1">Panel Title</v-toolbar-title>
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

**Real example:** `VariantDetailsPanel.vue`

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

## Spacing Patterns

### Density Guidelines

Varlens uses compact density for data-dense research UX:

```vue
<!-- Form inputs -->
<v-text-field density="compact" />
<v-select density="compact" />

<!-- Tables -->
<v-data-table-server density="compact" />
<v-table density="compact" />

<!-- Toolbars -->
<v-toolbar density="compact" />

<!-- Lists -->
<v-list density="compact" />
```

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

### Common Layout Classes

```vue
<!-- Full height flex column (panels) -->
<div class="h-100 d-flex flex-column">

<!-- Scrollable content area -->
<div class="flex-grow-1 overflow-y-auto">

<!-- Centered content -->
<div class="d-flex align-center justify-center">

<!-- Inline elements with spacing -->
<div class="d-flex align-center gap-2">
```

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
<v-alert v-if="errorMessage" type="error" class="mb-4">
  {{ errorMessage }}
</v-alert>

<!-- Success alert with icon -->
<v-alert v-if="isSuccess" type="success" class="mb-4">
  <div class="d-flex align-center">
    <v-icon class="mr-2">mdi-check-circle</v-icon>
    <span>Operation complete!</span>
  </div>
</v-alert>
```

---

## Anti-Patterns

### NEVER Use

1. **`surface-variant` for backgrounds**
   - Warm palette makes it invisible (#f5f2ef vs #faf8f6)
   - Use `bg-grey-lighten-3` or `secondary` instead

2. **Theme CSS variables for hover states**
   - `rgb(var(--v-theme-surface-variant), 0.3)` - may be invisible
   - Use `rgba(0, 0, 0, 0.02-0.05)` instead

3. **Bare content in dialogs**
   - Always wrap in `v-card` inside `v-dialog`
   - Ensures proper structure and accessibility

4. **Default density in data components**
   - Varlens is data-dense research software
   - Always use `density="compact"`

5. **Hardcoded color hex values in templates**
   - Use Vuetify color names or CSS variables
   - Exception: RGBA in scoped CSS for hover states

### Common Mistakes

```vue
<!-- WRONG: Invisible background -->
<div class="bg-surface-variant">

<!-- RIGHT: Visible grey -->
<div class="bg-grey-lighten-3">
```

```css
/* WRONG: Theme variable may be invisible */
.item:hover {
  background: rgb(var(--v-theme-surface-variant), 0.2);
}

/* RIGHT: Neutral RGBA works with any theme */
.item:hover {
  background: rgba(0, 0, 0, 0.02);
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

### Focus Management

- Dialogs automatically trap focus
- `:persistent="true"` during loading prevents escape key dismissal
- Side panels should have close button with `@click="emit('update:open', false)"`

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

---

## Theme Reference

Varlens uses a warm palette theme:

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | #a09588 | Primary actions, active states |
| `secondary` | #424242 | Strong contrast, dark elements |
| `surface` | #faf8f6 | Main background |
| `surface-variant` | #f5f2ef | **AVOID** - nearly identical to surface |
| `background` | #fffcf8 | Page background |
| `error` | Vuetify default | Error states |
| `warning` | Vuetify default | Warning states |
| `success` | Vuetify default | Success states |

---

*Document created: Phase 32 - UI Consistency*
