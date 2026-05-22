import type { IpcScenario } from './shared'

export const auditScenario: IpcScenario = {
  area: 'audit',
  run: async (ctx) => [await ctx.call('audit', 'query', [{ limit: 20, offset: 0 }])]
}
