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
 *   - Event subscribers (`onAnnotationChanged`, `onProgress`, ...).
 *     Web mode has no IPC events yet; subscribers receive a no-op
 *     unsubscribe and never fire. Real-time push (websockets) is a
 *     follow-up — the call site doesn't crash today.
 *   - `perf.isEnabled` / `perf.reportInteractive`. Synchronous
 *     boolean / fire-and-forget; stubbed locally.
 *   - `shell.openExternal`. Browser equivalent is `window.open`.
 *
 * Everything else is RPC. The server dispatcher is what enforces which
 * methods actually exist; the Proxy is permissive on purpose.
 */
import type { WindowAPI } from '../../shared/types/api'

interface InvokeBody {
  args: unknown[]
}

// Vite's `base` config materialises here at build time. The browser
// loads the SPA from BASE_URL (e.g. `/varlens/`), so API calls have to
// share that prefix or Caddy's path-based routing won't match.
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

async function httpInvoke(domain: string, method: string, args: unknown[]): Promise<unknown> {
  const body: InvokeBody = { args }
  const res = await fetch(`${API_BASE}/${domain}/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Server returns JSON for both success and error (SerializableError).
  // Non-2xx with non-JSON body is a transport failure — surface it.
  const text = await res.text()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
}

const NOOP_UNSUBSCRIBE = (): void => {}

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
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve({ ok: true } as unknown)
  },
  showItemInFolder: () => Promise.resolve({ ok: false } as unknown),
  updateDomains: (domains: string[]) => httpInvoke('shell', 'updateUserDomains', [domains])
}

const DOMAIN_OVERRIDES: Record<string, unknown> = {
  perf: PERF_API,
  shell: SHELL_API
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
