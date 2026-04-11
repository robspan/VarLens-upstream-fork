import { describe, it, expect } from 'vitest'
import {
  VARIANT_EXTENSION_REGISTRY,
  EXTENSION_FTS_TABLES,
  EXTENSION_SORTABLE_DOTTED_KEYS,
  EXTENSION_FILTERABLE_DOTTED_KEYS,
  isExtensionColumnKey,
  resolveExtensionColumnKey
} from '../../../src/main/database/variant-extension-registry'

describe('VARIANT_EXTENSION_REGISTRY', () => {
  it('has entries for sv, cnv, str', () => {
    expect(Object.keys(VARIANT_EXTENSION_REGISTRY).sort()).toEqual(['cnv', 'str', 'sv'])
  })

  it('every entry has a unique joinAlias', () => {
    const aliases = Object.values(VARIANT_EXTENSION_REGISTRY).map((d) => d.joinAlias)
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('every entry uses variant_id as the FK column', () => {
    for (const def of Object.values(VARIANT_EXTENSION_REGISTRY)) {
      expect(def.variantIdColumn).toBe('variant_id')
    }
  })

  it('variant_cnv has hasFts=false (no text columns)', () => {
    expect(VARIANT_EXTENSION_REGISTRY.cnv.hasFts).toBe(false)
  })

  it('variant_sv and variant_str have hasFts=true', () => {
    expect(VARIANT_EXTENSION_REGISTRY.sv.hasFts).toBe(true)
    expect(VARIANT_EXTENSION_REGISTRY.str.hasFts).toBe(true)
  })

  it('registry column names match v25 schema exactly (SV subset)', () => {
    const svCols = VARIANT_EXTENSION_REGISTRY.sv.columns
    expect(svCols.support.kind).toBe('number')
    expect(svCols.event_id.fts).toBe(true)
    expect(svCols.mate_id.fts).toBe(true)
    expect(svCols.coverage.kind).toBe('text')
    expect(svCols.coverage.sortable).toBe(false) // caller-specific string
  })

  it('registry column names match v25 schema exactly (STR subset)', () => {
    const strCols = VARIANT_EXTENSION_REGISTRY.str.columns
    expect(strCols.repeat_unit.fts).toBe(true)
    expect(strCols.repeat_unit.kind).toBe('text')
    expect(strCols.alt_copies.sortable).toBe(false) // biallelic "10/12"
    expect(strCols.rank_score.sortable).toBe(false) // text despite name
    expect(strCols.disease.fts).toBe(true)
  })
})

describe('EXTENSION_FTS_TABLES', () => {
  it('contains only entries with hasFts=true (no CNV)', () => {
    const typeKeys = EXTENSION_FTS_TABLES.map((e) => e.typeKey).sort()
    expect(typeKeys).toEqual(['str', 'sv'])
  })

  it('each entry has ftsColumns derived from columns with fts=true', () => {
    const sv = EXTENSION_FTS_TABLES.find((e) => e.typeKey === 'sv')!
    expect(sv.ftsColumns).toEqual(['event_id', 'mate_id'])

    const str = EXTENSION_FTS_TABLES.find((e) => e.typeKey === 'str')!
    expect(str.ftsColumns).toContain('repeat_unit')
    expect(str.ftsColumns).toContain('disease')
    expect(str.ftsColumns).not.toContain('repeat_length') // numeric
  })

  it('FTS table names follow <source>_fts convention', () => {
    for (const entry of EXTENSION_FTS_TABLES) {
      expect(entry.ftsTable).toBe(`${entry.sourceTable}_fts`)
    }
  })
})

describe('isExtensionColumnKey / resolveExtensionColumnKey', () => {
  it('recognizes dotted extension keys', () => {
    expect(isExtensionColumnKey('cnv.copy_number')).toBe(true)
    expect(isExtensionColumnKey('sv.support')).toBe(true)
    expect(isExtensionColumnKey('str.repeat_unit')).toBe(true)
  })

  it('rejects bare keys and unknown keys', () => {
    expect(isExtensionColumnKey('gnomad_af')).toBe(false)
    expect(isExtensionColumnKey('cnv.does_not_exist')).toBe(false)
    expect(isExtensionColumnKey('unknown.col')).toBe(false)
  })

  it('resolves a dotted key to its definition', () => {
    const resolved = resolveExtensionColumnKey('cnv.copy_number')
    expect(resolved).not.toBeNull()
    expect(resolved!.typeKey).toBe('cnv')
    expect(resolved!.column).toBe('copy_number')
    expect(resolved!.columnDef.kind).toBe('number')
  })

  it('returns null for unknown keys', () => {
    expect(resolveExtensionColumnKey('cnv.nope')).toBeNull()
    expect(resolveExtensionColumnKey('notatype.foo')).toBeNull()
    expect(resolveExtensionColumnKey('no_dot')).toBeNull()
  })
})

describe('EXTENSION_SORTABLE_DOTTED_KEYS', () => {
  it('excludes columns with sortable=false', () => {
    expect(EXTENSION_SORTABLE_DOTTED_KEYS.has('sv.support')).toBe(true)
    expect(EXTENSION_SORTABLE_DOTTED_KEYS.has('sv.coverage')).toBe(false)
    expect(EXTENSION_SORTABLE_DOTTED_KEYS.has('str.rank_score')).toBe(false)
    expect(EXTENSION_SORTABLE_DOTTED_KEYS.has('str.alt_copies')).toBe(false)
  })
})

describe('EXTENSION_FILTERABLE_DOTTED_KEYS', () => {
  it('includes every registered column (all are filterable)', () => {
    expect(EXTENSION_FILTERABLE_DOTTED_KEYS.has('cnv.copy_number')).toBe(true)
    expect(EXTENSION_FILTERABLE_DOTTED_KEYS.has('sv.support')).toBe(true)
    expect(EXTENSION_FILTERABLE_DOTTED_KEYS.has('str.repeat_unit')).toBe(true)
    expect(EXTENSION_FILTERABLE_DOTTED_KEYS.has('str.alt_copies')).toBe(true)
  })
})
