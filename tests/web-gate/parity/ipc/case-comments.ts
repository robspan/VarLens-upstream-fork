import type { IpcScenario } from './shared'

export const caseCommentsScenario: IpcScenario = {
  area: 'case-comments',
  run: async (ctx) => {
    const comment = (await ctx.call('caseComments', 'create', [
      ctx.primaryCaseId,
      'Interpretation',
      'Initial IPC parity interpretation'
    ])) as { id: number }
    return [
      comment,
      await ctx.call('caseComments', 'update', [comment.id, 'Updated IPC parity interpretation']),
      await ctx.call('caseComments', 'list', [ctx.primaryCaseId])
    ]
  }
}
