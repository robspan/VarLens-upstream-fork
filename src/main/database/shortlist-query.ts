/**
 * Stage 1 of the unified shortlist pipeline — the ONLY DB-touching module
 * in the shortlist hot path (spec §3 stage boundary commitment).
 *
 * `queryVariantsByType` runs a per-variant-type SELECT that returns a fully
 * joined row projection (`v.*` plus aliased extension columns plus a
 * `is_starred` boolean derived from `case_variant_annotations`). The returned
 * rows are `ShortlistCandidate[]` — flat shapes the Stage-2 scorer consumes
 * with zero additional DB access, so no N+1 lookups can sneak into production.
 *
 * This helper is intentionally thin: all filter/predicate complexity is
 * delegated to the shared `buildBaseWhere` translator so the shortlist pipeline
 * reuses the exact same filter semantics as the Case and Cohort paths. The
 * caller is responsible for merging `FilterState` base + per-type overrides
 * before invoking this function.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§3, §4)
 */

import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { FilterState } from '../../shared/types/filters'
import type { ShortlistCandidate, VariantTypeKey } from '../../shared/types/shortlist'
import { buildBaseWhere, type BaseFilterInput } from './variant-where-builder'
import { VARIANT_EXTENSION_REGISTRY, type ExtensionTypeKey } from './variant-extension-registry'

/**
 * Base alias used throughout the shortlist query. Matches the alias expected
 * by `buildBaseWhere` when composing column references (`v.<column>`).
 */
const BASE_ALIAS = 'v'

/**
 * Run the Stage-1 candidate-generation query for a single variant type.
 *
 * The returned rows are flat `ShortlistCandidate` values — every base
 * `Variant` column plus the aliased extension columns (`sv_*` / `cnv_*` /
 * `str_*`) plus `is_starred`. The row shape is intentionally complete so
 * Stage 2 (scoring) and Stage 3 (ranking) can run without hitting SQLite
 * again. See spec §4 for the aliasing convention.
 *
 * Rows are ordered by `v.id` ASC before the LIMIT is applied, so the cap
 * is deterministic and reproducible across SQLite invocations — but this
 * does NOT pre-rank by scoring criteria. Stage 2 handles the final
 * rank-score ordering after the cap.
 *
 * @param db SQLite connection (already migrated to v26+).
 * @param caseId Case scope — the query emits an explicit `v.case_id = ?`
 *   predicate instead of relying on `buildBaseWhere` (which is scope-agnostic
 *   for case-scoped callers).
 * @param variantType Exact DB-level `variants.variant_type` value.
 * @param filters Merged `FilterState` snapshot (base + per-type overrides
 *   already applied by the caller). Only the fields that survive the
 *   snake_case projection below are forwarded to `buildBaseWhere`.
 * @param limit Row cap — the caller typically passes `config.topN * 4` as a
 *   safety margin so Stage-3 tie-breaking has headroom.
 */
export function queryVariantsByType(
  db: DatabaseType,
  caseId: number,
  variantType: VariantTypeKey,
  filters: Partial<FilterState>,
  limit: number
): ShortlistCandidate[] {
  // 1. Translate the camelCase FilterState snapshot into the snake_case
  //    BaseFilterInput shape the shared WHERE translator expects. Fields the
  //    shortlist pipeline doesn't surface yet (inheritance modes, FTS search,
  //    panel intervals, starred-only, …) are omitted — Stage 2/3 reuse the
  //    candidate set as-is, and the full Case-path filters still apply when
  //    the user drills into a per-type tab.
  //
  //    KNOWN GAP: `inheritanceModes` is intentionally NOT forwarded. The
  //    inheritance-mode SQL currently lives in the Kysely-based
  //    `VariantFilterBuilder` and the compound-het / trio branches also
  //    depend on an `analysis_group_id` that the shortlist service has no
  //    context for. A follow-up wave either ports the solo modes
  //    (homozygous / heterozygous / x_hemizygous / candidate_compound_het)
  //    into `buildBaseWhere` or plumbs the analysis-group context through
  //    the shortlist pipeline. Until then, built-in presets MUST NOT set
  //    `inheritanceModes` — doing so would silently be ignored and return
  //    every consequence-matching row. See `built-in-shortlist-presets.ts`
  //    module JSDoc for the full rationale.
  const baseInput: BaseFilterInput = {
    variant_type: variantType,
    gnomad_af_max: filters.maxGnomadAf ?? undefined,
    cadd_min: filters.minCadd ?? undefined,
    consequences: filters.consequences,
    clinvars: filters.clinvars,
    funcs: filters.funcs,
    gene_symbol: filters.geneSymbol,
    column_filters: filters.columnFilters
  }

  const baseWhere = buildBaseWhere(baseInput, {
    baseAlias: BASE_ALIAS,
    scope: 'case'
  })

  // 2. Always scope to the requested case. `buildBaseWhere` does not know
  //    about case_id (it is shared across the cohort paths), so the caller
  //    must add it explicitly here.
  const whereFragments: string[] = [`${BASE_ALIAS}.case_id = ?`]
  const whereParams: Array<string | number> = [caseId]
  if (baseWhere.sql !== '') {
    whereFragments.push(baseWhere.sql)
    whereParams.push(...baseWhere.params)
  }

  // 3. Emit the extension LEFT JOIN for this variant type (if any). Only
  //    `sv` / `cnv` / `str` have extension tables; `snv` / `indel` row shapes
  //    come entirely from `v.*` and need no extra joins.
  const extensionTypeKey = toExtensionTypeKey(variantType)
  const extensionJoin =
    extensionTypeKey === null
      ? ''
      : (() => {
          const def = VARIANT_EXTENSION_REGISTRY[extensionTypeKey]
          return `LEFT JOIN ${def.table} ${def.joinAlias} ON ${def.joinAlias}.${def.variantIdColumn} = ${BASE_ALIAS}.id`
        })()

  // 4. Compose the projection. `v.*` selects every base `variants` column
  //    (including the v25-era `sv_length` / `sv_type` columns that moved onto
  //    the base table), extension columns are aliased with their `<type>_`
  //    prefix, and `is_starred_int` is hydrated into a boolean below.
  // ORDER BY v.id ASC BEFORE the LIMIT so the cap is deterministic across
  // SQLite invocations. SQLite does not guarantee row order without ORDER
  // BY, which would otherwise let the Stage-1 cap silently drop different
  // rows on different runs. This is NOT a pre-rank by scoring criteria —
  // Stage 2 handles the final ordering after the cap.
  const sql = `
    SELECT
      ${BASE_ALIAS}.*,
      ${buildExtensionColumnProjection(variantType)}COALESCE(cva.starred, 0) AS is_starred_int
    FROM variants ${BASE_ALIAS}
    ${extensionJoin}
    LEFT JOIN case_variant_annotations cva
      ON cva.case_id = ${BASE_ALIAS}.case_id AND cva.variant_id = ${BASE_ALIAS}.id
    WHERE ${whereFragments.join(' AND ')}
    ORDER BY ${BASE_ALIAS}.id ASC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...whereParams, limit) as Array<Record<string, unknown>>

  // 5. Hydrate `is_starred_int` → boolean `is_starred` and strip the
  //    intermediate column so consumers see the exact `ShortlistCandidate`
  //    contract.
  return rows.map((row) => {
    const { is_starred_int, ...rest } = row
    return {
      ...rest,
      is_starred: is_starred_int === 1
    } as unknown as ShortlistCandidate
  })
}

/**
 * Narrow a `VariantTypeKey` to an `ExtensionTypeKey` when it has a backing
 * extension table. Returns `null` for `snv` / `indel`, which live entirely on
 * the `variants` table.
 */
function toExtensionTypeKey(variantType: VariantTypeKey): ExtensionTypeKey | null {
  if (variantType === 'sv' || variantType === 'cnv' || variantType === 'str') {
    return variantType
  }
  return null
}

/**
 * Emit the aliased extension column fragment for the SELECT list. The
 * trailing newline + indentation keeps the composed SQL readable in logs; the
 * caller appends the `is_starred_int` projection directly after this string.
 *
 * Extension column names are hard-coded here because the shortlist contract
 * (spec §4) locks in the `sv_is_precise` / `sv_vaf` / `sv_support` /
 * `cnv_copy_number` / `cnv_copy_number_quality` / `str_status` / `str_disease`
 * / `str_alt_copies` aliases. Other columns in the extension registry are
 * intentionally not projected — they don't drive ranking and would just
 * inflate the row payload.
 */
function buildExtensionColumnProjection(variantType: VariantTypeKey): string {
  switch (variantType) {
    case 'sv':
      return `sv.sv_is_precise AS sv_is_precise,
      sv.vaf AS sv_vaf,
      sv.support AS sv_support,
      `
    case 'cnv':
      return `cnv.copy_number AS cnv_copy_number,
      cnv.copy_number_quality AS cnv_copy_number_quality,
      `
    case 'str':
      return `str.str_status AS str_status,
      str.disease AS str_disease,
      str.alt_copies AS str_alt_copies,
      `
    case 'snv':
    case 'indel':
    default:
      return ''
  }
}
