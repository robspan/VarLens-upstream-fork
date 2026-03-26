import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StringDbClient } from '../../../src/main/services/api/StringDbClient'

// Mock MainLogger
vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInteraction(
  nameA: string,
  nameB: string,
  score: number,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    stringId_A: `9606.ENSP_${nameA}`,
    stringId_B: `9606.ENSP_${nameB}`,
    preferredName_A: nameA,
    preferredName_B: nameB,
    ncbiTaxonId: 9606,
    score,
    nscore: 0,
    fscore: 0,
    pscore: 0,
    ascore: 0,
    escore: 0,
    dscore: 0,
    tscore: 0,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StringDbClient', () => {
  let client: StringDbClient
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    client = new StringDbClient()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('returns empty array for empty gene list', async () => {
    const result = await client.getInteractionPartners([], {
      requiredScore: 400,
      networkType: 'physical'
    })
    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('extracts unique partners excluding seed genes', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeInteraction('BRCA1', 'TP53', 900),
          makeInteraction('BRCA1', 'BARD1', 850),
          makeInteraction('BRCA2', 'PALB2', 800),
          makeInteraction('BRCA1', 'BRCA2', 700) // both are seeds, should be excluded
        ]),
        { status: 200 }
      )
    )

    const result = await client.getInteractionPartners(['BRCA1', 'BRCA2'], {
      requiredScore: 400,
      networkType: 'physical'
    })

    // Should include TP53, BARD1, PALB2 but not BRCA1 or BRCA2
    expect(result).toHaveLength(3)
    expect(result.map((p) => p.symbol)).toEqual(['TP53', 'BARD1', 'PALB2'])
    expect(result[0].score).toBe(900)
    expect(result[1].score).toBe(850)
    expect(result[2].score).toBe(800)
  })

  it('keeps best score when partner appears multiple times', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeInteraction('BRCA1', 'TP53', 900),
          makeInteraction('BRCA2', 'TP53', 700) // TP53 appears again, lower score
        ]),
        { status: 200 }
      )
    )

    const result = await client.getInteractionPartners(['BRCA1', 'BRCA2'], {
      requiredScore: 400,
      networkType: 'functional'
    })

    // TP53 should appear once with best score (900)
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe('TP53')
    expect(result[0].score).toBe(900)
  })

  it('sends correct POST parameters', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))

    await client.getInteractionPartners(['SCN1A', 'SCN2A'], {
      requiredScore: 700,
      networkType: 'physical'
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('string-db.org/api/json/interaction_partners')
    expect(options.method).toBe('POST')

    // Verify form data content
    const body = options.body as URLSearchParams
    expect(body.get('species')).toBe('9606')
    expect(body.get('required_score')).toBe('700')
    expect(body.get('network_type')).toBe('physical')
    expect(body.get('identifiers')).toContain('SCN1A')
    expect(body.get('identifiers')).toContain('SCN2A')
  })

  it('throws on API error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Error', { status: 500 }))

    await expect(
      client.getInteractionPartners(['BRCA1'], {
        requiredScore: 400,
        networkType: 'physical'
      })
    ).rejects.toThrow('StringDB API error: 500')
  })

  it('returns empty array for non-array response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid input' }), { status: 200 })
    )

    const result = await client.getInteractionPartners(['FAKE_GENE'], {
      requiredScore: 400,
      networkType: 'physical'
    })

    expect(result).toEqual([])
  })

  it('handles case-insensitive seed gene exclusion', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeInteraction('brca1', 'TP53', 900) // lowercase brca1 in response
        ]),
        { status: 200 }
      )
    )

    const result = await client.getInteractionPartners(['BRCA1'], {
      requiredScore: 400,
      networkType: 'physical'
    })

    // brca1 should be excluded (case-insensitive match with BRCA1)
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe('TP53')
  })
})
