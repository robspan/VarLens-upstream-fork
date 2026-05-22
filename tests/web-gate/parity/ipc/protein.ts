import type { IpcScenario } from './shared'

export const proteinScenario: IpcScenario = {
  area: 'protein',
  run: async (ctx) => [
    await ctx.call('protein', 'getMapping', ['TP53']),
    await ctx.call('protein', 'getDomains', ['P04637']),
    await ctx.call('protein', 'getStructure', ['P04637']),
    await ctx.call('protein', 'getGeneStructure', ['TP53'])
  ]
}
