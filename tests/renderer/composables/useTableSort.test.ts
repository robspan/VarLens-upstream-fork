/**
 * Unit tests for useTableSort composable
 *
 * Tests sort state management, sort item structure,
 * computed accessors, and state manipulation methods.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useTableSort } from '@renderer/composables/useTableSort'

describe('useTableSort', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  describe('Initial state', () => {
    it('initializes with empty sortBy array', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      expect(result.sortBy.value).toEqual([])
    })

    it('currentSortKey is undefined when no sort is set', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      expect(result.currentSortKey.value).toBeUndefined()
    })

    it('currentSortOrder defaults to "desc" when no sort is set', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      expect(result.currentSortOrder.value).toBe('desc')
    })
  })

  describe('setSortBy', () => {
    it('sets sort by key and order', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')

      expect(result.sortBy.value).toEqual([{ key: 'position', order: 'asc' }])
    })

    it('updates currentSortKey computed', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('gene', 'desc')

      expect(result.currentSortKey.value).toBe('gene')
    })

    it('updates currentSortOrder computed', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('cadd', 'asc')

      expect(result.currentSortOrder.value).toBe('asc')
    })

    it('replaces existing sort state', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')
      result.setSortBy('gene', 'desc')

      expect(result.sortBy.value).toEqual([{ key: 'gene', order: 'desc' }])
      expect(result.sortBy.value.length).toBe(1)
    })

    it('handles ascending sort order', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')

      expect(result.sortBy.value[0].order).toBe('asc')
    })

    it('handles descending sort order', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'desc')

      expect(result.sortBy.value[0].order).toBe('desc')
    })
  })

  describe('clearSort', () => {
    it('clears sort state', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')
      result.clearSort()

      expect(result.sortBy.value).toEqual([])
    })

    it('resets currentSortKey to undefined', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('gene', 'asc')
      result.clearSort()

      expect(result.currentSortKey.value).toBeUndefined()
    })

    it('resets currentSortOrder to default "desc"', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('gene', 'asc')
      result.clearSort()

      expect(result.currentSortOrder.value).toBe('desc')
    })
  })

  describe('Vuetify v-data-table compatibility', () => {
    it('sortBy format matches Vuetify SortItem structure', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')

      const sortItem = result.sortBy.value[0]
      expect(sortItem).toHaveProperty('key')
      expect(sortItem).toHaveProperty('order')
      expect(typeof sortItem.key).toBe('string')
      expect(['asc', 'desc']).toContain(sortItem.order)
    })

    it('sortBy can be bound to v-model:sort-by (array format)', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      // Simulate v-data-table updating sortBy via v-model
      result.sortBy.value = [{ key: 'gene', order: 'desc' }]

      expect(result.currentSortKey.value).toBe('gene')
      expect(result.currentSortOrder.value).toBe('desc')
    })
  })

  describe('Computed accessors', () => {
    it('currentSortKey returns first sort item key', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.sortBy.value = [
        { key: 'gene', order: 'asc' },
        { key: 'position', order: 'desc' }
      ]

      expect(result.currentSortKey.value).toBe('gene')
    })

    it('currentSortOrder returns first sort item order', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.sortBy.value = [
        { key: 'gene', order: 'asc' },
        { key: 'position', order: 'desc' }
      ]

      expect(result.currentSortOrder.value).toBe('asc')
    })

    it('computed values are reactive to sortBy changes', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('gene', 'asc')
      expect(result.currentSortKey.value).toBe('gene')
      expect(result.currentSortOrder.value).toBe('asc')

      result.setSortBy('position', 'desc')
      expect(result.currentSortKey.value).toBe('position')
      expect(result.currentSortOrder.value).toBe('desc')
    })
  })

  describe('Edge cases', () => {
    it('handles multiple consecutive setSortBy calls', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('position', 'asc')
      result.setSortBy('gene', 'desc')
      result.setSortBy('cadd', 'asc')

      expect(result.sortBy.value).toEqual([{ key: 'cadd', order: 'asc' }])
      expect(result.sortBy.value.length).toBe(1)
    })

    it('handles clearSort on already empty state', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.clearSort()
      result.clearSort()

      expect(result.sortBy.value).toEqual([])
    })

    it('handles setSortBy after clearSort', () => {
      const [result, appInstance] = withSetup(() => useTableSort())
      app = appInstance

      result.setSortBy('gene', 'asc')
      result.clearSort()
      result.setSortBy('position', 'desc')

      expect(result.sortBy.value).toEqual([{ key: 'position', order: 'desc' }])
    })
  })
})
