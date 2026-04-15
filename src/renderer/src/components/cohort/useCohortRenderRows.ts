import { computed, type ComputedRef, type Ref } from 'vue'
import type { CohortVariant } from '../../../../shared/types/cohort'

export interface CohortRenderRow extends CohortVariant {
  render: {
    links: Record<string, string | null>
  }
}

export type CohortLinkResolver = (item: CohortVariant) => string | null

export function buildCohortRenderRows(
  variants: CohortVariant[],
  linkConfig: Record<string, CohortLinkResolver>
): CohortRenderRow[] {
  return variants.map((variant) => {
    const links: Record<string, string | null> = {}
    for (const [columnKey, resolve] of Object.entries(linkConfig)) {
      links[columnKey] = resolve(variant)
    }

    return {
      ...variant,
      render: { links }
    }
  })
}

export function useCohortRenderRows(
  variants: Ref<CohortVariant[]>,
  linkConfig: ComputedRef<Record<string, CohortLinkResolver>>
) {
  const renderRows = computed(() => buildCohortRenderRows(variants.value, linkConfig.value))

  return { renderRows }
}
