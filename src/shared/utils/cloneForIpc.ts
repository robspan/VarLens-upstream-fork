/**
 * Sprint A A2: cross-process / main-side deep clone.
 *
 * Use this when input is ALREADY plain JS (i.e. no Vue reactive()/ref()
 * proxies). For renderer state that may contain proxies, use
 * `src/renderer/src/utils/stripVueProxies.ts` — it strips and clones in one
 * pass; `structuredClone` would throw DataCloneError on a Vue proxy, which
 * is the loud failure mode we want when this helper is misused.
 */
export function cloneForIpc<T>(value: T): T {
  return structuredClone(value)
}
