import type { IpcScenario } from './shared'

export const hpoScenario: IpcScenario = {
  area: 'hpo',
  run: async (ctx) => [
    await ctx.call('hpo', 'search', ['seizure', 3]),
    await ctx.call('hpo', 'clearCache')
  ]
}
