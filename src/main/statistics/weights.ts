import { jStat } from 'jstat'
import type { WeightScheme } from './types'

/**
 * Compute variant weight given MAF and optional CADD score.
 */
export function computeWeight(scheme: WeightScheme, maf: number, cadd: number | null): number {
  if (scheme === 'uniform') return 1.0

  const clippedMaf = Math.max(1e-8, Math.min(maf, 1 - 1e-8))
  const betaWeight = jStat.beta.pdf(clippedMaf, 1, 25)

  if (scheme === 'beta_maf') return betaWeight

  const caddFactor = cadd !== null ? Math.min(cadd / 40, 1.0) : 1.0
  return betaWeight * caddFactor
}

/**
 * Compute burden score for a sample: sum of weighted dosages.
 */
export function computeBurdenScore(
  dosages: number[],
  mafs: number[],
  cadds: (number | null)[],
  scheme: WeightScheme
): number {
  let burden = 0
  for (let i = 0; i < dosages.length; i++) {
    const w = computeWeight(scheme, mafs[i], cadds[i])
    burden += w * dosages[i]
  }
  return burden
}
