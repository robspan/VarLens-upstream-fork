import type { IpcScenario } from './shared'

export const importScenario: IpcScenario = {
  area: 'import',
  run: async (ctx) => [ctx.primaryImport, ctx.secondaryImport]
}
