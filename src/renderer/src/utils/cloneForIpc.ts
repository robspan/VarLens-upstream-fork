/**
 * Sprint A A2: renderer-side clone-for-IPC.
 *
 * Renderer callers pass Vue reactive()/ref() proxies (e.g. `filters.value`)
 * into this helper before shipping over IPC. The shared `cloneForIpc` is now
 * backed by `structuredClone`, which throws DataCloneError on Vue proxies — so
 * the renderer shim points at `stripVueProxies`, which strips proxies and
 * deep-clones in one pass. Main-side / already-plain callers should import the
 * shared helper directly from `src/shared/utils/cloneForIpc`.
 */
export { stripVueProxies as cloneForIpc } from './stripVueProxies'
