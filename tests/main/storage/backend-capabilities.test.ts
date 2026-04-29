import { describe, expect, it } from 'vitest'

import { SQLITE_CAPABILITIES } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('backend capabilities', () => {
  it('declares SQLite as the complete local backend', () => {
    expect(SQLITE_CAPABILITIES.backend).toBe('sqlite')
    expect(SQLITE_CAPABILITIES.workspace.localFileLifecycle).toBe(true)
    expect(SQLITE_CAPABILITIES.workspace.encryptionAtRest).toBe(true)
    expect(SQLITE_CAPABILITIES.variants.filterOptions).toBe(true)
    expect(SQLITE_CAPABILITIES.variants.columnMeta).toBe(true)
    expect(SQLITE_CAPABILITIES.export.variants).toBe(true)
  })

  it('declares current PostgreSQL support and known deferrals explicitly', () => {
    expect(POSTGRES_CAPABILITIES.backend).toBe('postgres')
    expect(POSTGRES_CAPABILITIES.workspace.hostedConnectionLifecycle).toBe(true)
    expect(POSTGRES_CAPABILITIES.workspace.migrations).toBe(true)
    expect(POSTGRES_CAPABILITIES.imports.vcf).toBe(true)
    expect(POSTGRES_CAPABILITIES.imports.multiFileVcf).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.query).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.searchQuery).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.legacySearch).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.filterOptions).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.columnMeta).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.panelFilters).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.tagFilters).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.commentFilters).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.acmgFilters).toBe(false)
    expect(POSTGRES_CAPABILITIES.export.variants).toBe(false)
    expect(POSTGRES_CAPABILITIES.cases.deleteOne).toBe(false)
  })
})
