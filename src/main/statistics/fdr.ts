/**
 * Benjamini-Hochberg FDR correction.
 */
export function benjaminiHochberg(pValues: (number | null)[]): (number | null)[] {
  if (pValues.length === 0) return []

  const indexed: { index: number; pValue: number }[] = []
  for (let i = 0; i < pValues.length; i++) {
    if (pValues[i] !== null) {
      indexed.push({ index: i, pValue: pValues[i] as number })
    }
  }

  if (indexed.length === 0) return pValues.slice()

  const m = indexed.length

  // Sort by p-value descending
  indexed.sort((a, b) => b.pValue - a.pValue)

  const adjusted = new Array<number>(m)
  adjusted[0] = Math.min(indexed[0].pValue, 1.0)

  for (let i = 1; i < m; i++) {
    const rank = m - i
    const raw = (indexed[i].pValue * m) / rank
    adjusted[i] = Math.min(raw, adjusted[i - 1])
    adjusted[i] = Math.min(adjusted[i], 1.0)
  }

  const result: (number | null)[] = pValues.slice()
  for (let i = 0; i < m; i++) {
    result[indexed[i].index] = adjusted[i]
  }

  return result
}
