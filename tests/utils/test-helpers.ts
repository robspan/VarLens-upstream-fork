/**
 * Test helper utilities for composable testing.
 *
 * Provides withSetup helper for testing composables that need Vue lifecycle context.
 */

import { createApp } from 'vue'
import { flushPromises } from '@vue/test-utils'

/**
 * Creates a Vue app context for testing composables that require lifecycle hooks.
 *
 * Usage:
 * ```typescript
 * const [result, app] = withSetup(() => useMyComposable())
 * // assertions...
 * app.unmount() // cleanup
 * ```
 *
 * @param composable - Function that calls the composable to test
 * @returns Tuple of [composable result, app with unmount method]
 */
export function withSetup<T>(composable: () => T): [T, { unmount: () => void }] {
  let result: T

  const app = createApp({
    setup() {
      result = composable()
      return () => {}
    }
  })

  app.mount(document.createElement('div'))

  return [result!, app]
}

// Re-export flushPromises for convenience
export { flushPromises }
