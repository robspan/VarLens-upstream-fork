/** Format a cell value — applies numeric formatting for specific columns. */
export function formatCellValue(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return ''
  if (key === 'gnomad_af' && typeof value === 'number') {
    return value.toExponential(2)
  }
  if (key === 'cadd' && typeof value === 'number') {
    return value.toFixed(2)
  }
  if (key === 'hpo_sim_score' && typeof value === 'number') {
    return value.toFixed(4)
  }
  return value as string | number | null
}

/**
 * Escape a value for RFC 4180 CSV.
 * Wraps in double-quotes if the value contains a comma, double-quote, or newline.
 * Internal double-quotes are escaped by doubling them.
 */
export function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
