import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('case-metrics preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all case-metrics domain channels without unwrapping in createCaseMetricsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, name: 'Height', valueType: 'numeric', unit: 'cm', category: 'Anthropometric' },
        { id: 2, name: 'Weight', valueType: 'numeric', unit: 'kg', category: 'Anthropometric' }
      ])
      .mockResolvedValueOnce({
        id: 1,
        name: 'Height',
        valueType: 'numeric',
        unit: 'cm',
        category: 'Anthropometric'
      })
      .mockResolvedValueOnce([
        {
          id: 1,
          case_id: 1,
          metric_id: 1,
          numeric_value: 175.5,
          text_value: null,
          date_value: null,
          metric: {
            id: 1,
            name: 'Height',
            valueType: 'numeric',
            unit: 'cm',
            category: 'Anthropometric'
          }
        }
      ])
      .mockResolvedValueOnce({
        id: 1,
        case_id: 1,
        metric_id: 1,
        numeric_value: 180,
        text_value: null,
        date_value: null
      })
      .mockResolvedValueOnce(undefined)

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createCaseMetricsApi } = await import('../../../../src/preload/domains/case-metrics')
    const api = createCaseMetricsApi()

    await expect(api.listDefinitions()).resolves.toMatchObject([
      { id: 1, name: 'Height' },
      { id: 2, name: 'Weight' }
    ])

    await expect(
      api.createDefinition('Height', 'numeric', 'cm', 'Anthropometric')
    ).resolves.toMatchObject({
      id: 1,
      name: 'Height'
    })

    await expect(api.listForCase(1)).resolves.toMatchObject([
      {
        id: 1,
        case_id: 1,
        metric_id: 1,
        numeric_value: 175.5
      }
    ])

    await expect(
      api.upsert(1, 1, { numeric_value: 180, text_value: null, date_value: null })
    ).resolves.toMatchObject({
      id: 1,
      case_id: 1,
      metric_id: 1,
      numeric_value: 180
    })

    await expect(api.delete(1, 1)).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'case-metrics:listDefinitions')
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'case-metrics:createDefinition',
      'Height',
      'numeric',
      'cm',
      'Anthropometric'
    )
    expect(invoke).toHaveBeenNthCalledWith(3, 'case-metrics:listForCase', 1)
    expect(invoke).toHaveBeenNthCalledWith(4, 'case-metrics:upsert', 1, 1, {
      numeric_value: 180,
      text_value: null,
      date_value: null
    })
    expect(invoke).toHaveBeenNthCalledWith(5, 'case-metrics:delete', 1, 1)
  })

  it('preload index preserves case-metrics transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'case-metrics:listDefinitions') {
        return [{ id: 1, name: 'Height', valueType: 'numeric', unit: 'cm', category: 'Anthropometric' }]
      }
      if (channel === 'case-metrics:createDefinition') {
        return {
          id: 1,
          name: 'Height',
          valueType: 'numeric',
          unit: 'cm',
          category: 'Anthropometric'
        }
      }
      if (channel === 'case-metrics:listForCase') {
        return [
          {
            id: 1,
            case_id: 1,
            metric_id: 1,
            numeric_value: 175.5,
            text_value: null,
            date_value: null,
            metric: {
              id: 1,
              name: 'Height',
              valueType: 'numeric',
              unit: 'cm',
              category: 'Anthropometric'
            }
          }
        ]
      }
      if (channel === 'case-metrics:delete') {
        return undefined
      }
      return {
        code: ErrorCode.DB_ERROR,
        message: 'upsert failed',
        userMessage: 'Could not upsert metric'
      }
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      caseMetrics: {
        listDefinitions: () => Promise<unknown>
        createDefinition: (name: string, valueType: string, unit: string, category: string) => Promise<unknown>
        listForCase: (caseId: number) => Promise<unknown>
        upsert: (caseId: number, metricId: number, value: unknown) => Promise<unknown>
        delete: (caseId: number, metricId: number) => Promise<unknown>
      }
    }

    await expect(api.caseMetrics.listDefinitions()).resolves.toMatchObject([
      { id: 1, name: 'Height' }
    ])

    await expect(
      api.caseMetrics.createDefinition('Height', 'numeric', 'cm', 'Anthropometric')
    ).resolves.toMatchObject({
      id: 1,
      name: 'Height'
    })

    await expect(api.caseMetrics.listForCase(1)).resolves.toMatchObject([
      { id: 1, case_id: 1 }
    ])

    await expect(
      api.caseMetrics.upsert(1, 1, { numeric_value: 180 })
    ).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'upsert failed'
    })

    await expect(api.caseMetrics.delete(1, 1)).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('case-metrics:listDefinitions')
    expect(invoke).toHaveBeenCalledWith('case-metrics:createDefinition', 'Height', 'numeric', 'cm', 'Anthropometric')
    expect(invoke).toHaveBeenCalledWith('case-metrics:listForCase', 1)
    expect(invoke).toHaveBeenCalledWith('case-metrics:upsert', 1, 1, { numeric_value: 180 })
    expect(invoke).toHaveBeenCalledWith('case-metrics:delete', 1, 1)
  })
})
