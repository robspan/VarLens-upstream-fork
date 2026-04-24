import { expect, test } from '@playwright/test'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

function expectSuccessfulIpcResult<T>(result: T): T {
  expect(result).not.toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      userMessage: expect.any(String)
    })
  )

  return result
}

test('postgres dev mode supports case metadata APIs and case filters', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched:
    | Awaited<ReturnType<typeof launchElectronApp>>
    | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const results = await launched.window.evaluate(async () => {
      const cohortCases = await window.api.cases.query({
        limit: 25,
        offset: 0,
        cohort_ids: [1]
      })
      const hpoCases = await window.api.cases.query({
        limit: 25,
        offset: 0,
        hpo_ids: ['HP:0001250']
      })
      const fullMetadata = await window.api.caseMetadata.getFullMetadata(1)
      const assignedHpoTerm = await window.api.caseMetadata.assignHpoTerm(
        2,
        'HP:0000707',
        'Abnormality of the nervous system'
      )

      return {
        cohortCases,
        hpoCases,
        fullMetadata,
        assignedHpoTerm
      }
    })

    const cohortCases = expectSuccessfulIpcResult(results.cohortCases)
    expect(cohortCases).toMatchObject({
      total_count: 2,
      data: [
        expect.objectContaining({
          id: 3,
          name: 'Newest Case',
          cohort_ids: expect.arrayContaining([1]),
          cohort_names: expect.arrayContaining(['rare disease'])
        }),
        expect.objectContaining({
          id: 1,
          name: 'Oldest Case',
          cohort_ids: expect.arrayContaining([1]),
          cohort_names: expect.arrayContaining(['rare disease'])
        })
      ]
    })

    const hpoCases = expectSuccessfulIpcResult(results.hpoCases)
    expect(hpoCases).toMatchObject({
      total_count: 1,
      data: [
        expect.objectContaining({
          id: 1,
          name: 'Oldest Case',
          affected_status: 'affected',
          sex: 'female'
        })
      ]
    })

    const fullMetadata = expectSuccessfulIpcResult(results.fullMetadata)
    expect(fullMetadata).toMatchObject({
      metadata: expect.objectContaining({
        case_id: 1,
        affected_status: 'affected',
        sex: 'female',
        notes: 'index case'
      }),
      cohorts: [
        expect.objectContaining({
          id: 1,
          name: 'rare disease'
        })
      ],
      hpoTerms: [
        expect.objectContaining({
          case_id: 1,
          hpo_id: 'HP:0001250',
          hpo_label: 'Seizure'
        })
      ],
      comments: [
        expect.objectContaining({
          case_id: 1,
          category: 'clinical',
          content: 'Reviewed for PostgreSQL parity smoke'
        })
      ],
      metrics: [
        expect.objectContaining({
          case_id: 1,
          numeric_value: 42
        })
      ],
      dataInfo: null,
      externalIds: []
    })

    const assignedHpoTerm = expectSuccessfulIpcResult(results.assignedHpoTerm)
    expect(assignedHpoTerm).toMatchObject({
      case_id: 2,
      hpo_id: 'HP:0000707',
      hpo_label: 'Abnormality of the nervous system'
    })
    expect(assignedHpoTerm).toHaveProperty('id')
    expect(assignedHpoTerm).toHaveProperty('created_at')
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
