// Test setup file for Vitest
// Mocks browser APIs required by Vuetify components

import { vi, afterEach } from 'vitest'

let fallbackLocalStorage: Storage | null = null

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: vi.fn(() => {
      store.clear()
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value))
    })
  }
}

function resolveWindowLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

// Clear all mocks after each test to prevent memory leaks (Vitest 4.0.18+)
afterEach(() => {
  fallbackLocalStorage?.clear()
  vi.clearAllMocks()
})

// Mock visualViewport (required by VOverlay/VDialog)
if (typeof window !== 'undefined') {
  const localStorageMock = resolveWindowLocalStorage() ?? createMemoryStorage()
  if (resolveWindowLocalStorage() === undefined) {
    fallbackLocalStorage = localStorageMock
  }

  if (resolveWindowLocalStorage() === undefined) {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true
    })
  }

  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true
    })
  }

  Object.defineProperty(window, 'visualViewport', {
    value: {
      width: 1024,
      height: 768,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    },
    writable: true,
    configurable: true
  })

  // Mock matchMedia (required by Vuetify)
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }),
    writable: true,
    configurable: true
  })

  // Mock IntersectionObserver (required by Vuetify)
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    takeRecords() {
      return []
    }
    unobserve() {}
  } as unknown as typeof global.IntersectionObserver

  // Mock ResizeObserver (required by Vuetify)
  // Store callback to enable spy verification of disconnect/observe/unobserve
  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    disconnect() {
      // Can be spied on with vi.spyOn(ResizeObserver.prototype, 'disconnect')
    }

    observe() {
      // Can be spied on with vi.spyOn(ResizeObserver.prototype, 'observe')
    }

    unobserve() {
      // Can be spied on with vi.spyOn(ResizeObserver.prototype, 'unobserve')
    }
  } as unknown as typeof global.ResizeObserver
}
