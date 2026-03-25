import { createRouter, createMemoryHistory } from 'vue-router'

/**
 * Vue Router for VarLens.
 *
 * Uses memory history (no URL bar in Electron) with two main routes:
 * - /case — single case analysis (default)
 * - /cohort — multi-case cohort analysis
 *
 * Both routes are lazy-loaded to reduce initial bundle size.
 */
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
      component: () => import('../views/CohortView.vue')
    }
  ]
})

export default router
