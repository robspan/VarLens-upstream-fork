import { normalizeExport, PRIMARY_CASE_NAME, type IpcScenario } from './shared'

export const exportScenario: IpcScenario = {
  area: 'export',
  run: async (ctx) => [
    await normalizeExport(
      await ctx.call('export', 'variants', [
        ctx.primaryCaseId,
        { consequences: ['HIGH'] },
        PRIMARY_CASE_NAME
      ])
    ),
    await normalizeExport(
      await ctx.call('export', 'cohort', [{ limit: 25, offset: 0, gene_symbol: 'COMT' }])
    )
  ]
}
