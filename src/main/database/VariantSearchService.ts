import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant } from './types'
import type { VariantQueryBuilder } from './VariantFilterBuilder'
import { tokenize, parse } from '../../shared/utils/boolean-search'
import {
  classifySearchAst,
  composeSearchClauses,
  type SearchClause
} from './search/search-clause-emitter'
import { EXTENSION_FTS_TABLES } from './variant-extension-registry'
import { mainLogger } from '../services/MainLogger'

/**
 * FTS5 search and gene symbol lookup for variants.
 *
 * Extracted from VariantRepository to isolate search logic
 * (boolean parsing, HGVS fallback, FTS5 MATCH) into a focused module.
 */
export class VariantSearchService {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>
  ) {}

  /**
   * Apply FTS5 search filter to a Kysely query.
   * Handles boolean operators (AND/OR/NOT) and HGVS pattern matching.
   *
   * Routes through the classify-then-compose path so FTS term leaves
   * expand into a UNION subquery across `variants_fts` plus every
   * extension FTS table (`variant_sv_fts`, `variant_str_fts`, ...).
   */
  applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
    const term = searchQuery.trim()
    if (term === '') return query

    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.applySingleSearchToken(query, term)
    }

    // Parse boolean expression into AST, classify, and compose SQL
    const tokens = tokenize(term)
    if (tokens.length === 0) return query
    let ast
    try {
      ast = parse(tokens)
    } catch (e) {
      // Malformed boolean expression — fall back to single-term search
      mainLogger.warn(
        'Malformed boolean search expression, falling back to single-term: ' +
          (e instanceof Error ? e.message : String(e)),
        'VariantSearchService'
      )
      return this.applySingleSearchToken(query, term)
    }
    const clause = classifySearchAst(ast)
    return this.applyComposedSearchClause(query, clause)
  }

  /**
   * Apply a single search token (FTS5 UNION or HGVS pattern).
   *
   * Routes through the same composer as the boolean AST path so HGVS
   * tokens become base-table LIKE and FTS tokens become the UNION of
   * `variants_fts` plus every extension FTS table.
   */
  applySingleSearchToken(query: VariantQueryBuilder, token: string): VariantQueryBuilder {
    const clause: SearchClause = /^[cp]\./.test(token)
      ? { type: 'hgvs', term: token }
      : { type: 'fts', term: token }
    return this.applyComposedSearchClause(query, clause)
  }

  /**
   * Compose a SearchClause into SQL + params and interpolate into a Kysely
   * query via the same sql template pattern used by extension filters.
   * Shared by applySearchFilter (boolean AST path) and applySingleSearchToken
   * (single-term shortcut).
   */
  private applyComposedSearchClause(
    query: VariantQueryBuilder,
    clause: SearchClause
  ): VariantQueryBuilder {
    const { sql: composedSql, params } = composeSearchClauses(clause, {
      baseFts: 'variants_fts',
      extensionFts: EXTENSION_FTS_TABLES
    })
    const segments = composedSql.split('?')
    let rawExpr = sql<boolean>`${sql.raw(segments[0])}`
    for (let i = 0; i < params.length; i++) {
      rawExpr = sql<boolean>`${rawExpr}${params[i]}${sql.raw(segments[i + 1])}`
    }
    return query.where(rawExpr)
  }

  /**
   * Search variants using FTS5 full-text index, ranked by BM25.
   */
  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    const ftsQuery = `"${query.replace(/"/g, '""')}"*`
    const results = this.db
      .prepare(
        `
      SELECT v.* FROM variants v
      JOIN variants_fts fts ON v.id = fts.rowid
      WHERE v.case_id = ? AND variants_fts MATCH ?
      ORDER BY bm25(variants_fts)
      LIMIT ?
    `
      )
      .all(caseId, ftsQuery, limit) as Variant[]
    return results
  }

  /**
   * Get distinct gene symbols matching a query prefix.
   */
  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    const compiled = this.kysely
      .selectFrom('variants')
      .select('gene_symbol')
      .distinct()
      .where('case_id', '=', caseId)
      .where('gene_symbol', 'like', `${query}%`)
      .where('gene_symbol', 'is not', null)
      .orderBy('gene_symbol')
      .limit(limit)
      .compile()
    const results = this.db.prepare(compiled.sql).all(...compiled.parameters) as {
      gene_symbol: string
    }[]
    return results.map((r) => r.gene_symbol)
  }
}
