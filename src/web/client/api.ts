/**
 * Web-mode `window.api`.
 *
 * Single Proxy that forwards `window.api.<domain>.<method>(...args)` to
 * `POST /api/<domain>/<method>` with `{ args }`, returning the parsed
 * JSON body. Typed as `WindowAPI` so renderer call sites stay identical
 * to the Electron build.
 *
 * Three behaviours the renderer relies on that don't map to plain RPC:
 *
 *   - Event subscribers. Import progress is bridged over server-sent
 *     events; unsupported event sources still receive a no-op
 *     unsubscribe so call sites don't crash.
 *   - `perf.isEnabled` / `perf.reportInteractive`. Synchronous
 *     boolean / fire-and-forget; stubbed locally.
 *   - `shell.openExternal`. Browser equivalent is a validated `window.open`.
 *
 * Everything else is RPC. The server dispatcher is what enforces which
 * methods actually exist; the Proxy is permissive on purpose.
 */
import type { WindowAPI } from '../../shared/types/api'
import type { UpdateStatus } from '../../shared/types/api'
import { isIpcError } from '../../shared/types/errors'
import { ALLOWED_DOMAINS } from '../../shared/config/allowed-domains'

declare const __APP_VERSION__: string

interface InvokeBody {
  args: unknown[]
}

interface UploadedFileRef {
  ref: string
  fileName: string
  size: number
}

// Vite's `base` config materialises here at build time. The browser
// loads the SPA from BASE_URL (e.g. `/varlens/`), so API calls have to
// share that prefix or reverse-proxy path routing won't match.
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

function isDomainAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return ALLOWED_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  )
}

function isUrlSafeForExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && isDomainAllowed(parsed.hostname)
  } catch {
    return false
  }
}

async function httpInvoke(domain: string, method: string, args: unknown[]): Promise<unknown> {
  const body: InvokeBody = { args }
  const res = await fetch(`${API_BASE}/${domain}/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Server returns JSON for both success and application errors
  // (SerializableError). Non-2xx with non-JSON body is a transport
  // failure — surface it.
  const text = await res.text()
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (isIpcError(parsed)) return parsed
    } catch {
      // Throw below for non-JSON error responses.
    }
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
}

async function uploadImportFile(file: File): Promise<UploadedFileRef> {
  const res = await fetch(`${API_BASE}/import/upload`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/octet-stream',
      'x-varlens-file-name': file.name
    },
    body: file
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`web upload: ${res.status} ${res.statusText}: ${text}`)
  }
  return JSON.parse(text) as UploadedFileRef
}

async function uploadImportFiles(files: readonly File[]): Promise<UploadedFileRef[]> {
  const uploaded: UploadedFileRef[] = []
  for (const file of files) {
    uploaded.push(await uploadImportFile(file))
  }
  return uploaded
}

async function pickFiles(params: {
  multiple: boolean
  accept: string
  directory?: boolean
}): Promise<File[]> {
  const cancelFallbackDelayMs = 2000
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = params.accept
  input.multiple = params.multiple
  if (params.directory === true) {
    input.setAttribute('webkitdirectory', '')
  }
  input.style.display = 'none'
  document.body.append(input)
  try {
    return await new Promise<File[]>((resolve) => {
      let settled = false
      let cancelTimer: ReturnType<typeof window.setTimeout> | undefined
      const settle = (files: File[]): void => {
        if (settled) return
        settled = true
        if (cancelTimer !== undefined) {
          window.clearTimeout(cancelTimer)
        }
        window.removeEventListener('focus', handleFocus)
        resolve(files)
      }
      const handleFocus = (): void => {
        // Native pickers can restore focus before `change` has populated
        // `input.files`; keep focus as a delayed cancel fallback only.
        cancelTimer = window.setTimeout(() => {
          settle(Array.from(input.files ?? []))
        }, cancelFallbackDelayMs)
      }
      input.addEventListener('change', () => settle(Array.from(input.files ?? [])), { once: true })
      input.addEventListener('cancel', () => settle([]), { once: true })
      window.addEventListener('focus', handleFocus, { once: true })
      input.click()
    })
  } finally {
    input.remove()
  }
}

async function pickAndUploadFiles(params: {
  multiple: boolean
  accept: string
  directory?: boolean
}): Promise<string[]> {
  const files = await pickFiles(params)
  return (await uploadImportFiles(files)).map((file) => file.ref)
}

const NOOP_UNSUBSCRIBE = (): void => {}

function subscribeWebEvent<T>(type: string, callback: (payload: T) => void): () => void {
  if (typeof EventSource === 'undefined') return NOOP_UNSUBSCRIBE

  const source = new EventSource(`${API_BASE}/events`, { withCredentials: true })
  const listener = (event: MessageEvent<string>): void => {
    callback(JSON.parse(event.data) as T)
  }
  source.addEventListener(type, listener as EventListener)
  return () => {
    source.removeEventListener(type, listener as EventListener)
    source.close()
  }
}

function buildDomainProxy(domain: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined
        // Event subscribers: window.api.<domain>.on*(callback) → no-op unsubscribe.
        if (prop.startsWith('on')) {
          return (..._args: unknown[]) => NOOP_UNSUBSCRIBE
        }
        return (...args: unknown[]) => httpInvoke(domain, prop, args)
      }
    }
  )
}

const PERF_API = {
  reportInteractive: () => undefined,
  getSnapshot: () => httpInvoke('perf', 'getSnapshot', []),
  resetSnapshot: () => httpInvoke('perf', 'resetSnapshot', []),
  isEnabled: () => false
}

const SHELL_API = {
  openExternal: (url: string) => {
    if (!isUrlSafeForExternal(url)) {
      return Promise.resolve({ success: false, error: 'URL not allowed' } as unknown)
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve({ success: true } as unknown)
  },
  showItemInFolder: () => Promise.resolve({ ok: false } as unknown),
  updateDomains: (_domains: string[]) => Promise.resolve(undefined)
}

const SYSTEM_API = {
  getVersion: () => Promise.resolve({ app: __APP_VERSION__, electron: 'web' }),
  getUserDataPath: () => Promise.resolve('web'),
  getCpuCount: () => Promise.resolve(navigator.hardwareConcurrency || 1),
  setWorkerThreads: (_count: number) => Promise.resolve(undefined),
  getWorkerThreads: () => Promise.resolve(0),
  getLogFilePath: () => Promise.resolve('')
}

const idleUpdateStatus: UpdateStatus = { state: 'idle' }

const UPDATER_API = {
  checkForUpdate: () => Promise.resolve(undefined),
  downloadUpdate: () => Promise.resolve(undefined),
  installUpdate: () => Promise.resolve(undefined),
  getStatus: () => Promise.resolve(idleUpdateStatus),
  onStatusChange: (_callback: (status: UpdateStatus) => void) => NOOP_UNSUBSCRIBE
}

function buildImportApi(): unknown {
  const rpc = buildDomainProxy('import') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onProgress') {
          return (callback: (progress: unknown) => void) =>
            subscribeWebEvent('import:progress', callback)
        }
        if (prop === 'selectFile') {
          return async () => {
            const refs = await pickAndUploadFiles({
              multiple: false,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
            return refs[0] ?? null
          }
        }
        if (prop === 'selectFiles') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectBedFile') {
          return async () => {
            const refs = await pickAndUploadFiles({ multiple: false, accept: '.bed,.bed.gz,.gz' })
            return refs[0] ?? null
          }
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

function buildBatchImportApi(): unknown {
  const rpc = buildDomainProxy('batch-import') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onProgress') {
          return (callback: (progress: unknown) => void) =>
            subscribeWebEvent('batch-import:progress', callback)
        }
        if (prop === 'onComplete') {
          return (callback: (result: unknown) => void) =>
            subscribeWebEvent('batch-import:complete', callback)
        }
        if (prop === 'selectFiles') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectFolder') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              directory: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectZip') {
          return async () => {
            const refs = await pickAndUploadFiles({ multiple: false, accept: '.zip' })
            const filePath = refs[0]
            if (filePath === undefined) return null

            const passwordProbe = await httpInvoke('batch-import', 'testZipPassword', [
              filePath,
              ''
            ])
            if (isIpcError(passwordProbe)) return passwordProbe
            const isEncrypted = !(passwordProbe as { success: boolean }).success
            return { filePath, isEncrypted }
          }
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

const DOMAIN_OVERRIDES: Record<string, unknown> = {
  batchImport: buildBatchImportApi(),
  'batch-import': buildBatchImportApi(),
  import: buildImportApi(),
  perf: PERF_API,
  shell: SHELL_API,
  system: SYSTEM_API,
  updater: UPDATER_API
}

export function createApi(): WindowAPI {
  return new Proxy({} as WindowAPI, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined
      if (prop in DOMAIN_OVERRIDES) return DOMAIN_OVERRIDES[prop]
      return buildDomainProxy(prop)
    }
  }) as WindowAPI
}
