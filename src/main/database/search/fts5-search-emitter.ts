import type { AstNode } from '../../../shared/utils/boolean-search'

/**
 * Emit FTS5-compatible SQL from a boolean search AST.
 * Used by variant search which uses FTS5 full-text index.
 *
 * Each term becomes an FTS5 MATCH subquery wrapped as
 * `id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)`.
 */
export function emitFts5Search(ast: AstNode): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function emit(node: AstNode): string {
    switch (node.type) {
      case 'term':
        return emitTerm(node.value, params)
      case 'and':
        return `(${emit(node.left)} AND ${emit(node.right)})`
      case 'or':
        return `(${emit(node.left)} OR ${emit(node.right)})`
      case 'not':
        return `(NOT (${emit(node.operand)}))`
    }
  }

  return { sql: emit(ast), params }
}

function emitTerm(term: string, params: (string | number)[]): string {
  // HGVS pattern: fall back to LIKE (FTS5 doesn't index c./p. notation well)
  if (/^[cp]\./.test(term)) {
    params.push(`%${term}%`, `%${term}%`)
    return '(cdna LIKE ? OR aa_change LIKE ?)'
  }

  // FTS5 MATCH with proper quoting
  const escaped = term.replace(/"/g, '""')
  const ftsQuery = `"${escaped}"*`
  params.push(ftsQuery)
  return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
}
