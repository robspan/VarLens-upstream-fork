import { rowsOf, type IpcScenario } from './shared'

export const variantsScenario: IpcScenario = {
  area: 'variants',
  run: async (ctx) => [
    await ctx.call('variants', 'query', [ctx.primaryCaseId, { consequences: ['HIGH'] }, 0, 25]),
    rowsOf(await ctx.call('variants', 'search', [ctx.primaryCaseId, 'COMT', 5])),
    await ctx.call('variants', 'geneSymbols', [ctx.primaryCaseId, 'CO', 5]),
    await ctx.call('variants', 'typeCounts', [ctx.primaryCaseId]),
    await ctx.call('variants', 'typesPresent', [{ caseId: ctx.primaryCaseId }]),
    await ctx.call('variants', 'columnMeta', [
      { caseId: ctx.primaryCaseId, columnKey: 'gene_symbol' }
    ]),
    await ctx.call('variants', 'getFilterOptions', [ctx.primaryCaseId])
  ]
}
