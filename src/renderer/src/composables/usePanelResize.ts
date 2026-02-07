import { ref, onUnmounted } from 'vue'

export interface PanelResizeOptions {
  side: 'left' | 'right'
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  collapseThreshold?: number
  onCollapse?: () => void
}

const DEFAULT_OPTIONS: PanelResizeOptions = {
  side: 'right',
  storageKey: 'varlens_panel_width',
  defaultWidth: 400,
  minWidth: 300,
  maxWidth: 800
}

export function usePanelResize(options?: Partial<PanelResizeOptions>) {
  const opts: PanelResizeOptions = { ...DEFAULT_OPTIONS, ...options }

  // Load initial width from localStorage
  const storedWidth = localStorage.getItem(opts.storageKey)
  const initialWidth = storedWidth !== null ? parseInt(storedWidth, 10) : opts.defaultWidth

  const panelWidth = ref(
    isNaN(initialWidth)
      ? opts.defaultWidth
      : Math.max(opts.minWidth, Math.min(opts.maxWidth, initialWidth))
  )
  const isResizing = ref(false)

  let startX = 0
  let startWidth = 0

  const handleMouseMove = (e: MouseEvent): void => {
    if (!isResizing.value) return

    // For left panel, moving right increases width; for right panel, moving left increases width
    const delta = opts.side === 'left' ? e.clientX - startX : startX - e.clientX

    const newWidth = startWidth + delta

    // Check collapse threshold before clamping
    if (
      opts.collapseThreshold !== undefined &&
      opts.onCollapse !== undefined &&
      newWidth < opts.collapseThreshold
    ) {
      opts.onCollapse()
      panelWidth.value = opts.minWidth
      localStorage.setItem(opts.storageKey, opts.minWidth.toString())
      // End resize immediately after collapse
      isResizing.value = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      return
    }

    panelWidth.value = Math.max(opts.minWidth, Math.min(opts.maxWidth, newWidth))
  }

  const handleMouseUp = (): void => {
    if (!isResizing.value) return

    isResizing.value = false
    // Persist to localStorage
    localStorage.setItem(opts.storageKey, panelWidth.value.toString())
    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  const startResize = (e: MouseEvent): void => {
    isResizing.value = true
    startX = e.clientX
    startWidth = panelWidth.value

    // Add event listeners to document for smooth tracking
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const resetWidth = (): void => {
    panelWidth.value = opts.defaultWidth
    localStorage.setItem(opts.storageKey, opts.defaultWidth.toString())
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  })

  return {
    panelWidth,
    isResizing,
    startResize,
    resetWidth,
    minWidth: opts.minWidth,
    maxWidth: opts.maxWidth
  }
}
