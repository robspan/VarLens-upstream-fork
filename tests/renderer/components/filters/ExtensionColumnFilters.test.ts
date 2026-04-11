/**
 * Tests for ExtensionColumnFilters.vue
 *
 * The component depends on `useVariantColumnMeta`, which calls window.api
 * IPC under the hood. Rather than plumb a mock api through (the mock-api
 * helper predates the Task 8 IPC channels), we mock the composable module
 * directly so each test can control what types/metadata the component sees.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import type { ColumnFilterMeta } from '../../../../src/shared/types/column-filters'

// Mock state that individual tests can mutate before mounting.
const typesPresentResponse = { current: new Set<string>() }
const columnMetaResponses = new Map<string, ColumnFilterMeta>()
// When a dotted key is in this set, the mocked getColumnMeta will reject for
// it — used to exercise the failure-path branch of the eager watch.
const columnMetaFailureKeys = new Set<string>()
const columnMetaCallCounts = new Map<string, number>()

// Mock LogService because the eager-watch failure branch calls
// `logService.warn`, which instantiates the pinia-backed log store. The
// component tests mount without a Pinia plugin, so use a stub that swallows
// all log calls.
vi.mock('../../../../src/renderer/src/services/LogService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../../../src/renderer/src/composables/useVariantColumnMeta', () => ({
  useVariantColumnMeta: (): {
    getColumnMeta: (scope: unknown, key: string) => Promise<ColumnFilterMeta>
    ensureTypesPresent: (scope: unknown) => Promise<Set<string>>
    invalidate: () => void
    invalidateAll: () => void
  } => ({
    getColumnMeta: vi.fn(async (_scope, key: string) => {
      columnMetaCallCounts.set(key, (columnMetaCallCounts.get(key) ?? 0) + 1)
      if (columnMetaFailureKeys.has(key)) {
        throw new Error(`simulated IPC failure for ${key}`)
      }
      const existing = columnMetaResponses.get(key)
      if (existing !== undefined) return existing
      // Default: return a numeric meta so controls render without errors.
      const fallback: ColumnFilterMeta = {
        key,
        dataType: 'numeric',
        distinctCount: 5,
        min: 0,
        max: 100
      }
      return fallback
    }),
    ensureTypesPresent: vi.fn(async () => typesPresentResponse.current),
    invalidate: vi.fn(),
    invalidateAll: vi.fn()
  })
}))

import ExtensionColumnFilters from '../../../../src/renderer/src/components/filters/ExtensionColumnFilters.vue'

const vuetify = createVuetify({ components, directives })

async function mountComponent(
  props: {
    scope?: { caseId?: number; caseIds?: number[] }
    modelValue?: Record<string, { operator: string; value: unknown; includeEmpty?: boolean }>
  } = {}
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(ExtensionColumnFilters, {
    global: { plugins: [vuetify] },
    props: {
      scope: props.scope ?? { caseId: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelValue: (props.modelValue ?? {}) as any
    }
  })
  // Wait for the immediate watch + async ensureTypesPresent to resolve.
  await flushPromises()
  return wrapper
}

describe('ExtensionColumnFilters', () => {
  beforeEach(() => {
    typesPresentResponse.current = new Set()
    columnMetaResponses.clear()
    columnMetaFailureKeys.clear()
    columnMetaCallCounts.clear()
    vi.clearAllMocks()
  })

  it('renders empty-state message when no extension types are present', async () => {
    typesPresentResponse.current = new Set(['snv'])
    const wrapper = await mountComponent()
    expect(wrapper.text()).toContain('No structural variants')
    // No accordion sections
    expect(wrapper.findAllComponents({ name: 'VExpansionPanel' }).length).toBe(0)
  })

  it('renders CNV section only when scope contains CNV variants', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent()
    const panels = wrapper.findAllComponents({ name: 'VExpansionPanel' })
    expect(panels.length).toBe(1)
    // Section title contains CNV
    expect(wrapper.text()).toContain('CNV')
    expect(wrapper.text()).not.toContain('STR')
  })

  it('renders all three sections when scope contains sv, cnv, and str variants', async () => {
    typesPresentResponse.current = new Set(['sv', 'cnv', 'str'])
    const wrapper = await mountComponent()
    const panels = wrapper.findAllComponents({ name: 'VExpansionPanel' })
    expect(panels.length).toBe(3)
    const text = wrapper.text()
    expect(text).toContain('SV')
    expect(text).toContain('CNV')
    expect(text).toContain('STR')
  })

  it('builds STR-specific sections with the registry labels', async () => {
    typesPresentResponse.current = new Set(['str'])
    const wrapper = await mountComponent()
    // Inspect the computed typeSections directly by looking at the
    // component's VNode tree. Collapsed v-expansion-panel bodies don't
    // render their text into the DOM until opened, so we read the sections
    // via the exposed component data instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    const sections = vm.typeSections as Array<{
      typeKey: string
      columns: Array<{ dottedKey: string; label: string; kind: string }>
    }>
    expect(sections.length).toBe(1)
    expect(sections[0].typeKey).toBe('str')
    const labels = sections[0].columns.map((c) => c.label)
    expect(labels).toContain('Repeat length')
    expect(labels).toContain('Reference copies')
    expect(labels).toContain('Disease')
  })

  it('emits update:modelValue with a new numeric filter when a control updates', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({
      scope: { caseId: 42 },
      modelValue: {}
    })
    // Open the CNV accordion panel so its contents mount in the DOM.
    const panel = wrapper.findComponent({ name: 'VExpansionPanel' })
    const panelTitle = panel.findComponent({ name: 'VExpansionPanelTitle' })
    await panelTitle.trigger('click')
    await flushPromises()

    // Grab the first NumericRangeControl and simulate an update.
    const numericControl = wrapper.findComponent({ name: 'NumericRangeControl' })
    expect(numericControl.exists()).toBe(true)
    numericControl.vm.$emit('update:modelValue', {
      operator: '>=',
      value: 3,
      includeEmpty: false
    })
    await flushPromises()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const latest = events?.at(-1)?.[0] as Record<string, unknown>
    expect(latest).toBeDefined()
    // The key should be one of the cnv.* columns (first numeric column is
    // cnv.copy_number per the registry ordering).
    const keys = Object.keys(latest)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys[0].startsWith('cnv.')).toBe(true)
    expect(latest[keys[0]]).toEqual({ operator: '>=', value: 3, includeEmpty: false })
  })

  it('emits update:modelValue with the key removed when a control clears', async () => {
    typesPresentResponse.current = new Set(['cnv'])
    const wrapper = await mountComponent({
      scope: { caseId: 42 },
      modelValue: {
        'cnv.copy_number': { operator: '>=', value: 3, includeEmpty: false }
      }
    })
    const panel = wrapper.findComponent({ name: 'VExpansionPanel' })
    const panelTitle = panel.findComponent({ name: 'VExpansionPanelTitle' })
    await panelTitle.trigger('click')
    await flushPromises()

    const numericControl = wrapper.findComponent({ name: 'NumericRangeControl' })
    expect(numericControl.exists()).toBe(true)
    numericControl.vm.$emit('update:modelValue', undefined)
    await flushPromises()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const latest = events?.at(-1)?.[0] as Record<string, unknown>
    expect(latest).toEqual({})
  })

  it('does not re-fire IPC when a column-meta fetch previously failed', async () => {
    // Regression test for the template-side-effect render loop: previously,
    // `getMeta()` was called from the template on every render, and on
    // failure it stayed undefined forever, triggering an unbounded IPC
    // retry loop. Now the eager watch tracks failed keys in a `failedKeys`
    // ref so a subsequent re-render is a no-op for the failing key.
    typesPresentResponse.current = new Set(['cnv'])
    columnMetaFailureKeys.add('cnv.copy_number')
    const wrapper = await mountComponent({ scope: { caseId: 42 } })
    // Allow the eager watch (immediate: true) to fire once.
    await flushPromises()

    // After the first run, the failing key has been attempted exactly once
    // and metaMap stays undefined for it.
    const failingCallCount = columnMetaCallCounts.get('cnv.copy_number') ?? 0
    expect(failingCallCount).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    expect(vm.metaMap['cnv.copy_number']).toBeUndefined()
    // The failedKeys set is populated
    expect(vm.failedKeys.has('cnv.copy_number')).toBe(true)

    // Force several re-renders by updating the modelValue prop (which
    // triggers the template to re-evaluate `getMeta()` bindings). The
    // watch should NOT re-fire the failing fetch because the key is in
    // failedKeys.
    for (let i = 0; i < 3; i++) {
      await wrapper.setProps({
        scope: { caseId: 42 },
        modelValue: { 'dummy.key': { operator: '>=', value: i } }
      })
      await flushPromises()
    }

    // Call count must stay at exactly 1 — no retry loop.
    expect(columnMetaCallCounts.get('cnv.copy_number')).toBe(1)
    expect(vm.metaMap['cnv.copy_number']).toBeUndefined()
  })
})
