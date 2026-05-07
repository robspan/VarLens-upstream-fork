import type { CaseMetadataDomainContract } from '../../shared/ipc/domains/case-metadata'
import { httpInvoke } from './http-invoke'

export const createCaseMetadataApi = (): CaseMetadataDomainContract => ({
  get: (caseId) => httpInvoke('/api/case-metadata/get', [caseId]),
  upsert: (caseId, updates) => httpInvoke('/api/case-metadata/upsert', [caseId, updates]),
  listCohorts: () => httpInvoke('/api/case-metadata/listCohorts', []),
  createCohort: (name, description) =>
    httpInvoke('/api/case-metadata/createCohort', [name, description]),
  updateCohort: (cohortId, updates) =>
    httpInvoke('/api/case-metadata/updateCohort', [cohortId, updates]),
  deleteCohort: (cohortId) => httpInvoke('/api/case-metadata/deleteCohort', [cohortId]),
  getCohortByName: (name) => httpInvoke('/api/case-metadata/getCohortByName', [name]),
  getCaseCohorts: (caseId) => httpInvoke('/api/case-metadata/getCaseCohorts', [caseId]),
  assignCohort: (caseId, cohortId) =>
    httpInvoke('/api/case-metadata/assignCohort', [caseId, cohortId]),
  removeCohort: (caseId, cohortId) =>
    httpInvoke('/api/case-metadata/removeCohort', [caseId, cohortId]),
  setCohorts: (caseId, cohortIds) =>
    httpInvoke('/api/case-metadata/setCohorts', [caseId, cohortIds]),
  getHpoTerms: (caseId) => httpInvoke('/api/case-metadata/getHpoTerms', [caseId]),
  assignHpoTerm: (caseId, hpoId, hpoLabel) =>
    httpInvoke('/api/case-metadata/assignHpoTerm', [caseId, hpoId, hpoLabel]),
  removeHpoTerm: (caseId, hpoId) => httpInvoke('/api/case-metadata/removeHpoTerm', [caseId, hpoId]),
  getDataInfo: (caseId) => httpInvoke('/api/case-metadata/getDataInfo', [caseId]),
  upsertDataInfo: (caseId, updates) =>
    httpInvoke('/api/case-metadata/upsertDataInfo', [caseId, updates]),
  listExternalIds: (caseId) => httpInvoke('/api/case-metadata/listExternalIds', [caseId]),
  upsertExternalId: (caseId, idType, idValue) =>
    httpInvoke('/api/case-metadata/upsertExternalId', [caseId, idType, idValue]),
  deleteExternalId: (caseId, idType) =>
    httpInvoke('/api/case-metadata/deleteExternalId', [caseId, idType]),
  distinctHpoTerms: () => httpInvoke('/api/case-metadata/distinctHpoTerms', []),
  distinctPlatforms: () => httpInvoke('/api/case-metadata/distinctPlatforms', []),
  distinctExternalIdTypes: () => httpInvoke('/api/case-metadata/distinctExternalIdTypes', []),
  getFullMetadata: (caseId) => httpInvoke('/api/case-metadata/getFullMetadata', [caseId])
})
