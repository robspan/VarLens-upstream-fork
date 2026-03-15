import { describe, it, expect, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import KeyboardShortcutsDialog from '@renderer/components/KeyboardShortcutsDialog.vue'

const vuetify = createVuetify()

describe('KeyboardShortcutsDialog', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
  })

  function mountDialog() {
    wrapper = mount(KeyboardShortcutsDialog, {
      props: { modelValue: true },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    // Vuetify dialogs teleport to body, so query document.body
    return document.body
  }

  it('renders when modelValue is true', () => {
    const body = mountDialog()
    const text = body.textContent ?? ''

    expect(text).toContain('Keyboard Shortcuts')
    expect(text).toContain('Table Navigation')
    expect(text).toContain('Actions')
  })

  it('shows all shortcut groups', () => {
    const body = mountDialog()
    const text = body.textContent ?? ''

    expect(text).toContain('Table Navigation')
    expect(text).toContain('Actions (on selected row)')
    expect(text).toContain('Search & Filters')
    expect(text).toContain('General')
  })

  it('includes key shortcuts in kbd elements', () => {
    mountDialog()
    const kbds = document.body.querySelectorAll('kbd')
    expect(kbds.length).toBeGreaterThan(0)
  })
})
