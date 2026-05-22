import type { IpcScenario } from './shared'

export const vepScenario: IpcScenario = {
  area: 'vep',
  run: async (ctx) => [
    await ctx.call('vep', 'fetch', ['17', 7674220, 'G', 'T']),
    await ctx.call('vep', 'getCacheStats')
  ]
}
