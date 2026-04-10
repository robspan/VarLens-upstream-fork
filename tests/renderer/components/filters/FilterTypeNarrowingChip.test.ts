import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import FilterTypeNarrowingChip from '../../../../src/renderer/src/components/filters/FilterTypeNarrowingChip.vue'

const vuetify = createVuetify({ components, directives })

describe('FilterTypeNarrowingChip', () => {
  it('renders nothing when no extension filters are active', () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: { columnFilters: {} }
    })
    expect(wrapper.text().trim()).toBe('')
  })

  it('ignores base (bare) column filters and renders nothing', () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: {
        columnFilters: {
          gnomad_af: { operator: '<=', value: 0.01 },
          cadd: { operator: '>=', value: 20 }
        }
      }
    })
    expect(wrapper.text().trim()).toBe('')
  })

  it('renders single-type chip for a CNV filter', () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: {
        columnFilters: { 'cnv.copy_number': { operator: '>=', value: 3 } }
      }
    })
    expect(wrapper.text()).toContain('CNV only')
  })

  it('renders single-type chip for an STR filter', () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: {
        columnFilters: { 'str.repeat_length': { operator: '>=', value: 10 } }
      }
    })
    expect(wrapper.text()).toContain('STR only')
  })

  it('renders multi-type warning chip for cross-type filters', () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: {
        columnFilters: {
          'cnv.copy_number': { operator: '>=', value: 3 },
          'sv.support': { operator: '>=', value: 10 }
        }
      }
    })
    expect(wrapper.text()).toMatch(/Combining .* filters — results may be empty/i)
    expect(wrapper.text()).toContain('CNV')
    expect(wrapper.text()).toContain('SV')
  })

  it('emits clear-filter with type key when close button is clicked', async () => {
    const wrapper = mount(FilterTypeNarrowingChip, {
      global: { plugins: [vuetify] },
      props: { columnFilters: { 'cnv.copy_number': { operator: '>=', value: 3 } } }
    })
    // v-chip closable adds a close button inside the chip
    const closeBtn = wrapper.find('.v-chip__close')
    if (closeBtn.exists()) {
      await closeBtn.trigger('click')
      const emitted = wrapper.emitted('clear-filter')
      expect(emitted).toBeTruthy()
      expect(emitted?.[0]).toEqual(['cnv'])
    } else {
      // Fall back to emitting via the v-chip click:close event directly —
      // some Vuetify versions render the close affordance differently.
      const chip = wrapper.findComponent({ name: 'VChip' })
      await chip.vm.$emit('click:close')
      const emitted = wrapper.emitted('clear-filter')
      expect(emitted).toBeTruthy()
      expect(emitted?.[0]).toEqual(['cnv'])
    }
  })
})
