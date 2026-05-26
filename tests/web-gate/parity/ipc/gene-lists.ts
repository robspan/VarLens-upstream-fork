import type { IpcScenario } from './shared'

export const geneListsScenario: IpcScenario = {
  area: 'gene-lists',
  run: async (ctx) => {
    const list = (await ctx.call('geneLists', 'create', ['IPC parity genes', 'COMT/LZTR1'])) as {
      id: number
    }
    return [
      list,
      await ctx.call('geneLists', 'setGenes', [list.id, ['COMT', 'LZTR1', 'SNAP29']]),
      await ctx.call('geneLists', 'getGenes', [list.id]),
      await ctx.call('geneLists', 'list')
    ]
  }
}
