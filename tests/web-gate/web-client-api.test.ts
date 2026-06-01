import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApi } from '../../src/web/client/api'

interface TestApi {
  cases: {
    list: () => Promise<unknown>
  }
  import: {
    onProgress: (callback: (progress: unknown) => void) => () => void
    selectFile: () => Promise<string | null>
    selectBedFile: () => Promise<string | null>
    start: (...args: unknown[]) => Promise<unknown>
  }
  batchImport: {
    selectFiles: () => Promise<string[]>
    selectFolder: () => Promise<string[]>
    selectZip: () => Promise<unknown>
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

type MockUploadFileInput = Omit<HTMLInputElement, 'files'> & {
  files: FileList | null
  click: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
}

function createFileList(files: File[]): FileList {
  return Object.assign([...files], {
    item: (index: number) => files[index] ?? null
  }) as unknown as FileList
}

function mockJsonResponse(body: unknown): {
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
} {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body)
  }
}

function stubUploadPicker(files: File[], options: { cancel?: boolean } = {}): MockUploadFileInput {
  let changeListener: EventListener | undefined
  let focusListener: EventListener | undefined
  const input = {
    type: '',
    accept: '',
    multiple: false,
    files: createFileList([]),
    style: {},
    setAttribute: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'change') changeListener = listener
    }),
    click: vi.fn(() => {
      if (options.cancel === true) {
        focusListener?.({} as Event)
        return
      }
      input.files = createFileList(files)
      changeListener?.({} as Event)
    }),
    remove: vi.fn()
  } as unknown as MockUploadFileInput

  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      expect(tagName).toBe('input')
      return input
    }),
    body: {
      append: vi.fn()
    }
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'focus') focusListener = listener
    }),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => {
      callback()
      return 0
    }),
    open: vi.fn()
  })
  return input
}

function mockUploadFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/import/upload')
    const file = init?.body as File
    return mockJsonResponse({
      id: `upload-${file.name}`,
      ref: `web-upload:upload-${file.name}/${file.name}`,
      fileName: file.name,
      size: file.size
    })
  })
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

  test('import.selectFile opens a browser picker and returns a desktop-compatible upload ref', async () => {
    const file = new File(['##fileformat=VCFv4.2'], 'case-a.vcf')
    const input = stubUploadPicker([file])
    const fetchMock = mockUploadFetch()

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBe('web-upload:upload-case-a.vcf/case-a.vcf')

    expect(input.type).toBe('file')
    expect(input.accept).toBe('.vcf,.vcf.gz,.json,.json.gz,.gz')
    expect(input.multiple).toBe(false)
    expect(input.remove).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/octet-stream',
          'x-varlens-file-name': 'case-a.vcf'
        },
        body: file
      })
    )
  })

  test('import.selectFile returns null when the picker is cancelled', async () => {
    const input = stubUploadPicker([], { cancel: true })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBeNull()

    expect(input.remove).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('import.selectBedFile uses the same picker/upload seam for BED files', async () => {
    const file = new File(['chr1\t1\t100'], 'panel.bed')
    const input = stubUploadPicker([file])
    mockUploadFetch()

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectBedFile()).resolves.toBe('web-upload:upload-panel.bed/panel.bed')

    expect(input.accept).toBe('.bed,.bed.gz,.gz')
    expect(input.multiple).toBe(false)
  })

  test('batchImport.selectFolder enables directory picking and uploads all selected files', async () => {
    const first = new File(['{}'], 'case-a.json')
    const second = new File(['{}'], 'case-b.json')
    const input = stubUploadPicker([first, second])
    mockUploadFetch()

    const api = createApi() as unknown as TestApi
    await expect(api.batchImport.selectFolder()).resolves.toEqual([
      'web-upload:upload-case-a.json/case-a.json',
      'web-upload:upload-case-b.json/case-b.json'
    ])

    expect(input.multiple).toBe(true)
    expect(input.setAttribute).toHaveBeenCalledWith('webkitdirectory', '')
  })

  test('batchImport.selectZip returns the upload ref plus encrypted-state probe result', async () => {
    const zip = new File(['PK'], 'batch.zip')
    stubUploadPicker([zip])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/import/upload') {
        return mockJsonResponse({
          id: 'upload-batch.zip',
          ref: 'web-upload:upload-batch.zip/batch.zip',
          fileName: 'batch.zip',
          size: zip.size
        })
      }
      expect(url).toBe('/api/batch-import/testZipPassword')
      expect(init?.body).toBe(
        JSON.stringify({ args: ['web-upload:upload-batch.zip/batch.zip', ''] })
      )
      return mockJsonResponse({ success: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const api = createApi() as unknown as TestApi
    await expect(api.batchImport.selectZip()).resolves.toEqual({
      filePath: 'web-upload:upload-batch.zip/batch.zip',
      isEncrypted: true
    })
  })
})
