import { computed, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { Variant } from '../../../../shared/types/api'
import type { RowViewModel } from './useVariantRowViewModel'

export interface VariantRenderRow extends Variant {
  render: RowViewModel
}

const EMPTY_RENDER: RowViewModel = Object.freeze({
  links: {},
  isStarred: false,
  isGlobalStarred: false,
  acmgClassification: null,
  globalAcmgClassification: null,
  hasComment: false,
  hasGlobalComment: false
})

function variantKey(variant: Pick<Variant, 'chr' | 'pos' | 'ref' | 'alt'>): string {
  return `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}`
}

type VariantRenderRowCache = Map<string, VariantRenderRow>

export function buildVariantRenderRows(
  variants: Variant[],
  rowViewModels: Map<string, RowViewModel>,
  cache: VariantRenderRowCache = new Map()
): VariantRenderRow[] {
  const nextCache: VariantRenderRowCache = new Map()
  const rows = variants.map((variant) => {
    const key = variantKey(variant)
    const render = rowViewModels.get(key) ?? EMPTY_RENDER
    const cached = cache.get(key)

    if (cached) {
      Object.assign(cached, variant)
      cached.render = render
      nextCache.set(key, cached)
      return cached
    }

    const row: VariantRenderRow = {
      ...variant,
      render
    }
    nextCache.set(key, row)
    return row
  })

  cache.clear()
  for (const [key, row] of nextCache) {
    cache.set(key, row)
  }

  return rows
}

export function useVariantRenderRows(
  variants: Ref<Variant[]>,
  rowViewModels: ComputedRef<Map<string, RowViewModel>>
) {
  const rowCache = shallowRef<VariantRenderRowCache>(new Map())
  const renderRows = computed(() =>
    buildVariantRenderRows(variants.value, rowViewModels.value, rowCache.value)
  )

  return { renderRows }
}
