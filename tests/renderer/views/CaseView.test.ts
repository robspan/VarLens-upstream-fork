/**
 * Unit tests for `CaseView.vue` — the case-view tab integration that
 * hosts the Wave 6 Shortlist tab alongside the per-type variant tabs.
 *
 * These tests drive `tabItems`, `selectedVariantType` default-selection,
 * `variantTableType` computed, and the template bindings (`:interactive`,
 * `v-show` / `v-if` split). The heavy child components (FilterToolbar,
 * VariantTable, ShortlistPanel) are stubbed so we can introspect the
 * props CaseView binds to them without paying the cost of their real
 * setup pipelines.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 6)
 */
/* eslint-disable vue/one-component-per-file -- test file defines three
   stub components (FilterToolbar, VariantTable, ShortlistPanel) inline
   via `vi.mock` factories; the rule doesn't make sense for test doubles. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// ─── Mock useApiService (typeCounts IPC surface used by loadTypeCounts) ──
const typeCountsMock = vi.fn<[number], Promise<Record<string, number>>>()
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      variants: {
        typeCounts: (caseId: number) => typeCountsMock(caseId)
      }
    },
    isAvailable: { value: true }
  })
}))

// ─── Mock heavy child components so CaseView mounts without their deps ──
//
// FilterToolbar + VariantTable + ShortlistPanel each import their own
// forest of composables. We stub them to tiny components that capture
// their props (via vm.$props) so we can assert on the bindings CaseView
// drives into them.
vi.mock('../../../src/renderer/src/components/FilterToolbar.vue', () => ({
  default: defineComponent({
    name: 'FilterToolbarStub',
    props: {
      caseId: { type: Number, default: null },
      caseName: { type: String, default: '' },
      filteredCount: { type: Number, default: 0 },
      totalCount: { type: Number, default: 0 },
      hasSort: { type: Boolean, default: false },
      initialSearch: { type: String, default: undefined },
      columns: { type: Array, default: () => [] },
      columnActiveFilters: { type: Array, default: () => [] }
    },
    emits: [
      'update:filters',
      'reset-sort',
      'export-success',
      'export-error',
      'clear-column-filters',
      'clear-column-filter'
    ],
    setup(_, { expose }) {
      expose({
        filterOptions: { columnMeta: [] },
        handleClearAll: vi.fn()
      })
      return () => h('div', { class: 'filter-toolbar-stub' })
    }
  })
}))

vi.mock('../../../src/renderer/src/components/VariantTable.vue', () => ({
  default: defineComponent({
    name: 'VariantTableStub',
    props: {
      caseId: { type: Number, default: null },
      filters: { type: Object, default: () => ({}) },
      annotationScope: { type: String, default: 'case' },
      columnMeta: { type: Array, default: () => [] },
      variantType: { type: String, default: 'snv' },
      interactive: { type: Boolean, default: true }
    },
    emits: ['update:counts', 'update:hasSort', 'row-click', 'deselect', 'clear-filters'],
    setup(_, { expose }) {
      expose({
        resetSort: vi.fn(),
        refresh: vi.fn(),
        columns: [],
        hasColumnFilters: ref(false),
        columnFilterCount: ref(0),
        clearAllColumnFilters: vi.fn(),
        clearColumnFilter: vi.fn(),
        columnActiveFilters: ref([])
      })
      return () => h('div', { class: 'variant-table-stub' })
    }
  })
}))

vi.mock('../../../src/renderer/src/components/shortlist/ShortlistPanel.vue', () => ({
  default: defineComponent({
    name: 'ShortlistPanelStub',
    props: {
      caseId: { type: Number, default: null }
    },
    emits: ['row-click', 'open-in-tab'],
    setup() {
      return () => h('div', { class: 'shortlist-panel-stub' })
    }
  })
}))

// ─── Minimal global fetch / LogService mocks ────────────────────────────
vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Import AFTER mocks so the hoisted `vi.mock` factories take effect.
import CaseView from '../../../src/renderer/src/views/CaseView.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'

const vuetify = createVuetify({ components, directives })

/**
 * Mount CaseView with a fresh AppState provide. Returns the wrapper and
 * the provided state so tests can drive `selectedCaseId` and observe
 * downstream effects.
 */
function mountCaseView(initialCaseId: number | null = 1) {
  const state = createAppState()
  state.selectedCaseId.value = initialCaseId
  const wrapper = mount(CaseView, {
    global: {
      plugins: [vuetify],
      provide: {
        [AppStateKey as symbol]: state
      }
    }
  })
  return { wrapper, state }
}

describe('CaseView — Shortlist tab integration', () => {
  beforeEach(() => {
    typeCountsMock.mockReset()
  })

  it('shows Shortlist tab even on single-type cases (algorithmic ranking view)', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 0, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    // Shortlist has two reasons to exist — cross-type comparison AND
    // algorithmic ranking. Reason (2) applies even on SNV-only cases.
    expect(wrapper.text()).toContain('Shortlist')
  })

  it('shows Shortlist tab when more than one variant type is present', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect(wrapper.text()).toContain('Shortlist')
  })

  it('defaults selectedVariantType to "shortlist" on any non-empty case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'shortlist'
    )
  })

  it('seeds lastNonShortlistType to first present type on cnv+str case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 0, indel: 0, sv: 0, cnv: 2, str: 1 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.lastNonShortlistType).toBe('cnv')
  })

  it('lands on Shortlist with lastNonShortlistType seeded for a single-type SV-only case', async () => {
    typeCountsMock.mockResolvedValue({ snv: 0, sv: 5, cnv: 0, str: 0 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      lastNonShortlistType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.lastNonShortlistType).toBe('sv')
  })

  it('variantTableType computed never yields "shortlist" when Shortlist is selected', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      selectedVariantType: string
      variantTableType: string
    }
    expect(vm.selectedVariantType).toBe('shortlist')
    expect(vm.variantTableType).not.toBe('shortlist')
    expect(['snv', 'sv', 'cnv', 'str']).toContain(vm.variantTableType)
  })

  it('watcher stashes last non-shortlist tab when user picks sv', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    // Drive the selection by emitting from the v-tabs v-model, which is
    // the user-visible surface. Writing to the exposed ref via the proxy
    // is unreliable across @vue/test-utils versions.
    const tabs = wrapper.findComponent({ name: 'VTabs' })
    await tabs.vm.$emit('update:modelValue', 'sv')
    await flushPromises()
    expect(table.props('variantType')).toBe('sv')
    expect((wrapper.vm as unknown as { lastNonShortlistType: string }).lastNonShortlistType).toBe(
      'sv'
    )
    // Toggle back to Shortlist → lastNonShortlistType must still read 'sv'
    await tabs.vm.$emit('update:modelValue', 'shortlist')
    await flushPromises()
    expect((wrapper.vm as unknown as { lastNonShortlistType: string }).lastNonShortlistType).toBe(
      'sv'
    )
  })

  it('binds :interactive=false on VariantTable when Shortlist tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    expect(table.exists()).toBe(true)
    expect(table.props('interactive')).toBe(false)
  })

  it('binds :interactive=true on VariantTable when a per-type tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as { selectedVariantType: string }
    vm.selectedVariantType = 'sv'
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    expect(table.props('interactive')).toBe(true)
  })

  it('effectiveFilters.variant_type tracks variantTableType (never "shortlist")', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    const filters = table.props('filters') as { variant_type?: string }
    expect(filters.variant_type).not.toBe('shortlist')
    // Defaults land on Shortlist → lastNonShortlistType is 'snv' (first present)
    expect(filters.variant_type).toBe('snv')
  })

  it('VariantTable stays mounted (via v-show) while Shortlist is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const table = wrapper.findComponent({ name: 'VariantTableStub' })
    // Even though the Shortlist tab is active, VariantTable is mounted.
    expect(table.exists()).toBe(true)
  })

  it('ShortlistPanel is mounted on-demand (v-if) when Shortlist tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ShortlistPanelStub' }).exists()).toBe(true)
  })

  it('ShortlistPanel is NOT mounted when a per-type tab is active', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const vm = wrapper.vm as unknown as { selectedVariantType: string }
    vm.selectedVariantType = 'sv'
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ShortlistPanelStub' }).exists()).toBe(false)
  })

  it('ShortlistPanel open-in-tab switches selectedVariantType to emitted tab', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper } = mountCaseView(1)
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ShortlistPanelStub' })
    await panel.vm.$emit('open-in-tab', 'sv')
    await flushPromises()
    expect((wrapper.vm as unknown as { selectedVariantType: string }).selectedVariantType).toBe(
      'sv'
    )
  })

  it('ShortlistPanel row-click drives selectedPanelVariant via handleRowClick', async () => {
    typeCountsMock.mockResolvedValue({ snv: 10, sv: 3 })
    const { wrapper, state } = mountCaseView(1)
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ShortlistPanelStub' })
    const row = {
      id: 42,
      case_id: 1,
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      variant_type: 'snv'
    }
    await panel.vm.$emit('row-click', row)
    await flushPromises()
    expect(state.panelOpen.value).toBe(true)
    expect(state.selectedPanelVariant.value).toMatchObject({ id: 42 })
  })
})
