import type { IpcScenario } from './shared'

export const analysisGroupsScenario: IpcScenario = {
  area: 'analysis-groups',
  run: async (ctx) => {
    const group = (await ctx.call('analysisGroups', 'create', [
      { name: 'IPC parity trio', groupType: 'family', description: 'Analysis group fixture' }
    ])) as { id: number }
    return [
      group,
      await ctx.call('analysisGroups', 'addMember', [
        {
          groupId: group.id,
          caseId: ctx.primaryCaseId,
          role: 'proband',
          affectedStatus: 'affected',
          individualId: 'IPC-P1'
        }
      ]),
      await ctx.call('analysisGroups', 'getForCase', [ctx.primaryCaseId])
    ]
  }
}
