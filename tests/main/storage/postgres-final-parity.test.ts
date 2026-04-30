import { describe, expect, it } from 'vitest'

import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('PostgreSQL final parity capabilities', () => {
  it('declares support for scoped final parity features', () => {
    expect(POSTGRES_CAPABILITIES.variants.panelFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.tagFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.commentFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.acmgFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.annotationFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.inheritanceFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.analysisGroupFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.query).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.summary).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.carriers).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.geneBurden).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.columnMeta).toBe(true)
    expect(POSTGRES_CAPABILITIES.export.cohort).toBe(true)
    expect(POSTGRES_CAPABILITIES.workflow.auditLog).toBe(true)
  })
})
