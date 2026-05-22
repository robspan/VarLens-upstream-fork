import type { IpcScenario } from './shared'

export const geneRefScenario: IpcScenario = {
  area: 'gene-ref',
  run: async (ctx) => [await ctx.call('geneRef', 'info'), await ctx.call('geneRef', 'assemblies')]
}
