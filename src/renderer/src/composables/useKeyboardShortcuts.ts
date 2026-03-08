import { onKeyStroke } from '@vueuse/core'

interface KeyboardShortcutCallbacks {
  onDisclaimer?: () => void
  onFaq?: () => void
  onLogViewer?: () => void
  onToggleFilterDrawer?: () => void
  onToggleColumnsDrawer?: () => void
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks): void {
  onKeyStroke('D', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onDisclaimer?.()
    }
  })

  onKeyStroke('Q', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onFaq?.()
    }
  })

  onKeyStroke('l', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      callbacks.onLogViewer?.()
    }
  })

  onKeyStroke('F', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onToggleFilterDrawer?.()
    }
  })

  onKeyStroke('C', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      callbacks.onToggleColumnsDrawer?.()
    }
  })
}
