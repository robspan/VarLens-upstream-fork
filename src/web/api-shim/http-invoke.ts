/**
 * Single fetch entrypoint for every per-domain shim factory.
 *
 * The renderer calls `window.api.cases.list()`. In Electron, `window.api`
 * is the contextBridge object created by src/preload/. In the browser
 * it's the shim assembled from each `create<Domain>Api()` factory in
 * this directory; every factory ultimately delegates to `httpInvoke`,
 * which posts to `/api/<domain>/<method>` and returns the response.
 *
 * - Args travel as `{ args: [...] }` so server-side route handlers can
 *   spread them with `.apply` regardless of arity.
 * - `credentials: 'include'` carries the Phase 3 session cookie on
 *   every call.
 * - Non-2xx responses throw, matching the Electron preload's behaviour
 *   when ipcRenderer.invoke rejects (the renderer's existing error
 *   handlers already cover that path).
 */

export async function httpInvoke<T = unknown>(path: string, args: unknown[]): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${path}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}
