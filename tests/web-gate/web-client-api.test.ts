import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApi } from '../../src/web/client/api'

interface TestApi {
  cases: {
    list: () => Promise<unknown>
  }
  import: {
    onProgress: (callback: (progress: unknown) => void) => () => void
    start: (...args: unknown[]) => Promise<unknown>
  }
  variants: {
    query: (...args: unknown[]) => Promise<unknown>
  }
}

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly listeners = new Map<string, EventListener>()
  readonly url: string
  readonly init?: EventSourceInit
  close = vi.fn()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.init = init
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type)
  }

  emit(type: string, data: unknown): void {
    const listener = this.listeners.get(type)
    listener?.({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

function mockFetch(response: {
  ok: boolean
  status: number
  statusText: string
  body: string
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: async () => response.body
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('web client api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockEventSource.instances = []
  })

  test('returns parsed JSON for successful RPC responses', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify([{ id: 1, name: 'case-a' }])
    })

    const api = createApi() as unknown as TestApi
    await expect(api.cases.list()).resolves.toEqual([{ id: 1, name: 'case-a' }])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cases/list',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ args: [] })
      })
    )
  })

  test('returns non-2xx SerializableError JSON as the IPC result envelope', async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: JSON.stringify({
        code: 'NOT_FOUND',
        message: 'unknown method',
        userMessage: 'Unknown API method.',
        details: { domain: 'variants', method: 'query' }
      })
    })

    const api = createApi() as unknown as TestApi
    await expect(api.variants.query(1, {}, 0, 50)).resolves.toEqual({
      code: 'NOT_FOUND',
      message: 'unknown method',
      userMessage: 'Unknown API method.',
      details: { domain: 'variants', method: 'query' }
    })
  })

  test('rejects non-2xx plain-text errors with the raw body', async () => {
    mockFetch({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: 'database offline'
    })

    const api = createApi() as unknown as TestApi
    await expect(api.cases.list()).rejects.toThrow(
      'web rpc cases.list: 503 Service Unavailable: database offline'
    )
  })

  test('bridges import progress subscriptions through server-sent events', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const api = createApi() as unknown as TestApi
    const onProgress = vi.fn()

    const unsubscribe = api.import.onProgress(onProgress)
    MockEventSource.instances[0].emit('import:progress', { phase: 'parsing', count: 5 })
    unsubscribe()

    expect(MockEventSource.instances[0].url).toBe('/api/events')
    expect(MockEventSource.instances[0].init).toEqual({ withCredentials: true })
    expect(onProgress).toHaveBeenCalledWith({ phase: 'parsing', count: 5 })
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce()
  })

  test('keeps import RPC methods available beside the progress subscription override', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify({ caseId: 1 })
    })

    const api = createApi() as unknown as TestApi
    await expect(api.import.start('/tmp/input.vcf', 'Case A')).resolves.toEqual({ caseId: 1 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/start',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ args: ['/tmp/input.vcf', 'Case A'] })
      })
    )
  })
})
