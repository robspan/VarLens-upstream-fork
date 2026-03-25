import { createRouter, createMemoryHistory } from 'vue-router'

/**
 * Vue Router for VarLens.
 *
 * Uses memory history (no URL bar in Electron) with two main routes:
 * - /case — single case analysis (default)
 * - /cohort — multi-case cohort analysis
 *
 * Both routes are lazy-loaded to reduce initial bundle size.
 * The non-default route chunk is prefetched during idle time
 * so the first navigation is instant.
 */

// Keep a reference to the lazy import so we can prefetch it
const loadCohortView = () => import('../views/CohortView.vue')

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      redirect: '/case'
    },
    {
      path: '/case',
      name: 'case',
      component: () => import('../views/CaseView.vue')
    },
    {
      path: '/cohort',
      name: 'cohort',
      component: loadCohortView
    }
  ]
})

// Prefetch CohortView chunk during idle time after initial load.
// This eliminates the lazy-load delay on first navigation to Cohort.
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    loadCohortView()
  })
} else {
  setTimeout(() => {
    loadCohortView()
  }, 2000)
}

export default router
