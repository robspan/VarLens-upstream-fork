import type { IpcScenario } from './shared'

export const databaseScenario: IpcScenario = {
  area: 'database',
  run: async (ctx) => [
    await ctx.call('database', 'info'),
    await ctx.call('database', 'capabilities'),
    await ctx.call('database', 'getOverview')
  ]
}
