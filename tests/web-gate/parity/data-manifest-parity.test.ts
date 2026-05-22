import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'

import {
  ELECTRON_BUILD,
  HAS_PG,
  MANIFEST_PATH,
  REPORT_JSON_PATH,
  SHOULD_RUN,
  SNAPSHOT_PATH,
  UPDATE_FLAG,
  buildScenarioReport,
  buildScenarioTasks,
  getGitSha,
  loadManifest,
  loadSnapshot,
  runTaskOnElectron,
  runTaskOnWeb,
  saveSnapshot,
  writeReport,
  type ParityRunReport,
  type ParitySnapshot,
  type ScenarioSnapshot
} from './data-manifest-parity-support'

describe.skipIf(!SHOULD_RUN || !existsSync(ELECTRON_BUILD) || !HAS_PG)(
  'web data parity E2E',
  () => {
    test('manifest-backed fixtures import and query identically on desktop SQLite and web Postgres', async () => {
      const runStartedAt = new Date()
      const tasks = buildScenarioTasks(loadManifest())
      const report: ParityRunReport = {
        schemaVersion: 1,
        status: 'failed',
        generatedAt: runStartedAt.toISOString(),
        finishedAt: null,
        durationMs: null,
        gitSha: getGitSha(),
        manifestPath: MANIFEST_PATH,
        snapshotPath: SNAPSHOT_PATH,
        reportPath: REPORT_JSON_PATH,
        scenarioCount: tasks.length,
        scenarios: []
      }
      const electronScenarios: ScenarioSnapshot[] = []
      const webScenarios: ScenarioSnapshot[] = []
      const failedScenarioIds: string[] = []

      try {
        for (const task of tasks) {
          const scenarioStartedAt = new Date()
          let electronScenario: ScenarioSnapshot | undefined
          let webScenario: ScenarioSnapshot | undefined

          try {
            electronScenario = await runTaskOnElectron(task)
            webScenario = await runTaskOnWeb(task)

            expect(webScenario, `scenario ${task.id}`).toEqual(electronScenario)

            report.scenarios.push(
              buildScenarioReport(
                task,
                'passed',
                scenarioStartedAt,
                new Date(),
                electronScenario,
                webScenario
              )
            )

            electronScenarios.push(electronScenario)
            webScenarios.push(webScenario)
          } catch (error) {
            report.scenarios.push(
              buildScenarioReport(
                task,
                'failed',
                scenarioStartedAt,
                new Date(),
                electronScenario,
                webScenario,
                error
              )
            )
            failedScenarioIds.push(task.id)
          } finally {
            writeReport(report)
          }
        }

        if (failedScenarioIds.length > 0) {
          throw new Error(`Parity failed for scenario(s): ${failedScenarioIds.join(', ')}`)
        }

        const electronSnapshot: ParitySnapshot = {
          schemaVersion: 1,
          generatedFrom: 'scripts/data-fixtures/sources.json',
          scenarios: electronScenarios.sort((a, b) => a.id.localeCompare(b.id))
        }
        const webSnapshot: ParitySnapshot = {
          schemaVersion: 1,
          generatedFrom: 'scripts/data-fixtures/sources.json',
          scenarios: webScenarios.sort((a, b) => a.id.localeCompare(b.id))
        }

        expect(webSnapshot).toEqual(electronSnapshot)

        const update = process.env[UPDATE_FLAG] === '1'
        const existing = loadSnapshot()
        if (update || existing === null) {
          saveSnapshot(electronSnapshot)
        } else {
          expect(electronSnapshot).toEqual(existing)
        }

        report.status = 'passed'
      } finally {
        const finishedAt = new Date()
        report.finishedAt = finishedAt.toISOString()
        report.durationMs = finishedAt.getTime() - runStartedAt.getTime()
        writeReport(report)
      }
    }, 300_000)
  }
)

describe.skipIf(SHOULD_RUN && existsSync(ELECTRON_BUILD) && HAS_PG)(
  'web data parity skipped notice',
  () => {
    test('parity data E2E is opt-in and requires Electron build plus VARLENS_PG_URL', () => {
      expect(SHOULD_RUN ? existsSync(ELECTRON_BUILD) && HAS_PG : true).toBe(true)
    })
  }
)
