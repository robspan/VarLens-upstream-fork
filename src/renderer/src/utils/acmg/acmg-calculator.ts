import type { AcmgEvidenceCode, AcmgClassification } from './types'
import { EVIDENCE_POINTS } from './types'

export interface PointBreakdown {
  pathogenicPoints: number
  benignPoints: number
  netPoints: number
}

export interface ClassificationResult extends PointBreakdown {
  classification: AcmgClassification | null
}

/**
 * Calculate pathogenic and benign point totals from evidence codes.
 * Only counts codes where confirmed === true.
 */
export function calculatePoints(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): PointBreakdown {
  const pathogenicPoints = pathogenic
    .filter((c) => c.confirmed)
    .reduce((sum, c) => sum + EVIDENCE_POINTS[c.strength], 0)

  const benignPoints = benign
    .filter((c) => c.confirmed)
    .reduce((sum, c) => sum + EVIDENCE_POINTS[c.strength], 0)

  return {
    pathogenicPoints,
    benignPoints,
    netPoints: pathogenicPoints - benignPoints
  }
}

/**
 * Count confirmed codes by strength category.
 */
interface StrengthCounts {
  veryStrong: number
  strong: number
  moderate: number
  supporting: number
  standAlone: number
}

function countByStrength(codes: AcmgEvidenceCode[]): StrengthCounts {
  const confirmed = codes.filter((c) => c.confirmed)
  return {
    veryStrong: confirmed.filter((c) => c.strength === 'very_strong').length,
    strong: confirmed.filter((c) => c.strength === 'strong').length,
    moderate: confirmed.filter((c) => c.strength === 'moderate').length,
    supporting: confirmed.filter((c) => c.strength === 'supporting').length,
    standAlone: confirmed.filter((c) => c.strength === 'stand_alone').length
  }
}

/**
 * ACMG/AMP 2015 rule-based classification.
 *
 * Pathogenic requires one of:
 *   1. PVS + ≥1 PS
 *   2. PVS + ≥2 PM
 *   3. PVS + 1 PM + 1 PP
 *   4. PVS + ≥2 PP
 *   5. ≥2 PS
 *   6. 1 PS + ≥3 PM
 *   7. 1 PS + 2 PM + ≥2 PP
 *   8. 1 PS + 1 PM + ≥4 PP
 *
 * Likely Pathogenic requires one of:
 *   1. PVS + 1 PM
 *   2. PVS + 1 PP
 *   3. 1 PS + 1-2 PM
 *   4. 1 PS + ≥2 PP
 *   5. ≥3 PM
 *   6. 2 PM + ≥2 PP
 *   7. 1 PM + ≥4 PP
 *
 * Benign requires one of:
 *   1. BA1 (stand-alone)
 *   2. ≥2 BS
 *
 * Likely Benign requires one of:
 *   1. 1 BS + 1 BP
 *   2. ≥2 BP
 *
 * Otherwise: VUS
 */
export function classifyByRules(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): AcmgClassification {
  const p = countByStrength(pathogenic)
  const b = countByStrength(benign)

  // --- Benign rules (check first: BA1 is stand-alone) ---
  if (b.standAlone >= 1) return 'Benign'
  if (b.strong >= 2) return 'Benign'

  // Likely Benign
  if (b.strong >= 1 && b.supporting >= 1) return 'Likely Benign'
  if (b.supporting >= 2) return 'Likely Benign'

  // --- Pathogenic rules ---
  // PVS1 combinations
  if (p.veryStrong >= 1) {
    if (p.strong >= 1) return 'Pathogenic' // PVS + PS
    if (p.moderate >= 2) return 'Pathogenic' // PVS + 2 PM
    if (p.moderate >= 1 && p.supporting >= 1) return 'Pathogenic' // PVS + PM + PP
    if (p.supporting >= 2) return 'Pathogenic' // PVS + 2 PP
  }
  // Multiple strong
  if (p.strong >= 2) return 'Pathogenic'
  // PS + multiple PM/PP
  if (p.strong >= 1) {
    if (p.moderate >= 3) return 'Pathogenic' // PS + 3 PM
    if (p.moderate >= 2 && p.supporting >= 2) return 'Pathogenic' // PS + 2 PM + 2 PP
    if (p.moderate >= 1 && p.supporting >= 4) return 'Pathogenic' // PS + 1 PM + 4 PP
  }

  // --- Likely Pathogenic rules ---
  if (p.veryStrong >= 1) {
    if (p.moderate >= 1) return 'Likely Pathogenic' // PVS + PM
    if (p.supporting >= 1) return 'Likely Pathogenic' // PVS + PP
  }
  if (p.strong >= 1) {
    if (p.moderate >= 1) return 'Likely Pathogenic' // PS + 1-2 PM
    if (p.supporting >= 2) return 'Likely Pathogenic' // PS + 2 PP
  }
  if (p.moderate >= 3) return 'Likely Pathogenic' // 3 PM
  if (p.moderate >= 2 && p.supporting >= 2) return 'Likely Pathogenic' // 2 PM + 2 PP
  if (p.moderate >= 1 && p.supporting >= 4) return 'Likely Pathogenic' // 1 PM + 4 PP

  return 'VUS'
}

/**
 * Calculate classification from evidence code arrays using ACMG/AMP 2015 rules.
 * Returns null classification if no confirmed codes exist.
 */
export function calculateClassification(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): ClassificationResult {
  const points = calculatePoints(pathogenic, benign)

  const hasConfirmed = pathogenic.some((c) => c.confirmed) || benign.some((c) => c.confirmed)

  return {
    ...points,
    classification: hasConfirmed ? classifyByRules(pathogenic, benign) : null
  }
}
