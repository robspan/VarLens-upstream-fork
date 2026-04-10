/**
 * Single source of truth for variant extension tables.
 * Verified against v25 schema in migrations.ts:1431-1473.
 */
export type FilterKind = 'number' | 'text' | 'enum'

export interface ExtensionColumnDef {
  kind: FilterKind
  label?: string
  fts: boolean
  sortable: boolean
}

export interface VariantExtensionDef {
  table: string
  variantTypeValue: 'sv' | 'cnv' | 'str'
  joinAlias: string
  variantIdColumn: 'variant_id'
  hasFts: boolean
  columns: Record<string, ExtensionColumnDef>
}

export const VARIANT_EXTENSION_REGISTRY = {
  sv: {
    table: 'variant_sv',
    variantTypeValue: 'sv',
    joinAlias: 'sv',
    variantIdColumn: 'variant_id',
    hasFts: true,
    columns: {
      sv_is_precise: { kind: 'enum',   fts: false, sortable: true,  label: 'Precise SV' },
      support:       { kind: 'number', fts: false, sortable: true,  label: 'Total support' },
      pe_support:    { kind: 'number', fts: false, sortable: true,  label: 'Paired-end support' },
      sr_support:    { kind: 'number', fts: false, sortable: true,  label: 'Split-read support' },
      dr:            { kind: 'number', fts: false, sortable: true,  label: 'Ref depth' },
      dv:            { kind: 'number', fts: false, sortable: true,  label: 'Alt depth' },
      vaf:           { kind: 'number', fts: false, sortable: true,  label: 'VAF' },
      strand:        { kind: 'enum',   fts: false, sortable: true,  label: 'Strand' },
      coverage:      { kind: 'text',   fts: false, sortable: false, label: 'Coverage' },
      cipos_left:    { kind: 'number', fts: false, sortable: false, label: 'CIPOS left' },
      cipos_right:   { kind: 'number', fts: false, sortable: false, label: 'CIPOS right' },
      ciend_left:    { kind: 'number', fts: false, sortable: false, label: 'CIEND left' },
      ciend_right:   { kind: 'number', fts: false, sortable: false, label: 'CIEND right' },
      stdev_len:     { kind: 'number', fts: false, sortable: false, label: 'Stdev length' },
      stdev_pos:     { kind: 'number', fts: false, sortable: false, label: 'Stdev pos' },
      event_id:      { kind: 'text',   fts: true,  sortable: false, label: 'Event ID' },
      mate_id:       { kind: 'text',   fts: true,  sortable: false, label: 'Mate ID' }
    }
  },
  cnv: {
    table: 'variant_cnv',
    variantTypeValue: 'cnv',
    joinAlias: 'cnv',
    variantIdColumn: 'variant_id',
    hasFts: false,
    columns: {
      copy_number:         { kind: 'number', fts: false, sortable: true, label: 'Copy number' },
      copy_number_quality: { kind: 'number', fts: false, sortable: true, label: 'CN quality' },
      homozygosity_ref:    { kind: 'number', fts: false, sortable: true, label: 'Homozygosity ref' },
      homozygosity_alt:    { kind: 'number', fts: false, sortable: true, label: 'Homozygosity alt' },
      sm:                  { kind: 'number', fts: false, sortable: true, label: 'Segment mean' },
      bin_count:           { kind: 'number', fts: false, sortable: true, label: 'Bin count' }
    }
  },
  str: {
    table: 'variant_str',
    variantTypeValue: 'str',
    joinAlias: 'str',
    variantIdColumn: 'variant_id',
    hasFts: true,
    columns: {
      repeat_id:           { kind: 'text',   fts: true,  sortable: true,  label: 'Repeat ID' },
      variant_catalog_id:  { kind: 'text',   fts: true,  sortable: true,  label: 'Catalog ID' },
      repeat_unit:         { kind: 'text',   fts: true,  sortable: true,  label: 'Repeat unit' },
      display_repeat_unit: { kind: 'text',   fts: true,  sortable: true,  label: 'Display repeat unit' },
      repeat_length:       { kind: 'number', fts: false, sortable: true,  label: 'Repeat length' },
      ref_copies:          { kind: 'number', fts: false, sortable: true,  label: 'Reference copies' },
      alt_copies:          { kind: 'text',   fts: false, sortable: false, label: 'Alt copies' },
      str_status:          { kind: 'enum',   fts: true,  sortable: true,  label: 'STR status' },
      disease:             { kind: 'text',   fts: true,  sortable: true,  label: 'Disease' },
      inheritance_mode:    { kind: 'enum',   fts: false, sortable: true,  label: 'Inheritance mode' },
      source_display:      { kind: 'text',   fts: false, sortable: true,  label: 'Source' },
      support_type:        { kind: 'text',   fts: false, sortable: true,  label: 'Support type' },
      normal_max:          { kind: 'number', fts: false, sortable: true,  label: 'Normal max' },
      pathologic_min:      { kind: 'number', fts: false, sortable: true,  label: 'Pathologic min' },
      locus_coverage:      { kind: 'number', fts: false, sortable: true,  label: 'Locus coverage' },
      rank_score:          { kind: 'text',   fts: false, sortable: false, label: 'Rank score' },
      confidence_interval: { kind: 'text',   fts: false, sortable: false, label: 'Confidence interval' }
    }
  }
} as const satisfies Record<string, VariantExtensionDef>

export type ExtensionTypeKey = keyof typeof VARIANT_EXTENSION_REGISTRY

export interface ExtensionFtsTableEntry {
  typeKey: ExtensionTypeKey
  ftsTable: string
  sourceTable: string
  variantTypeValue: 'sv' | 'str'
  ftsColumns: string[]
}

export interface ExtensionColumnResolution {
  typeKey: ExtensionTypeKey
  def: VariantExtensionDef
  column: string
  columnDef: ExtensionColumnDef
}

function deriveFtsTables(): ExtensionFtsTableEntry[] {
  const result: ExtensionFtsTableEntry[] = []
  for (const [typeKey, def] of Object.entries(VARIANT_EXTENSION_REGISTRY) as Array<
    [ExtensionTypeKey, VariantExtensionDef]
  >) {
    if (!def.hasFts) continue
    const ftsColumns = Object.entries(def.columns)
      .filter(([, col]) => col.fts)
      .map(([name]) => name)
    if (ftsColumns.length === 0) continue
    result.push({
      typeKey,
      ftsTable: `${def.table}_fts`,
      sourceTable: def.table,
      variantTypeValue: def.variantTypeValue as 'sv' | 'str',
      ftsColumns
    })
  }
  return result
}

function deriveSortableDottedKeys(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const [typeKey, def] of Object.entries(VARIANT_EXTENSION_REGISTRY) as Array<
    [ExtensionTypeKey, VariantExtensionDef]
  >) {
    for (const [col, meta] of Object.entries(def.columns)) {
      if (meta.sortable) set.add(`${typeKey}.${col}`)
    }
  }
  return set
}

function deriveFilterableDottedKeys(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const [typeKey, def] of Object.entries(VARIANT_EXTENSION_REGISTRY)) {
    for (const col of Object.keys(def.columns)) {
      set.add(`${typeKey}.${col}`)
    }
  }
  return set
}

export const EXTENSION_FTS_TABLES: ExtensionFtsTableEntry[] = deriveFtsTables()
export const EXTENSION_SORTABLE_DOTTED_KEYS: ReadonlySet<string> = deriveSortableDottedKeys()
export const EXTENSION_FILTERABLE_DOTTED_KEYS: ReadonlySet<string> = deriveFilterableDottedKeys()

export function isExtensionColumnKey(key: string): boolean {
  return EXTENSION_FILTERABLE_DOTTED_KEYS.has(key)
}

export function resolveExtensionColumnKey(key: string): ExtensionColumnResolution | null {
  const dotIdx = key.indexOf('.')
  if (dotIdx === -1) return null
  const typeKey = key.slice(0, dotIdx) as ExtensionTypeKey
  const column = key.slice(dotIdx + 1)
  const def: VariantExtensionDef | undefined = VARIANT_EXTENSION_REGISTRY[typeKey]
  if (def === undefined) return null
  const columnDef = def.columns[column]
  if (columnDef === undefined) return null
  return { typeKey, def, column, columnDef }
}
