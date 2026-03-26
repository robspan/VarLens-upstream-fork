import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('Migration v17 — performance indexes', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  it('creates idx_variant_tags_case_tag composite index', () => {
    const indexes = service.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='variant_tags' AND name='idx_variant_tags_case_tag'"
      )
      .all()
    expect(indexes).toHaveLength(1)
  })

  it('creates idx_cva_case_starred partial index', () => {
    const indexes = service.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='case_variant_annotations' AND name='idx_cva_case_starred'"
      )
      .all()
    expect(indexes).toHaveLength(1)
  })

  it('creates idx_cva_case_acmg index', () => {
    const indexes = service.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='case_variant_annotations' AND name='idx_cva_case_acmg'"
      )
      .all()
    expect(indexes).toHaveLength(1)
  })

  it('creates idx_va_coords_starred index on variant_annotations', () => {
    const indexes = service.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='variant_annotations' AND name='idx_va_coords_starred'"
      )
      .all()
    expect(indexes).toHaveLength(1)
  })

  it('sets user_version to at least 17', () => {
    const result = service.database.pragma('user_version', { simple: true })
    expect(Number(result)).toBeGreaterThanOrEqual(17)
  })
})
