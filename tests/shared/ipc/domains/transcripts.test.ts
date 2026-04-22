import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('transcripts preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all transcripts domain channels without unwrapping in createTranscriptsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          variant_id: 1,
          transcript_id: 'ENST00000001',
          gene_symbol: 'TP53',
          consequence: 'missense_variant',
          cdna: 'c.215G>A',
          aa_change: 'p.Arg72Pro',
          hpo_sim_score: 0.85,
          moi: 'AD',
          is_selected: true,
          is_mane_select: true,
          is_canonical: true
        }
      ])
      .mockResolvedValueOnce({
        success: true
      })
      .mockResolvedValueOnce({
        success: true
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createTranscriptsApi } = await import('../../../../src/preload/domains/transcripts')
    const api = createTranscriptsApi()

    await expect(api.list(1)).resolves.toMatchObject([
      {
        id: 1,
        variant_id: 1,
        transcript_id: 'ENST00000001',
        gene_symbol: 'TP53'
      }
    ])

    await expect(api.switch(1, 'ENST00000001')).resolves.toMatchObject({
      success: true
    })

    await expect(
      api.insertAndSwitch(1, {
        transcript_id: 'ENST00000002',
        gene_symbol: 'TP53',
        consequence: 'missense_variant',
        cdna: 'c.215G>A',
        aa_change: 'p.Arg72Pro',
        hpo_sim_score: 0.85,
        moi: 'AD',
        is_selected: 1
      })
    ).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'transcripts:list', 1)
    expect(invoke).toHaveBeenNthCalledWith(2, 'transcripts:switch', 1, 'ENST00000001')
    expect(invoke).toHaveBeenNthCalledWith(3, 'transcripts:insertAndSwitch', 1, {
      transcript_id: 'ENST00000002',
      gene_symbol: 'TP53',
      consequence: 'missense_variant',
      cdna: 'c.215G>A',
      aa_change: 'p.Arg72Pro',
      hpo_sim_score: 0.85,
      moi: 'AD',
      is_selected: 1
    })
  })

  it('preload index preserves transcripts transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'transcripts:list') {
        return [
          {
            id: 1,
            variant_id: 1,
            transcript_id: 'ENST00000001',
            gene_symbol: 'TP53',
            consequence: 'missense_variant',
            cdna: 'c.215G>A',
            aa_change: 'p.Arg72Pro',
            hpo_sim_score: 0.85,
            moi: 'AD',
            is_selected: true,
            is_mane_select: true,
            is_canonical: true
          }
        ]
      }
      if (channel === 'transcripts:switch' || channel === 'transcripts:insertAndSwitch') {
        return {
          success: true
        }
      }
      return {
        code: ErrorCode.DB_ERROR,
        message: `${channel} failed`,
        userMessage: `Could not run ${channel}`
      }
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      transcripts: {
        list: (variantId: number) => Promise<unknown>
        switch: (variantId: number, transcriptId: string) => Promise<unknown>
        insertAndSwitch: (variantId: number, transcript: unknown) => Promise<unknown>
      }
    }

    await expect(api.transcripts.list(1)).resolves.toMatchObject([
      {
        id: 1,
        variant_id: 1,
        transcript_id: 'ENST00000001'
      }
    ])

    await expect(api.transcripts.switch(1, 'ENST00000001')).resolves.toMatchObject({
      success: true
    })

    await expect(
      api.transcripts.insertAndSwitch(1, {
        transcript_id: 'ENST00000002',
        gene_symbol: 'TP53',
        consequence: 'missense_variant',
        cdna: 'c.215G>A',
        aa_change: 'p.Arg72Pro',
        hpo_sim_score: 0.85,
        moi: 'AD',
        is_selected: 1
      })
    ).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenCalledWith('transcripts:list', 1)
    expect(invoke).toHaveBeenCalledWith('transcripts:switch', 1, 'ENST00000001')
    expect(invoke).toHaveBeenCalledWith('transcripts:insertAndSwitch', 1, {
      transcript_id: 'ENST00000002',
      gene_symbol: 'TP53',
      consequence: 'missense_variant',
      cdna: 'c.215G>A',
      aa_change: 'p.Arg72Pro',
      hpo_sim_score: 0.85,
      moi: 'AD',
      is_selected: 1
    })
  })
})
