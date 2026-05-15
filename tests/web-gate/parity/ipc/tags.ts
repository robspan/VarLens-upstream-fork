import type { IpcScenario } from './shared'

export const tagsScenario: IpcScenario = {
  area: 'tags',
  run: async (ctx) => {
    const tag = (await ctx.call('tags', 'create', ['Needs review', '#6A1B9A'])) as { id: number }
    return [
      tag,
      await ctx.call('tags', 'assignVariantTag', [
        ctx.primaryCaseId,
        ctx.primaryVariant.id,
        tag.id
      ]),
      await ctx.call('tags', 'getVariantTags', [ctx.primaryCaseId, ctx.primaryVariant.id]),
      await ctx.call('tags', 'getUsageCount', [tag.id])
    ]
  }
}
