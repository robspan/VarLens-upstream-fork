import type { IpcScenario } from './shared'

export const panelsScenario: IpcScenario = {
  area: 'panels',
  run: async (ctx) => {
    const panel = (await ctx.call('panels', 'create', [
      {
        name: 'IPC parity panel',
        description: 'Panel fixture for IPC parity',
        version: '1',
        source: 'manual',
        sourceId: 'ipc-parity-panel'
      }
    ])) as { id: number }

    await ctx.call('panels', 'setGenes', [
      panel.id,
      [
        { hgncId: 'HGNC:2228', symbol: 'COMT' },
        { hgncId: 'HGNC:6742', symbol: 'LZTR1' }
      ]
    ])

    // panels:get — must return the enriched { ...panel, genes } shape
    const fetched = (await ctx.call('panels', 'get', [panel.id])) as {
      id: number
      name: string
      genes: unknown[]
    }

    // panels:update — single pass-through; verify the update round-trips
    const updated = await ctx.call('panels', 'update', [
      {
        id: panel.id,
        name: 'IPC parity panel (updated)',
        description: 'Updated by parity scenario',
        version: '2'
      }
    ])

    return [
      panel,
      fetched,
      // Shape assertions carried as plain values so mismatches surface in snapshots
      {
        fetchedHasId: typeof fetched?.id === 'number',
        fetchedHasName: typeof fetched?.name === 'string',
        fetchedHasGenes: Array.isArray(fetched?.genes),
        fetchedGenesLength: fetched?.genes?.length ?? -1
      },
      updated,
      await ctx.call('panels', 'setGenes', [panel.id, [{ hgncId: 'HGNC:2228', symbol: 'COMT' }]]),
      await ctx.call('panels', 'activate', [ctx.primaryCaseId, panel.id, 50]),
      await ctx.call('panels', 'getGenes', [panel.id]),
      await ctx.call('panels', 'activeForCase', [ctx.primaryCaseId])
    ]
  }
}
