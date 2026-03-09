import type { AcmgEvidenceCode, AcmgClassification } from './types'
import { EVIDENCE_POINTS, CLASSIFICATION_THRESHOLDS } from './types'

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
 * Classify variant from net point total using ClinGen thresholds.
 */
export function classifyFromPoints(netPoints: number): AcmgClassification {
  if (netPoints >= CLASSIFICATION_THRESHOLDS.pathogenic) return 'Pathogenic'
  if (netPoints >= CLASSIFICATION_THRESHOLDS.likely_pathogenic) return 'Likely Pathogenic'
  if (netPoints > CLASSIFICATION_THRESHOLDS.likely_benign) return 'VUS'
  if (netPoints > CLASSIFICATION_THRESHOLDS.benign) return 'Likely Benign'
  return 'Benign'
}

/**
 * Calculate classification from evidence code arrays.
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
    classification: hasConfirmed ? classifyFromPoints(points.netPoints) : null
  }
}
