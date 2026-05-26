import type { IpcScenario } from './shared'

export const presetsScenario: IpcScenario = {
  area: 'presets',
  run: async (ctx) => [
    await ctx.call('presets', 'create', [
      {
        name: 'IPC parity high impact',
        description: 'High-impact COMT parity filter',
        filterJson: { geneSymbol: 'COMT', consequences: ['HIGH'], clinvars: ['Pathogenic'] },
        kind: 'filter',
        isVisible: true,
        sortOrder: 90
      }
    ]),
    await ctx.call('presets', 'list')
  ]
}
