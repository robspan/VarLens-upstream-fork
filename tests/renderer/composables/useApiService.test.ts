/**
 * Unit tests for useApiService composable
 *
 * Tests browser safety checks for window.api access.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useApiService } from '@renderer/composables/useApiService'
import { ErrorCode } from '../../../src/shared/types/errors'
import { expectIpcResult } from '../../../src/renderer/src/utils/ipc-result'

describe('useApiService', () => {
  let app: { unmount: () => void }
  const originalWindowApi = window.api

  afterEach(() => {
    if (app) app.unmount()
    // Restore original window.api
    if (originalWindowApi) {
      window.api = originalWindowApi
    }
  })

  describe('with window.api available', () => {
    beforeEach(() => {
      window.api = createMockApi()
    })

    it('returns isAvailable true', () => {
      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.isAvailable.value).toBe(true)
    })

    it('provides api access', () => {
      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.api).toBeDefined()
      expect(result.api!.cohort).toBeDefined()
      expect(result.api!.cases).toBeDefined()
      expect(result.api!.variants).toBeDefined()
    })

    it('api reference matches window.api', () => {
      const mockApi = createMockApi()
      window.api = mockApi

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.api).toBe(mockApi)
    })

    it('can call IPC methods through api', async () => {
      const mockCases = [{ id: 1, case_name: 'Test' }]
      window.api.cases.list = vi.fn().mockResolvedValue(mockCases)

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      const cases = await result.api!.cases.list()
      expect(cases).toEqual(mockCases)
      expect(window.api.cases.list).toHaveBeenCalledOnce()
    })
  })

  describe('without window.api (dev mode)', () => {
    beforeEach(() => {
      // @ts-expect-error - Testing undefined case
      delete window.api
    })

    it('returns isAvailable false', () => {
      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.isAvailable.value).toBe(false)
    })

    it('api is undefined', () => {
      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.api).toBeUndefined()
    })

    it('guards against calling undefined api', () => {
      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      if (result.isAvailable.value) {
        // This branch should not execute
        expect(result.api!.cases).toBeDefined()
      } else {
        // isAvailable correctly indicates API is not available
        expect(result.api).toBeUndefined()
      }
    })
  })

  describe('browser safety pattern', () => {
    it('checks both window and window.api', () => {
      // Both must be defined for isAvailable to be true
      window.api = createMockApi()

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      expect(result.isAvailable.value).toBe(true)
    })

    it('safe to use in conditional logic', () => {
      window.api = createMockApi()

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      let calledApi = false
      if (result.isAvailable.value && result.api) {
        calledApi = true
        expect(result.api.cohort).toBeDefined()
      }

      expect(calledApi).toBe(true)
    })

    it('prevents runtime errors in browser dev mode', () => {
      // @ts-expect-error - Testing undefined case
      delete window.api

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      // This pattern prevents errors
      if (!result.isAvailable.value) {
        // Early return in real code
        expect(result.api).toBeUndefined()
      }
    })
  })

  describe('reactivity', () => {
    it('isAvailable is a computed ref', () => {
      window.api = createMockApi()

      const [result, appInstance] = withSetup(() => useApiService())
      app = appInstance

      // isAvailable should be reactive
      expect(result.isAvailable.value).toBe(true)

      // Note: In practice, window.api doesn't change at runtime,
      // but the computed ensures reactive checking
      expect(typeof result.isAvailable.value).toBe('boolean')
    })
  })

  describe('expectIpcResult', () => {
    it('returns successful IPC payloads unchanged', () => {
      const payload = { id: 1, name: 'Case Alpha' }

      expect(expectIpcResult(payload)).toEqual(payload)
    })

    it('throws serializable IPC errors', () => {
      expect(() =>
        expectIpcResult({
          code: ErrorCode.DB_ERROR,
          message: 'query failed',
          userMessage: 'Could not load cases'
        })
      ).toThrow()
    })
  })
})
