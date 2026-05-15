import type { IpcScenario } from './shared'

export const cohortScenario: IpcScenario = {
  area: 'cohort',
  run: async (ctx) => [
    await ctx.call('cohort', 'getVariants', [{ limit: 25, offset: 0, gene_symbol: 'COMT' }]),
    await ctx.call('cohort', 'getColumnMeta'),
    await ctx.call('cohort', 'getSummary'),
    await ctx.call('cohort', 'getCarriers', [
      ctx.primaryVariant.chr,
      ctx.primaryVariant.pos,
      ctx.primaryVariant.ref,
      ctx.primaryVariant.alt
    ]),
    await ctx.call('cohort', 'getGeneBurden'),
    await ctx.call('cohort', 'getSummaryStatus')
  ]
}
