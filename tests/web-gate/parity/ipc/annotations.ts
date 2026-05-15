import type { IpcScenario } from './shared'

export const annotationsScenario: IpcScenario = {
  area: 'annotations',
  run: async (ctx) => [
    await ctx.call('annotations', 'upsertGlobal', [
      ctx.primaryVariant.chr,
      ctx.primaryVariant.pos,
      ctx.primaryVariant.ref,
      ctx.primaryVariant.alt,
      {
        starred: true,
        acmg_classification: 'Pathogenic',
        global_comment: 'Global parity annotation'
      }
    ]),
    await ctx.call('annotations', 'upsertPerCase', [
      ctx.primaryCaseId,
      ctx.primaryVariant.id,
      {
        starred: true,
        acmg_classification: 'Likely pathogenic',
        per_case_comment: 'Per-case parity'
      }
    ]),
    await ctx.call('annotations', 'getForVariant', [
      ctx.primaryCaseId,
      ctx.primaryVariant.chr,
      ctx.primaryVariant.pos,
      ctx.primaryVariant.ref,
      ctx.primaryVariant.alt
    ])
  ]
}
