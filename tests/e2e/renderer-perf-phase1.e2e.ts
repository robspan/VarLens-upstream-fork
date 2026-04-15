import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import { performance } from 'perf_hooks'
import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'
import { importFrozenPerfFixture, PERF_CASE_NAMES, selectCaseByName } from './helpers/perf-fixture'
import {
  writeJsonArtifact,
  type WorkflowRunArtifact,
  summarizeWorkflowRuns
} from './helpers/perf-artifacts'
import {
  getPerfOutputRoot,
  getPerfWorkflowCommand,
  getPerfWorkflowNames,
  type PerfWorkflowName
} from './helpers/perf-workflows'

interface PerfSnapshot {
  main: {
    elapsedMs: number
    milestones: Record<string, number>
  }
  renderer: {
    traces: Array<{ name: string; duration: number }>
    longTasks: {
      count: number
      totalDurationMs: number
      maxDurationMs: number
    }
  }
}

async function resetPerfSnapshot(window: Page): Promise<void> {
  await window.evaluate(async () => {
    await window.api.perf.resetSnapshot()
  })
}

async function getPerfSnapshot(window: Page): Promise<PerfSnapshot> {
  return await window.evaluate(async () => {
    return await window.api.perf.getSnapshot()
  })
}

async function closeBlockingDrawers(window: Page): Promise<void> {
  const variantDetailsTitle = window.getByText('Variant Details', { exact: true })
  if (await variantDetailsTitle.isVisible()) {
    const closedVariantDetails = await window.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.v-toolbar-title__placeholder'))
      const title = titles.find((node) => node.textContent?.trim() === 'Variant Details')
      const drawer = title?.closest('nav')
      const closeButton = drawer?.querySelector('.v-toolbar button') as HTMLButtonElement | null
      closeButton?.click()
      return closeButton !== null
    })

    if (closedVariantDetails) {
      await window.waitForTimeout(200)
    }
  }

  const scrim = window.locator('.v-navigation-drawer__scrim').first()
  if ((await scrim.count()) > 0 && (await scrim.isVisible())) {
    const box = await scrim.boundingBox()
    if (box) {
      await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    } else {
      await window.keyboard.press('Escape')
    }
    await expect(scrim).toBeHidden()
  }
}

async function ensureConcreteCaseTab(window: Page): Promise<void> {
  await closeBlockingDrawers(window)
  const variantTabs = window.locator('.variant-type-tabs .v-tab')
  const tabCount = await variantTabs.count()
  if (tabCount < 2) return

  const firstTabText = (await variantTabs.nth(0).textContent()) ?? ''
  if (firstTabText.includes('Shortlist')) {
    await variantTabs.nth(1).click()
  }
}

function makeWorkflowRun(runIndex: number, warmup: boolean, durationMs: number, snapshot: PerfSnapshot) {
  return {
    runIndex,
    warmup,
    durationMs: Math.round(durationMs * 100) / 100,
    longTaskCount: snapshot.renderer.longTasks.count,
    maxSingleLongTaskMs: snapshot.renderer.longTasks.maxDurationMs
  } satisfies WorkflowRunArtifact
}

async function measureStartupShell(runIndex: number): Promise<WorkflowRunArtifact> {
  const launched = await launchElectronApp({ perfMode: true })
  const warmup = runIndex < 2
  const startedAt = performance.now()

  try {
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)
    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    const snapshot = await getPerfSnapshot(launched.window)
    return makeWorkflowRun(runIndex, warmup, performance.now() - startedAt, snapshot)
  } finally {
    await launched.cleanup()
  }
}

async function prepareLoadedApp() {
  const launched = await launchElectronApp({ perfMode: true })
  await waitForAppShell(launched.window)
  await dismissDisclaimerIfPresent(launched.window)
  const importedCases = await importFrozenPerfFixture(launched.window)
  const caseCount = await launched.window.evaluate(async () => {
    const cases = await window.api.cases.list()
    return cases.length
  })
  expect(caseCount).toBe(3)
  await launched.window.reload()
  await waitForAppShell(launched.window)
  await dismissDisclaimerIfPresent(launched.window)
  return { ...launched, importedCases }
}

async function measureCaseSelectVisibleRows(
  window: Page,
  caseName: string,
  runIndex: number
): Promise<WorkflowRunArtifact> {
  await window.locator('.mode-toggle .v-btn').nth(0).click()
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await selectCaseByName(window, caseName)
  await ensureConcreteCaseTab(window)
  await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureFilterApply(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  const clearAllButton = window.locator('.applied-filters-bar .v-btn:has-text("Clear all")').first()
  if ((await clearAllButton.count()) > 0) {
    await clearAllButton.click()
    await window.waitForTimeout(250)
  }

  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  const filtersButton = window.locator('.v-btn:has-text("Filters")').first()
  await filtersButton.click()
  const afPreset = window.getByText('<= 1%', { exact: true })
  await afPreset.click()
  await closeBlockingDrawers(window)
  await expect(window.locator('.applied-filters-bar')).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measurePageNextPrev(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  const clearAllButton = window.locator('.applied-filters-bar .v-btn:has-text("Clear all")').first()
  if ((await clearAllButton.count()) > 0) {
    await clearAllButton.click()
    await window.waitForTimeout(250)
  }

  const nextButton = window.getByLabel('Next page')
  const previousButton = window.getByLabel('Previous page')

  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await nextButton.click()
  await previousButton.click()
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureCohortToggle(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await window.locator('.mode-toggle .v-btn').nth(1).click()
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  await window.locator('.mode-toggle .v-btn').nth(0).click()
  await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureKeyboardNavBurst(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  await window.locator('.v-data-table tbody tr').first().click()
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(window.locator('tbody tr.variant-row--selected').first()).toBeVisible({
    timeout: 15000
  })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

const selectedWorkflows = new Set(getPerfWorkflowNames())

test.describe.serial('Phase 1 renderer perf baseline', () => {
  test.setTimeout(600000)

  test('filter workflow leaves no blocking drawer state behind', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureFilterApply(launched.window, 0)

      await expect(launched.window.locator('.v-navigation-drawer__scrim')).toBeHidden()
      await ensureConcreteCaseTab(launched.window)
      await expect(launched.window.locator('.filter-toolbar-container')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('case reselection reopens the sidebar after row interaction workflows', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureKeyboardNavBurst(launched.window, 0)
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[1], 1)

      await expect(launched.window.locator('.filter-toolbar-container')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('keyboard navigation workflow leaves filter controls reachable', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureKeyboardNavBurst(launched.window, 0)
      await measureFilterApply(launched.window, 1)

      await expect(launched.window.locator('.applied-filters-bar')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('captures frozen-fixture baseline artifacts', async () => {
    const startupRuns: WorkflowRunArtifact[] = []
    for (let runIndex = 0; runIndex < 12; runIndex += 1) {
      startupRuns.push(await measureStartupShell(runIndex))
    }

    const launched = await prepareLoadedApp()

    try {
      const runManifest = {
        gitSha: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
        nodeVersion: process.versions.node,
        electronVersion: (await launched.window.evaluate(async () => {
          const version = await window.api.system.getVersion()
          return version.electron
        })) as string,
        runParameters: {
          fixturePath: 'tests/fixtures/import/columnar-format.json.gz',
          importsPerBaseline: 3,
          runCount: 12,
          warmupDiscarded: 2,
          measuredRuns: 10
        },
        importedCases: launched.importedCases,
        manualChecks: {
          acPowerConfirmed: false,
          otherElectronSessionsClosed: false
        },
        commands: [
          'npm run rebuild:electron',
          'npm run build',
          getPerfWorkflowCommand(getPerfOutputRoot())
        ]
      }
      writeJsonArtifact('run-manifest.json', runManifest)

      const workflowRuns: Record<string, WorkflowRunArtifact[]> = {
        'startup-shell': startupRuns,
        'case-select-visible-rows': [],
        'filter-apply': [],
        'page-next-prev': [],
        'cohort-toggle': [],
        'keyboard-nav-burst': []
      }

      for (let runIndex = 0; runIndex < 12; runIndex += 1) {
        const caseName = PERF_CASE_NAMES[runIndex % PERF_CASE_NAMES.length]
        const caseSelectRun = await measureCaseSelectVisibleRows(launched.window, caseName, runIndex)
        const filterApplyRun = await measureFilterApply(launched.window, runIndex)
        const pageNextPrevRun = await measurePageNextPrev(launched.window, runIndex)
        const cohortToggleRun = await measureCohortToggle(launched.window, runIndex)
        const keyboardNavRun = await measureKeyboardNavBurst(launched.window, runIndex)

        if (selectedWorkflows.has('case-select-visible-rows')) {
          workflowRuns['case-select-visible-rows'].push(caseSelectRun)
        }
        if (selectedWorkflows.has('filter-apply')) {
          workflowRuns['filter-apply'].push(filterApplyRun)
        }
        if (selectedWorkflows.has('page-next-prev')) {
          workflowRuns['page-next-prev'].push(pageNextPrevRun)
        }
        if (selectedWorkflows.has('cohort-toggle')) {
          workflowRuns['cohort-toggle'].push(cohortToggleRun)
        }
        if (selectedWorkflows.has('keyboard-nav-burst')) {
          workflowRuns['keyboard-nav-burst'].push(keyboardNavRun)
        }
      }

      for (const [workflowName, runs] of Object.entries(workflowRuns)) {
        if (runs.length === 0) continue
        writeJsonArtifact(`workflows/${workflowName}/raw-runs.json`, runs)
        writeJsonArtifact(`workflows/${workflowName}/summary.json`, summarizeWorkflowRuns(runs))
      }

      for (const workflowName of Object.keys(workflowRuns) as PerfWorkflowName[]) {
        if (!selectedWorkflows.has(workflowName)) continue
        const summary = summarizeWorkflowRuns(workflowRuns[workflowName])
        expect(summary.measuredRuns).toBe(10)
        expect(Object.keys(summary).sort()).toEqual(
          [
            'maxSingleLongTaskMs',
            'measuredRuns',
            'medianLongTaskCount',
            'p50Ms',
            'p95Ms'
          ].sort()
        )
      }
    } finally {
      await launched.cleanup()
    }
  })
})
