import { computed } from 'vue'
import { useDisplay } from 'vuetify'

export type LayoutTier = 'full' | 'compact' | 'narrow'

export function useResponsiveLayout() {
  const { mdAndUp, lgAndUp, width } = useDisplay()

  const tier = computed<LayoutTier>(() => {
    if (lgAndUp.value) return 'full'
    if (mdAndUp.value) return 'compact'
    return 'narrow'
  })

  // Sidebar defaults by tier (user can still resize)
  const defaultSidebarWidth = computed(() => {
    if (tier.value === 'narrow') return 300
    if (tier.value === 'compact') return 240
    return 280
  })

  // Show text labels on CASE/COHORT toggle buttons
  const showModeToggleLabels = computed(() => tier.value === 'full')

  // Show context indicator (case name) in app bar
  const showContextIndicator = computed(() => tier.value !== 'narrow')

  // Show individual footer link buttons vs overflow menu
  const showFooterLinks = computed(() => tier.value !== 'narrow')

  // Detail panel becomes full-width overlay at narrow
  const detailPanelFullWidth = computed(() => tier.value === 'narrow')

  // Maximum columns to auto-show by tier
  const maxAutoVisibleColumns = computed(() => {
    if (tier.value === 'narrow') return 5
    if (tier.value === 'compact') return 10
    return Infinity
  })

  // Column priority for auto-hide (lower = more important, shown first)
  const COLUMN_PRIORITY: Record<string, number> = {
    gene_symbol: 1,
    consequence: 2,
    clinvar: 3,
    gnomad_af: 4,
    cadd: 5,
    annotations: 6,
    func: 7,
    chr: 8,
    pos: 9,
    ref: 10,
    alt: 11,
    gt_num: 12,
    aa_change: 13,
    cdna: 14,
    transcript: 15,
    omim_mim_number: 16,
    hpo_sim_score: 17,
    qual: 18,
    moi: 19
  }

  // Get priority for a column (unknown columns get lowest priority)
  const getColumnPriority = (key: string): number => {
    return COLUMN_PRIORITY[key] ?? 100
  }

  return {
    tier,
    width,
    defaultSidebarWidth,
    showModeToggleLabels,
    showContextIndicator,
    showFooterLinks,
    detailPanelFullWidth,
    maxAutoVisibleColumns,
    getColumnPriority
  }
}
