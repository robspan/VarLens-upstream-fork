import type { IpcScenario } from './shared'

export const caseMetricsScenario: IpcScenario = {
  area: 'case-metrics',
  run: async (ctx) => {
    const metric = (await ctx.call('caseMetrics', 'createDefinition', [
      'Mean coverage',
      'numeric',
      'x',
      'Sequencing QC'
    ])) as { id: number }
    return [
      metric,
      await ctx.call('caseMetrics', 'upsert', [
        ctx.primaryCaseId,
        metric.id,
        { numeric_value: 38.5 }
      ]),
      await ctx.call('caseMetrics', 'listDefinitions'),
      await ctx.call('caseMetrics', 'listForCase', [ctx.primaryCaseId])
    ]
  }
}
