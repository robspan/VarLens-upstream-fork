/**
 * Session-cached extension column metadata and variant-type presence.
 *
 * The case view filter drawer and the cohort view filter bar both need
 * per-column metadata (min/max/distinct) and the set of variant types
 * present in the current scope. These queries are expensive and stable
 * between filter clicks, so they're cached per-scope until explicitly
 * invalidated (e.g. after a bulk import or case delete).
 *
 * Cache key format: `case:<id>` for single-case scope, `cases:<sorted,ids>`
 * for cohort scope. The inflight maps deduplicate concurrent requests for
 * the same (scope, columnKey) tuple so rapid filter-drawer opens don't
 * fire duplicate IPC calls.
 *
 * Caches are module-scoped so all callers share the same cache. Tests
 * should call `invalidateAll()` in `beforeEach` to isolate between runs.
 */

import { ref, type Ref } from 'vue'
import { useApiService } from './useApiService'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'

/** Scope for a column-meta lookup — either single-case or cohort. */
export interface VariantColumnMetaScope {
  caseId?: number
  caseIds?: number[]
}

/**
 * Derive a stable cache key from a scope.
 *
 * @param scope - Single-case or cohort scope
 * @returns Stable string key (sorted for cohort scopes so `[3,1,2]` and
 *   `[1,2,3]` collide as expected)
 */
export function cacheKeyFor(scope: VariantColumnMetaScope): string {
  if (scope.caseId !== undefined) return `case:${scope.caseId}`
  if (scope.caseIds !== undefined && scope.caseIds.length > 0) {
    return `cases:${[...scope.caseIds].sort((a, b) => a - b).join(',')}`
  }
  return 'empty'
}

// Module-scoped caches — shared across all useVariantColumnMeta() callers.
const extensionColumnMetaCache = ref<Record<string, Record<string, ColumnFilterMeta>>>({})
const variantTypesPresentCache = ref<Record<string, Set<string>>>({})
const inflightColumnMeta = new Map<string, Promise<ColumnFilterMeta>>()
const inflightTypes = new Map<string, Promise<Set<string>>>()

/**
 * Composable exposing cached extension column metadata and variant-type
 * presence for a given scope (single-case or cohort).
 *
 * @returns Accessors and invalidation helpers
 */
export function useVariantColumnMeta(): {
  getColumnMeta: (
    scope: VariantColumnMetaScope,
    columnKey: string
  ) => Promise<ColumnFilterMeta>
  ensureTypesPresent: (scope: VariantColumnMetaScope) => Promise<Set<string>>
  invalidate: (scope: VariantColumnMetaScope) => void
  invalidateAll: () => void
  extensionColumnMeta: Readonly<Ref<Record<string, Record<string, ColumnFilterMeta>>>>
  variantTypesPresent: Readonly<Ref<Record<string, Set<string>>>>
} {
  const { api, isAvailable } = useApiService()

  /**
   * Fetch metadata for a single column, using the per-scope cache.
   * Concurrent requests for the same (scope, columnKey) share one inflight
   * promise so we issue exactly one IPC call even on rapid duplicate hits.
   */
  async function getColumnMeta(
    scope: VariantColumnMetaScope,
    columnKey: string
  ): Promise<ColumnFilterMeta> {
    const key = cacheKeyFor(scope)
    const cached = extensionColumnMetaCache.value[key]?.[columnKey]
    if (cached !== undefined) return cached

    const inflightKey = `${key}::${columnKey}`
    const existing = inflightColumnMeta.get(inflightKey)
    if (existing !== undefined) return existing

    if (!isAvailable.value || api === undefined) {
      throw new Error('window.api not available (running outside Electron?)')
    }

    const promise = api.variants
      .columnMeta({ caseId: scope.caseId, caseIds: scope.caseIds, columnKey })
      .then((meta) => {
        const bucket = extensionColumnMetaCache.value[key] ?? {}
        bucket[columnKey] = meta
        extensionColumnMetaCache.value[key] = bucket
        inflightColumnMeta.delete(inflightKey)
        return meta
      })
      .catch((err: unknown) => {
        inflightColumnMeta.delete(inflightKey)
        throw err
      })

    inflightColumnMeta.set(inflightKey, promise)
    return promise
  }

  /**
   * Fetch the set of variant types present in the scope. Used by the
   * renderer to hide variant-type tabs with no data.
   */
  async function ensureTypesPresent(scope: VariantColumnMetaScope): Promise<Set<string>> {
    const key = cacheKeyFor(scope)
    const cached = variantTypesPresentCache.value[key]
    if (cached !== undefined) return cached

    const existing = inflightTypes.get(key)
    if (existing !== undefined) return existing

    if (!isAvailable.value || api === undefined) {
      throw new Error('window.api not available (running outside Electron?)')
    }

    const promise = api.variants
      .typesPresent({ caseId: scope.caseId, caseIds: scope.caseIds })
      .then((types) => {
        const set = new Set(types)
        variantTypesPresentCache.value[key] = set
        inflightTypes.delete(key)
        return set
      })
      .catch((err: unknown) => {
        inflightTypes.delete(key)
        throw err
      })

    inflightTypes.set(key, promise)
    return promise
  }

  /** Clear cached entries for a single scope (both column meta and types). */
  function invalidate(scope: VariantColumnMetaScope): void {
    const key = cacheKeyFor(scope)
    delete extensionColumnMetaCache.value[key]
    delete variantTypesPresentCache.value[key]
  }

  /** Clear all caches and drop any inflight promises. */
  function invalidateAll(): void {
    extensionColumnMetaCache.value = {}
    variantTypesPresentCache.value = {}
    inflightColumnMeta.clear()
    inflightTypes.clear()
  }

  return {
    getColumnMeta,
    ensureTypesPresent,
    invalidate,
    invalidateAll,
    extensionColumnMeta: extensionColumnMetaCache as Readonly<
      Ref<Record<string, Record<string, ColumnFilterMeta>>>
    >,
    variantTypesPresent: variantTypesPresentCache as Readonly<Ref<Record<string, Set<string>>>>
  }
}
