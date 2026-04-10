/**
 * Single source of truth for variant extension tables.
 * Verified against v25 schema in migrations.ts:1431-1473.
 */
import type { ColumnFilter, ColumnFiltersParam } from '../../shared/types/column-filters'

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
    if (def.variantTypeValue === 'cnv') continue // defensive: should already be filtered by hasFts
    const ftsColumns = Object.entries(def.columns)
      .filter(([, col]) => col.fts)
      .map(([name]) => name)
    if (ftsColumns.length === 0) continue
    result.push({
      typeKey,
      ftsTable: `${def.table}_fts`,
      sourceTable: def.table,
      variantTypeValue: def.variantTypeValue, // TS narrows to 'sv' | 'str' via the guard above
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

// ── Extension filter → JOIN + WHERE clause builder ────────────

/**
 * Result of translating column_filters into extension JOIN + WHERE clauses.
 *
 * Used by Path 1 (VariantFilterBuilder) to wire extension-table filters into
 * the case-scoped variant query. Path 2 (CohortSearch EXISTS) uses a separate
 * `buildExtensionExistsClauses` helper that wraps the same primitives.
 */
export interface BuildExtensionJoinResult {
  /**
   * Raw SQL fragment containing `LEFT JOIN` clauses for every distinct
   * extension table referenced by the filters. One line per table. Empty
   * string when no extension filters were present. Intended to be included
   * verbatim in the FROM clause of a compiled query.
   */
  joins: string
  /**
   * Raw SQL fragment for the WHERE clause, joined by ` AND `. Parameter
   * placeholders use `?`. When a single extension type is referenced, an
   * implicit `<base>.variant_type = 'sv|cnv|str'` narrowing is prepended so
   * the query planner can use `idx_variants_type_case`.
   */
  whereClause: string
  /** Ordered placeholder values matching each `?` in `whereClause`. */
  params: (string | number)[]
  /**
   * When all extension filters target a single type, reports that type so
   * callers can fold it into higher-level narrowing (e.g. skip the LEFT
   * JOIN when the variant_type filter already added an INNER JOIN). `null`
   * when filters span multiple extension types (cross-type), in which case
   * the caller should NOT emit a single-type narrowing elsewhere.
   */
  implicitTypeNarrowing: ExtensionTypeKey | null
  /**
   * Set of extension type keys whose JOIN is required. Callers can use this
   * to skip adding duplicate joins when another code path already added the
   * same alias (e.g. `filter.variant_type === 'sv'` → `sv` join already
   * present).
   */
  requiredJoinAliases: Set<ExtensionTypeKey>
}

/**
 * Translate a `column_filters` map into an extension JOIN + WHERE plan.
 *
 * Scans every key for dotted extension keys (e.g. `cnv.copy_number`) and:
 * 1. Resolves each to its extension registry entry.
 * 2. Collects required LEFT JOINs (one per distinct extension type).
 * 3. Emits per-filter WHERE clauses using the extension join alias.
 * 4. Emits a single-type narrowing clause when only one extension type is
 *    referenced, so the query planner can use `idx_variants_type_case`.
 *
 * Bare keys (base columns like `gnomad_af`) and unknown dotted keys are
 * silently ignored — the base filter builder handles bare keys and unknown
 * keys are dropped defensively.
 *
 * NULL semantics: extension numeric range filters default to **exclude** NULL
 * (no extension row = variant not of that type → should not be returned),
 * unlike base filters which default to include. Callers can override via
 * `ColumnFilter.includeEmpty = true` on individual filters.
 */
export function buildExtensionJoinClauses(
  columnFilters: ColumnFiltersParam,
  baseVariantAlias: string
): BuildExtensionJoinResult {
  const params: (string | number)[] = []
  const whereFragments: string[] = []
  const joinSet = new Set<ExtensionTypeKey>()
  const typesSeen = new Set<ExtensionTypeKey>()

  for (const [key, filter] of Object.entries(columnFilters)) {
    const resolved = resolveExtensionColumnKey(key)
    if (resolved === null) continue
    joinSet.add(resolved.typeKey)
    typesSeen.add(resolved.typeKey)
    const col = `${resolved.def.joinAlias}.${resolved.column}`
    const clause = translateExtensionFilter(col, filter, params)
    if (clause !== null) whereFragments.push(clause)
  }

  let implicit: ExtensionTypeKey | null = null
  if (typesSeen.size === 1) {
    const only = [...typesSeen][0]
    implicit = only
    // Prepend the single-type narrowing so query planner uses idx_variants_type_case
    whereFragments.unshift(
      `${baseVariantAlias}.variant_type = '${VARIANT_EXTENSION_REGISTRY[only].variantTypeValue}'`
    )
  }

  const joins = [...joinSet]
    .map((typeKey) => {
      const def = VARIANT_EXTENSION_REGISTRY[typeKey]
      return `LEFT JOIN ${def.table} ${def.joinAlias} ON ${def.joinAlias}.${def.variantIdColumn} = ${baseVariantAlias}.id`
    })
    .join('\n')

  return {
    joins,
    whereClause: whereFragments.join(' AND '),
    params,
    implicitTypeNarrowing: implicit,
    requiredJoinAliases: joinSet
  }
}

/**
 * Translate a single extension ColumnFilter into a parameterized SQL fragment.
 *
 * Pushes parameter values into the shared `params` array. Returns the SQL
 * fragment or `null` when the filter should be dropped (empty IN, whitespace
 * LIKE, unsupported operator).
 *
 * NULL semantics for numeric ranges default to EXCLUDE NULLs (opposite of the
 * base-column path) because an extension row missing implies "variant is not
 * of this type". Callers can override via `includeEmpty: true`.
 */
function translateExtensionFilter(
  col: string,
  filter: ColumnFilter,
  params: (string | number)[]
): string | null {
  const { operator, value, includeEmpty } = filter
  // Extensions default to EXCLUDE NULLs (opposite of base filters).
  const nullBranch = includeEmpty === true

  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return null
    const ph = value.map(() => '?').join(', ')
    params.push(...value)
    return `${col} IN (${ph})`
  }
  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return null
    params.push(`%${value}%`)
    return `${col} LIKE ? COLLATE NOCASE`
  }
  if ((operator === '=' || operator === '!=') && !Array.isArray(value)) {
    params.push(value)
    return `${col} ${operator} ?`
  }
  if (['<', '>', '<=', '>='].includes(operator) && !Array.isArray(value)) {
    params.push(value)
    return nullBranch ? `(${col} IS NULL OR ${col} ${operator} ?)` : `${col} ${operator} ?`
  }
  return null
}
