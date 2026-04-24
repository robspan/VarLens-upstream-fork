import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/case-metadata-logic'
import type { StorageSession } from '../../../src/main/storage/session'

function createSession() {
  const readExecute = vi.fn()
  const writeExecute = vi.fn()
  const session = {
    getReadExecutor: () => ({ execute: readExecute }),
    getWriteExecutor: () => ({ execute: writeExecute })
  } as unknown as StorageSession

  return { getSession: () => session, readExecute, writeExecute }
}

describe('case-metadata-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.getMetadata).toBe('function')
    expect(typeof logic.upsertMetadata).toBe('function')
    expect(typeof logic.listCohorts).toBe('function')
    expect(typeof logic.createCohort).toBe('function')
    expect(typeof logic.updateCohort).toBe('function')
    expect(typeof logic.deleteCohort).toBe('function')
    expect(typeof logic.getCohortByName).toBe('function')
    expect(typeof logic.getCaseCohorts).toBe('function')
    expect(typeof logic.assignCohort).toBe('function')
    expect(typeof logic.removeCohort).toBe('function')
    expect(typeof logic.setCohorts).toBe('function')
    expect(typeof logic.getHpoTerms).toBe('function')
    expect(typeof logic.assignHpoTerm).toBe('function')
    expect(typeof logic.removeHpoTerm).toBe('function')
    expect(typeof logic.getDataInfo).toBe('function')
    expect(typeof logic.upsertDataInfo).toBe('function')
  })
})

describe('case-metadata-logic storage executor routing', () => {
  it('routes read helpers through the active read executor', async () => {
    const { getSession, readExecute } = createSession()
    readExecute.mockResolvedValue('read-result')

    await expect(logic.getMetadata(1, getSession)).resolves.toBe('read-result')
    await expect(logic.listCohorts(getSession)).resolves.toBe('read-result')
    await expect(logic.getCohortByName('research', getSession)).resolves.toBe('read-result')
    await expect(logic.getCaseCohorts(1, getSession)).resolves.toBe('read-result')
    await expect(logic.getHpoTerms(1, getSession)).resolves.toBe('read-result')
    await expect(logic.getDataInfo(1, getSession)).resolves.toBe('read-result')
    await expect(logic.listExternalIds(1, getSession)).resolves.toBe('read-result')
    await expect(logic.distinctHpoTerms(getSession)).resolves.toBe('read-result')
    await expect(logic.distinctPlatforms(getSession)).resolves.toBe('read-result')
    await expect(logic.distinctExternalIdTypes(getSession)).resolves.toBe('read-result')
    await expect(logic.getFullMetadata(1, getSession)).resolves.toBe('read-result')

    expect(readExecute.mock.calls.map(([task]) => task)).toEqual([
      { type: 'case-metadata:get', params: [1] },
      { type: 'case-metadata:listCohorts', params: [] },
      { type: 'case-metadata:getCohortByName', params: ['research'] },
      { type: 'case-metadata:getCaseCohorts', params: [1] },
      { type: 'case-metadata:getHpoTerms', params: [1] },
      { type: 'case-metadata:getDataInfo', params: [1] },
      { type: 'case-metadata:listExternalIds', params: [1] },
      { type: 'case-metadata:distinctHpoTerms', params: [] },
      { type: 'case-metadata:distinctPlatforms', params: [] },
      { type: 'case-metadata:distinctExternalIdTypes', params: [] },
      { type: 'case-metadata:getFullMetadata', params: [1] }
    ])
  })

  it('routes write helpers through the active write executor', async () => {
    const { getSession, writeExecute } = createSession()
    writeExecute.mockResolvedValue('write-result')

    await expect(
      logic.upsertMetadata(1, { affected_status: 'affected', age: 42 }, getSession)
    ).resolves.toBe('write-result')
    await expect(
      logic.createCohort({ name: 'research', description: null }, getSession)
    ).resolves.toBe('write-result')
    await expect(logic.updateCohort(2, { name: 'updated' }, getSession)).resolves.toBe(
      'write-result'
    )
    await expect(logic.deleteCohort(2, getSession)).resolves.toBe('write-result')
    await expect(logic.assignCohort(1, 2, getSession)).resolves.toBe('write-result')
    await expect(logic.removeCohort(1, 2, getSession)).resolves.toBe('write-result')
    await expect(logic.setCohorts(1, [2, 3], getSession)).resolves.toBe('write-result')
    await expect(logic.assignHpoTerm(1, 'HP:0001250', 'Seizure', getSession)).resolves.toBe(
      'write-result'
    )
    await expect(logic.removeHpoTerm(1, 'HP:0001250', getSession)).resolves.toBe('write-result')
    await expect(logic.upsertDataInfo(1, { platform: 'WGS' }, getSession)).resolves.toBe(
      'write-result'
    )
    await expect(logic.upsertExternalId(1, 'MRN', '12345', getSession)).resolves.toBe(
      'write-result'
    )
    await expect(logic.deleteExternalId(1, 'MRN', getSession)).resolves.toBe('write-result')

    expect(writeExecute.mock.calls.map(([task]) => task)).toEqual([
      { type: 'case-metadata:upsert', params: [1, { affected_status: 'affected', age: 42 }] },
      { type: 'case-metadata:createCohort', params: [{ name: 'research', description: null }] },
      { type: 'case-metadata:updateCohort', params: [2, { name: 'updated' }] },
      { type: 'case-metadata:deleteCohort', params: [2] },
      { type: 'case-metadata:assignCohort', params: [1, 2] },
      { type: 'case-metadata:removeCohort', params: [1, 2] },
      { type: 'case-metadata:setCohorts', params: [1, [2, 3]] },
      { type: 'case-metadata:assignHpoTerm', params: [1, 'HP:0001250', 'Seizure'] },
      { type: 'case-metadata:removeHpoTerm', params: [1, 'HP:0001250'] },
      { type: 'case-metadata:upsertDataInfo', params: [1, { platform: 'WGS' }] },
      { type: 'case-metadata:upsertExternalId', params: [1, 'MRN', '12345'] },
      { type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] }
    ])
  })
})
