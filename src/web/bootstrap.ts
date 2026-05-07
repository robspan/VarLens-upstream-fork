/**
 * Web-mode entry point.
 *
 * The renderer (`src/renderer/src/main.ts`) reads `window.api`
 * synchronously during Vue setup. We install the HTTP Proxy here
 * BEFORE dynamic-importing the renderer entry — order is load-bearing.
 *
 * The renderer also has a `window.api === undefined` mock fallback;
 * because we assign first, that branch is never taken in web mode.
 */
import type { WindowAPI } from '../shared/types/api'
import { createApi } from './client/api'
;(window as Window & { api: WindowAPI }).api = createApi()

await import('../renderer/src/main')
