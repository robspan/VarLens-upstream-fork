import type { Pool } from 'pg'

import { BASE_SORTABLE_COLUMNS } from '../../database/VariantFilterBuilder'
import type {
  PaginatedResult,
  SortItem,
  Variant,
  VariantFilter
} from '../../../shared/types/database'
import type { FilterOptions } from '../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import { quoteIdentifier } from './identifiers'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'
import type { PostgresVariantColumnDefinition } from './postgres-variant-columns'
import { addPostgresClinicalVariantFilters } from './postgres-variant-clinical-filter-sql'

const POSTGRES_BASE_SORT_COLUMNS = Object.fromEntries(
  Object.entries(BASE_SORTABLE_COLUMNS).map(([key, column]) => [key, `v.${column}`])
)
POSTGRES_BASE_SORT_COLUMNS.id = 'v.id'

const NUMERIC_VARIANT_FIELDS = new Set([
  'id',
  'case_id',
  'pos',
  'end_pos',
  'sv_length',
  'dp',
  'ad_ref',
  'ad_alt',
  'internal_af',
  '_sv_support',
  '_sv_dr',
  '_sv_dv',
  '_sv_vaf',
  '_sv_is_precise',
  '_sv_stdev_len',
  '_sv_stdev_pos',
  '_cnv_copy_number',
  '_cnv_gq',
  '_cnv_ho_ref',
  '_cnv_ho_alt',
  '_str_ref_copies',
  '_str_normal_max',
  '_str_pathologic_min'
])

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function toPrefixTsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9_]/g, ''))
    .filter((token) => token.length > 0)
    .map((token) => `${token}:*`)
    .join(' & ')
}

export const toPrefixTsQueryForTest = toPrefixTsQuery

function normalizeVariantRow(row: Record<string, unknown>): Variant {
  const normalized: Record<string, unknown> = { ...row }
  for (const field of NUMERIC_VARIANT_FIELDS) {
    const value = normalized[field]
    if (typeof value === 'string') normalized[field] = Number(value)
  }
  return normalized as unknown as Variant
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

export interface PostgresVariantQueryParts {
  fromAndWhereSql: string
  orderBySql: string
  params: unknown[]
  projections: string[]
}

export function buildPostgresVariantQueryParts(
  filter: VariantFilter,
  schemaName: string,
  sortBy?: SortItem[]
): PostgresVariantQueryParts {
  assertSupportedPostgresVariantFilter(filter)

  const whereParts: string[] = []
  const params: unknown[] = []
  const addParam = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }
  const addWhere = (sql: string): void => {
    whereParts.push(sql)
  }

  addWhere(`v.case_id = ${addParam(filter.case_id)}`)

  const exactVariantType =
    (filter as VariantFilter & { exact_variant_type?: boolean }).exact_variant_type === true
  if (filter.variant_type !== undefined && filter.variant_type !== '') {
    if (filter.variant_type === 'snv' && !exactVariantType) {
      addWhere("v.variant_type IN ('snv', 'indel')")
    } else {
      addWhere(`v.variant_type = ${addParam(filter.variant_type)}`)
    }
  }

  if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
    addWhere(`v.gene_symbol ILIKE ${addParam(`%${filter.gene_symbol}%`)}`)
  }

  if (isNonEmptyArray(filter.consequences)) {
    addWhere(`v.consequence IN (${filter.consequences.map((value) => addParam(value)).join(', ')})`)
  } else if (filter.consequence !== undefined && filter.consequence !== '') {
    addWhere(`v.consequence = ${addParam(filter.consequence)}`)
  }

  if (isNonEmptyArray(filter.funcs)) {
    addWhere(`v.func IN (${filter.funcs.map((value) => addParam(value)).join(', ')})`)
  }

  if (isNonEmptyArray(filter.clinvars)) {
    addWhere(`v.clinvar IN (${filter.clinvars.map((value) => addParam(value)).join(', ')})`)
  }

  if (filter.gnomad_af_max !== undefined) {
    addWhere(`(v.gnomad_af IS NULL OR v.gnomad_af <= ${addParam(filter.gnomad_af_max)})`)
  }

  if (filter.cadd_min !== undefined) {
    addWhere(`(v.cadd IS NULL OR v.cadd >= ${addParam(filter.cadd_min)})`)
  }

  const internalAfExpression = `vf.case_count::double precision / NULLIF((SELECT COUNT(*) FROM ${schemaName}."cases"), 0)`

  if (filter.max_internal_af !== undefined && filter.max_internal_af > 0) {
    addWhere(
      `(vf.case_count IS NULL OR ${internalAfExpression} <= ${addParam(filter.max_internal_af)})`
    )
  }

  const tsQuery = filter.search_query !== undefined ? toPrefixTsQuery(filter.search_query) : ''
  if (tsQuery !== '') {
    const tsParam = addParam(tsQuery)
    addWhere(`(
        v.search_document @@ to_tsquery('simple', ${tsParam})
        OR EXISTS (
          SELECT 1 FROM ${schemaName}."variant_sv" sv_search
          WHERE sv_search.variant_id = v.id
            AND sv_search.search_document @@ to_tsquery('simple', ${tsParam})
        )
        OR EXISTS (
          SELECT 1 FROM ${schemaName}."variant_str" str_search
          WHERE str_search.variant_id = v.id
            AND str_search.search_document @@ to_tsquery('simple', ${tsParam})
        )
      )`)
  }

  if (filter.chr !== undefined && filter.chr !== '') {
    addWhere(`v.chr = ${addParam(filter.chr)}`)
  }
  if (filter.pos !== undefined) {
    addWhere(`v.pos = ${addParam(filter.pos)}`)
  }
  if (filter.ref !== undefined && filter.ref !== '') {
    addWhere(`v.ref = ${addParam(filter.ref)}`)
  }
  if (filter.alt !== undefined && filter.alt !== '') {
    addWhere(`v.alt = ${addParam(filter.alt)}`)
  }

  const joins = [`LEFT JOIN ${schemaName}."variant_frequency" vf ON vf.coord_hash = v.coord_hash`]
  const projections = [`v.*`, `${internalAfExpression} AS internal_af`]

  if (filter.variant_type === 'sv' || hasPostgresColumnFilterPrefix(filter, 'sv.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_sv" sv ON sv.variant_id = v.id`)
  }
  if (filter.variant_type === 'sv') {
    projections.push(
      'sv.support AS _sv_support',
      'sv.dr AS _sv_dr',
      'sv.dv AS _sv_dv',
      'sv.vaf AS _sv_vaf',
      'sv.sv_is_precise AS _sv_is_precise',
      'sv.strand AS _sv_strand',
      'sv.coverage AS _sv_coverage',
      'sv.stdev_len AS _sv_stdev_len',
      'sv.stdev_pos AS _sv_stdev_pos'
    )
  }
  if (filter.variant_type === 'cnv' || hasPostgresColumnFilterPrefix(filter, 'cnv.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_cnv" cnv ON cnv.variant_id = v.id`)
  }
  if (filter.variant_type === 'cnv') {
    projections.push(
      'cnv.copy_number AS _cnv_copy_number',
      'cnv.copy_number_quality AS _cnv_gq',
      'cnv.homozygosity_ref AS _cnv_ho_ref',
      'cnv.homozygosity_alt AS _cnv_ho_alt'
    )
  }
  if (filter.variant_type === 'str' || hasPostgresColumnFilterPrefix(filter, 'str.')) {
    joins.push(`LEFT JOIN ${schemaName}."variant_str" str_ext ON str_ext.variant_id = v.id`)
  }
  if (filter.variant_type === 'str') {
    projections.push(
      'str_ext.repeat_id AS _str_repeat_id',
      'str_ext.repeat_unit AS _str_repeat_unit',
      'str_ext.display_repeat_unit AS _str_display_ru',
      'str_ext.ref_copies AS _str_ref_copies',
      'str_ext.alt_copies AS _str_alt_copies',
      'str_ext.str_status AS _str_status',
      'str_ext.normal_max AS _str_normal_max',
      'str_ext.pathologic_min AS _str_pathologic_min',
      'str_ext.disease AS _str_disease',
      'str_ext.inheritance_mode AS _str_inheritance_mode',
      'str_ext.rank_score AS _str_rank_score'
    )
  }

  addPostgresClinicalVariantFilters(filter, { schemaName, addParam, addWhere })
  addPostgresColumnFilters(filter, addParam, addWhere)

  return {
    fromAndWhereSql: `FROM ${schemaName}."variants" v
      ${joins.join('\n')}
      WHERE ${whereParts.join('\n        AND ')}`,
    orderBySql: buildPostgresVariantOrderBy(sortBy),
    params,
    projections
  }
}

function assertSupportedPostgresVariantFilter(_filter: VariantFilter): void {
  // Dynamic column filter support is validated in addPostgresColumnFilters.
}

function addPostgresColumnFilters(
  filter: VariantFilter,
  addParam: (value: unknown) => string,
  addWhere: (sql: string) => void
): void {
  if (filter.column_filters === undefined) return

  const unsupportedColumns = Object.keys(filter.column_filters).filter(
    (column) => POSTGRES_VARIANT_COLUMN_DEFINITIONS[column] === undefined
  )
  if (unsupportedColumns.length > 0) {
    throw new Error(`Unsupported PostgreSQL column filter(s): ${unsupportedColumns.join(', ')}`)
  }

  for (const [column, filterDef] of Object.entries(filter.column_filters)) {
    const definition = POSTGRES_VARIANT_COLUMN_DEFINITIONS[column]
    const sqlColumn = definition.sql
    const { operator, value } = filterDef

    if (operator === 'in' && Array.isArray(value)) {
      if (value.length === 0) continue
      addWhere(`${sqlColumn} IN (${value.map((item) => addParam(String(item))).join(', ')})`)
    } else if (operator === 'like' && typeof value === 'string') {
      if (value.trim() === '') continue
      addWhere(`${sqlColumn} ILIKE ${addParam(`%${value}%`)}`)
    } else if (
      (operator === '=' || operator === '!=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      addWhere(`${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value))}`)
    } else if (
      (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      const comparison = `${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value))}`
      const includeEmpty = filterDef.includeEmpty ?? !column.includes('.')
      addWhere(includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison)
    }
  }
}

function hasPostgresColumnFilterPrefix(filter: VariantFilter, prefix: string): boolean {
  return Object.keys(filter.column_filters ?? {}).some((column) => column.startsWith(prefix))
}

function normalizePostgresColumnFilterValue(value: string | number): string | number {
  if (typeof value === 'number') return value
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : value
}

function buildPostgresVariantOrderBy(sortBy?: SortItem[]): string {
  const orderParts: string[] = []
  for (const sort of sortBy ?? []) {
    const sqlColumn = POSTGRES_BASE_SORT_COLUMNS[sort.key]
    if (sqlColumn !== undefined) {
      orderParts.push(`${sqlColumn} ${sort.order.toUpperCase()} NULLS LAST`)
    }
  }

  if (orderParts.length === 0) {
    orderParts.push('v.pos ASC NULLS LAST')
  }
  orderParts.push('v.id ASC')
  return `ORDER BY ${orderParts.join(', ')}`
}

export class PostgresVariantReadRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getVariantTypeCounts(caseId: number): Promise<Record<string, number>> {
    const result = await this.pool.query(
      `SELECT variant_type, COUNT(*)::int AS count
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
       GROUP BY variant_type
       ORDER BY variant_type`,
      [caseId]
    )
    const counts: Record<string, number> = {}
    for (const row of result.rows as Array<{ variant_type: string; count: unknown }>) {
      counts[row.variant_type] = toNumber(row.count)
    }
    return counts
  }

  async getVariantTypesPresent(
    scope: { caseId: number } | { caseIds: number[] }
  ): Promise<string[]> {
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) return []
    const result =
      caseIds.length === 1
        ? await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = $1 AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds[0]]
          )
        : await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = ANY($1::bigint[]) AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds]
          )
    return (result.rows as Array<{ variant_type: string }>).map((row) => row.variant_type)
  }

  async getGeneSymbols(caseId: number, query: string, limit: number): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT gene_symbol
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
         AND gene_symbol IS NOT NULL
         AND gene_symbol ILIKE $2
       ORDER BY gene_symbol
       LIMIT $3`,
      [caseId, `${query}%`, limit]
    )
    return (result.rows as Array<{ gene_symbol: string }>).map((row) => row.gene_symbol)
  }

  async searchVariants(caseId: number, query: string, limit: number): Promise<Variant[]> {
    if (toPrefixTsQuery(query) === '') return []
    const result = await this.queryVariants(
      { case_id: caseId, search_query: query },
      limit,
      0,
      undefined,
      true,
      false
    )
    return result.data
  }

  async queryVariants(
    filter: VariantFilter,
    limit: number,
    offset: number = 0,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean
  ): Promise<PaginatedResult<Variant> & { unfiltered_count?: number }> {
    const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
      filter,
      this.schemaName,
      sortBy
    )

    let totalCount = 0
    if (skipCount !== true) {
      const countResult = await this.pool.query(
        `SELECT COUNT(*)::int AS count
         ${fromAndWhereSql}`,
        params
      )
      totalCount = toNumber((countResult.rows[0] as { count?: unknown } | undefined)?.count)
    }

    const dataParams = [...params, limit, offset]
    const dataResult = await this.pool.query(
      `SELECT ${projections.join(', ')}
       ${fromAndWhereSql}
       ${orderBySql}
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    )

    let unfilteredCount: number | undefined
    if (includeUnfilteredCount === true) {
      const result = await this.pool.query(
        `SELECT COUNT(*)::int AS count FROM ${this.schemaName}."variants" WHERE case_id = $1`,
        [filter.case_id]
      )
      unfilteredCount = toNumber((result.rows[0] as { count?: unknown } | undefined)?.count)
    }

    return {
      data: (dataResult.rows as Array<Record<string, unknown>>).map((row) =>
        normalizeVariantRow(row)
      ),
      total_count: totalCount,
      ...(unfilteredCount !== undefined ? { unfiltered_count: unfilteredCount } : {})
    }
  }

  async getFilterOptions(caseId: number): Promise<FilterOptions> {
    const columnMeta = await Promise.all(
      Object.keys(POSTGRES_VARIANT_COLUMN_DEFINITIONS).map((columnKey) =>
        this.getColumnMeta({ caseId }, columnKey)
      )
    )
    const metaByKey = new Map(columnMeta.map((meta) => [meta.key, meta]))
    const caddMeta = metaByKey.get('cadd')
    const gnomadAfMeta = metaByKey.get('gnomad_af')

    return {
      consequences: metaByKey.get('consequence')?.distinctValues ?? [],
      funcs: metaByKey.get('func')?.distinctValues ?? [],
      clinvars: metaByKey.get('clinvar')?.distinctValues ?? [],
      minCadd: caddMeta?.min ?? null,
      maxCadd: caddMeta?.max ?? null,
      minGnomadAf: gnomadAfMeta?.min ?? null,
      maxGnomadAf: gnomadAfMeta?.max ?? null,
      columnMeta
    }
  }

  async getColumnMeta(
    scope: { caseId: number } | { caseIds: number[] },
    columnKey: string
  ): Promise<ColumnFilterMeta> {
    const definition = POSTGRES_VARIANT_COLUMN_DEFINITIONS[columnKey]
    if (definition === undefined) {
      return { key: columnKey, dataType: 'text', distinctCount: 0 }
    }

    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) {
      return {
        key: columnKey,
        dataType: definition.kind === 'numeric' ? 'numeric' : 'text',
        distinctCount: 0
      }
    }

    return definition.kind === 'numeric'
      ? this.getNumericColumnMeta(caseIds, definition)
      : this.getCategoricalColumnMeta(caseIds, definition)
  }

  private async getNumericColumnMeta(
    caseIds: number[],
    definition: PostgresVariantColumnDefinition
  ): Promise<ColumnFilterMeta> {
    const result = await this.pool.query(
      `SELECT COUNT(DISTINCT ${definition.sql})::int AS distinct_count,
              MIN(${definition.sql}) AS min,
              MAX(${definition.sql}) AS max
       FROM ${this.schemaName}."variants" v
       ${this.buildColumnMetaJoins(definition.key)}
       WHERE v.case_id = ANY($1::bigint[])`,
      [caseIds]
    )
    const row = result.rows[0] as
      | { distinct_count?: unknown; min?: unknown; max?: unknown }
      | undefined
    const meta: ColumnFilterMeta = {
      key: definition.key,
      dataType: 'numeric',
      distinctCount: toNumber(row?.distinct_count)
    }
    const min = toOptionalNumber(row?.min)
    const max = toOptionalNumber(row?.max)
    if (min !== undefined) meta.min = min
    if (max !== undefined) meta.max = max
    return meta
  }

  private async getCategoricalColumnMeta(
    caseIds: number[],
    definition: PostgresVariantColumnDefinition
  ): Promise<ColumnFilterMeta> {
    const joins = this.buildColumnMetaJoins(definition.key)
    const countResult = await this.pool.query(
      `SELECT COUNT(DISTINCT ${definition.sql})::int AS distinct_count
       FROM ${this.schemaName}."variants" v
       ${joins}
       WHERE v.case_id = ANY($1::bigint[])`,
      [caseIds]
    )
    const distinctCount = toNumber(
      (countResult.rows[0] as { distinct_count?: unknown } | undefined)?.distinct_count
    )
    const meta: ColumnFilterMeta = {
      key: definition.key,
      dataType: 'text',
      distinctCount
    }

    if (distinctCount > 0 && distinctCount <= 50) {
      const valuesResult = await this.pool.query(
        `SELECT DISTINCT ${definition.sql} AS value
         FROM ${this.schemaName}."variants" v
         ${joins}
         WHERE v.case_id = ANY($1::bigint[])
           AND ${definition.sql} IS NOT NULL
         ORDER BY ${definition.sql}`,
        [caseIds]
      )
      meta.distinctValues = (valuesResult.rows as Array<{ value: unknown }>).map((row) =>
        String(row.value)
      )
    }

    return meta
  }

  private buildColumnMetaJoins(columnKey: string): string {
    if (columnKey.startsWith('sv.')) {
      return `LEFT JOIN ${this.schemaName}."variant_sv" sv ON sv.variant_id = v.id`
    }
    if (columnKey.startsWith('cnv.')) {
      return `LEFT JOIN ${this.schemaName}."variant_cnv" cnv ON cnv.variant_id = v.id`
    }
    if (columnKey.startsWith('str.')) {
      return `LEFT JOIN ${this.schemaName}."variant_str" str_ext ON str_ext.variant_id = v.id`
    }
    return ''
  }
}
