import { nextTick, watch } from 'vue'
import type { Ref } from 'vue'
import type { Router } from 'vue-router'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

interface UseShellNavigationOptions {
  activeTab: Ref<'case' | 'cohort'>
  sidebarOpen: Ref<boolean>
  panelOpen: Ref<boolean>
  selectedPanelVariant: Ref<Variant | CohortVariant | null>
  transitioning: Ref<boolean>
  router: Router
}

export function useShellNavigation({
  activeTab,
  sidebarOpen,
  panelOpen,
  selectedPanelVariant,
  transitioning,
  router
}: UseShellNavigationOptions): void {
  watch(activeTab, async (newTab) => {
    panelOpen.value = false
    selectedPanelVariant.value = null
    transitioning.value = true

    try {
      if (newTab === 'cohort') {
        sidebarOpen.value = false
        await router.push('/cohort')
      } else {
        await router.push('/case')
      }
    } finally {
      // Allow the activated route view to settle before hiding the overlay.
      await nextTick()
      transitioning.value = false
    }
  })
}
