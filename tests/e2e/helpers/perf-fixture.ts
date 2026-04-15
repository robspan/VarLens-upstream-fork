import type { Page } from '@playwright/test'
import { resolveAppPath } from './electron-app'

export const PERF_CASE_NAMES = ['perf-case-a', 'perf-case-b', 'perf-case-c'] as const
export const PERF_FIXTURE_PATH = resolveAppPath('tests/fixtures/import/columnar-format.json.gz')

interface ImportedCase {
  caseId: number
  caseName: string
  variantCount: number
}

export async function importFrozenPerfFixture(window: Page): Promise<ImportedCase[]> {
  const importedCases: ImportedCase[] = []

  for (const caseName of PERF_CASE_NAMES) {
    const importedCase = await window.evaluate(
      async ([filePath, nextCaseName]) => {
        const result = await window.api.import.start(filePath, nextCaseName)
        return {
          caseId: result.caseId,
          caseName: nextCaseName,
          variantCount: result.variantCount
        }
      },
      [PERF_FIXTURE_PATH, caseName] as const
    )

    importedCases.push(importedCase)
  }

  return importedCases
}

export async function ensureSidebarVisible(window: Page): Promise<void> {
  const openSidebarButton = window.getByLabel('Open sidebar')
  if (await openSidebarButton.isVisible()) {
    await openSidebarButton.click()
    await window.waitForTimeout(300)
  }
}

export async function selectCaseByName(window: Page, caseName: string): Promise<void> {
  await ensureSidebarVisible(window)
  const caseItem = window
    .locator('.v-navigation-drawer .v-list-item')
    .filter({ hasText: caseName })
    .first()
  await caseItem.scrollIntoViewIfNeeded()
  await caseItem.click()

  const scrim = window.locator('.v-navigation-drawer__scrim')
  if ((await scrim.count()) > 0 && (await scrim.first().isVisible())) {
    await window.keyboard.press('Escape')
    await window.waitForTimeout(200)
  }
}
