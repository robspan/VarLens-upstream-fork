/**
 * Targeted execution-coverage tests for src/main/services/scoring/index.ts
 * lines 111-120. These paths are not exercised by the existing scorer-per-type
 * tests because those tests call scoreSnv/scoreSv/scoreCnv/scoreStr directly —
 * they never invoke scoreRow(), so the default branch (unknown variant_type)
 * and the catch block (scorer throws) are never reached.
 *
 * This is a coverage-targeted file, NOT a behavior-regression file — the
 * existing score-snv/sv/cnv/str/combine tests are authoritative for
 * behavior. The point here is to hit the V8 line-coverage bookkeeping for
 * lines 112-120 so the scoring glob aggregate passes its 95/95 threshold.
 *
 * Spec: .planning/specs/2026-04-11-post-0.56.0-cleanup-design.md §5.2
 */

import { describe, it, expect, vi } from 'vitest'
import { scoreRow, ZERO_COMPONENTS } from '../../../../src/main/services/scoring'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'
import type { RankConfig } from '../../../../src/shared/types/shortlist'

// Mock MainLogger to avoid side effects (catch block calls mainLogger.error)
vi.mock('../../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const FLAT_CONFIG: RankConfig = {
  weights: {
    impact: 0.25,
    pathogenicity: 0.25,
    rarity: 0.25,
    clinvar: 0.25,
    phenotype: 0
  }
}

describe('scoreRow() — uncovered paths (lines 112-120)', () => {
  // -----------------------------------------------------------------------
  // Line 112: default branch — unknown variant_type falls back to
  // ZERO_COMPONENTS without throwing.
  // -----------------------------------------------------------------------

  it('returns ZERO_COMPONENTS for an unknown variant_type (default branch)', () => {
    const row = buildShortlistCandidate({
      // Cast required to force the default branch with a non-standard type
      variant_type: 'unknown_type' as never
    })
    const result = scoreRow(row, FLAT_CONFIG)
    expect(result.rank_components).toEqual(ZERO_COMPONENTS)
  })

  it('rank_score is 0 for the unknown-type default path (all components are 0)', () => {
    const row = buildShortlistCandidate({ variant_type: 'unknown_type' as never })
    const result = scoreRow(row, FLAT_CONFIG)
    expect(result.rank_score).toBe(0)
  })

  it('pin flags are false for an unknown variant_type row by default', () => {
    const row = buildShortlistCandidate({ variant_type: 'unknown_type' as never })
    const result = scoreRow(row, FLAT_CONFIG)
    expect(result.rank_starred_pinned).toBe(false)
    expect(result.rank_clinvar_pinned).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Lines 114-120: catch block — if a per-type scorer unexpectedly throws,
  // scoreRow catches the error, logs it via mainLogger.error, and returns
  // ZERO_COMPONENTS so one bad row cannot crash the full ranking pass.
  // -----------------------------------------------------------------------

  it('returns ZERO_COMPONENTS when the per-type scorer throws (catch block)', async () => {
    // We mock score-snv so that the scorer used for 'snv' rows throws,
    // forcing execution into the catch block (lines 114-120).
    vi.doMock('../../../../src/main/services/scoring/score-snv', () => ({
      scoreSnv: () => {
        throw new Error('scorer boom')
      }
    }))

    // Re-import scoreRow to pick up the mocked scorer
    const { scoreRow: scoreRowFresh } =
      await import('../../../../src/main/services/scoring/index?throwing=1')

    const row = buildShortlistCandidate({ variant_type: 'snv' })
    const result = scoreRowFresh(row, FLAT_CONFIG)
    expect(result.rank_components).toEqual(ZERO_COMPONENTS)
    expect(result.rank_score).toBe(0)

    vi.doUnmock('../../../../src/main/services/scoring/score-snv')
  })

  it('catch block also handles non-Error thrown values (String fallback)', async () => {
    vi.doMock('../../../../src/main/services/scoring/score-snv', () => ({
      scoreSnv: () => {
        throw 'string error' // non-Error thrown value — tests the String fallback branch
      }
    }))

    const { scoreRow: scoreRowFresh } =
      await import('../../../../src/main/services/scoring/index?throwing=2')

    const row = buildShortlistCandidate({ variant_type: 'snv' })
    const result = scoreRowFresh(row, FLAT_CONFIG)
    expect(result.rank_components).toEqual(ZERO_COMPONENTS)

    vi.doUnmock('../../../../src/main/services/scoring/score-snv')
  })
})
