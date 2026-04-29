import { describe, expect, it } from 'vitest'

import {
  getUnsupportedReason,
  canUseFeature
} from '../../src/renderer/src/utils/backend-capabilities'
import type { StorageCapabilities } from '../../src/shared/types/storage-capabilities'

const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  workspace: {
    localFileLifecycle: false,
    hostedConnectionLifecycle: true,
    encryptionAtRest: false,
    migrations: false,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: false,
    deleteMany: false,
    deleteAll: false,
    overview: false
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: false,
    filterOptions: false,
    columnMeta: false,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: false,
    tagFilters: false,
    commentFilters: false,
    acmgFilters: false,
    annotationFilters: false,
    inheritanceFilters: false,
    analysisGroupFilters: false,
    phasingFilters: false
  },
  workflow: {
    tags: false,
    annotations: false,
    caseComments: false,
    caseMetrics: false,
    filterPresets: false,
    panels: false,
    geneLists: false,
    regionFiles: false,
    analysisGroups: false,
    auditLog: false
  },
  cohort: {
    query: false,
    summary: false,
    rebuild: false,
    carriers: false,
    geneBurden: false,
    columnMeta: false
  },
  export: {
    variants: false,
    cohort: false,
    streaming: false
  }
}

describe('renderer backend capability helpers', () => {
  it('allows supported features', () => {
    expect(canUseFeature(POSTGRES_CAPABILITIES, 'variants.query')).toBe(true)
  })

  it('blocks unsupported PostgreSQL features with a useful reason', () => {
    expect(canUseFeature(POSTGRES_CAPABILITIES, 'variants.filterOptions')).toBe(false)
    expect(getUnsupportedReason(POSTGRES_CAPABILITIES, 'variants.filterOptions')).toContain(
      'not available for PostgreSQL'
    )
  })
})
