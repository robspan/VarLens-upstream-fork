import type { FisherResult } from './types'

/**
 * Fisher's exact test for a 2x2 contingency table.
 *
 * Table layout:
 *   [[a, b],    a = groupA carriers, b = groupB carriers
 *    [c, d]]    c = groupA non-carriers, d = groupB non-carriers
 */
export function fisherExactTest(a: number, b: number, c: number, d: number): FisherResult {
  const n = a + b + c + d
  if (n === 0) {
    return { p_value: null, odds_ratio: null, ci_lower: null, ci_upper: null }
  }

  const r1 = a + b
  const c1 = a + c

  // Two-sided p-value via hypergeometric enumeration
  const pObserved = hypergeometricPmf(a, n, c1, r1)
  let pValue = 0
  const minA = Math.max(0, r1 - (b + d))
  const maxA = Math.min(r1, c1)

  for (let x = minA; x <= maxA; x++) {
    const px = hypergeometricPmf(x, n, c1, r1)
    if (px <= pObserved + 1e-14) {
      pValue += px
    }
  }
  pValue = Math.min(pValue, 1.0)

  // Odds ratio
  let oddsRatio: number | null = null
  if (b * c === 0 && a * d === 0) {
    oddsRatio = null
  } else if (b * c === 0) {
    oddsRatio = Infinity
  } else {
    oddsRatio = (a * d) / (b * c)
  }

  // CI with Haldane-Anscombe correction
  const { ci_lower, ci_upper } = computeOddsRatioCI(a, b, c, d)

  return { p_value: pValue, odds_ratio: oddsRatio, ci_lower, ci_upper }
}

function hypergeometricPmf(k: number, N: number, K: number, n: number): number {
  return Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n))
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  if (k === 0 || k === n) return 0
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

const logFactorialCache: number[] = [0, 0]

function logFactorial(n: number): number {
  if (n < 0) return -Infinity
  if (n < logFactorialCache.length) return logFactorialCache[n]
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = logFactorialCache[i - 1] + Math.log(i)
  }
  return logFactorialCache[n]
}

function computeOddsRatioCI(
  a: number,
  b: number,
  c: number,
  d: number
): { ci_lower: number | null; ci_upper: number | null } {
  let aa = a,
    bb = b,
    cc = c,
    dd = d
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    aa = a + 0.5
    bb = b + 0.5
    cc = c + 0.5
    dd = d + 0.5
  }

  if (aa + bb === 0 || cc + dd === 0 || aa + cc === 0 || bb + dd === 0) {
    return { ci_lower: null, ci_upper: null }
  }

  const logOr = Math.log((aa * dd) / (bb * cc))
  const se = Math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd)

  return {
    ci_lower: Math.exp(logOr - 1.96 * se),
    ci_upper: Math.exp(logOr + 1.96 * se)
  }
}
