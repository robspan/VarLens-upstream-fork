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
    return [
      panel,
      await ctx.call('panels', 'setGenes', [
        panel.id,
        [
          { hgncId: 'HGNC:2228', symbol: 'COMT' },
          { hgncId: 'HGNC:6742', symbol: 'LZTR1' }
        ]
      ]),
      await ctx.call('panels', 'activate', [ctx.primaryCaseId, panel.id, 50]),
      await ctx.call('panels', 'getGenes', [panel.id]),
      await ctx.call('panels', 'activeForCase', [ctx.primaryCaseId])
    ]
  }
}
