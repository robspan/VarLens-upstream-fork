import { parentPort } from 'worker_threads'
import type { WorkerRequest, WorkerResponse, GeneAssociationResult } from './types'
import { fisherExactTest } from './fisher'
import { logisticBurdenTest } from './burden'

if (!parentPort) throw new Error('Must be run as worker thread')

parentPort.on('message', (request: WorkerRequest) => {
  if (request.type === 'run') {
    const total = request.genes.length

    for (let i = 0; i < request.genes.length; i++) {
      const gene = request.genes[i]

      try {
        const fisher = fisherExactTest(
          gene.groupA_carrier_count,
          gene.groupB_carrier_count,
          gene.groupA_non_carrier_count,
          gene.groupB_non_carrier_count
        )

        const logistic = logisticBurdenTest(gene.samples, request.weight_scheme)

        const result: GeneAssociationResult = {
          gene_symbol: gene.gene_symbol,
          n_variants: gene.samples.length > 0 ? gene.samples[0].dosages.length : 0,
          groupA_carriers: gene.groupA_carrier_count,
          groupB_carriers: gene.groupB_carrier_count,
          groupA_total: gene.groupA_carrier_count + gene.groupA_non_carrier_count,
          groupB_total: gene.groupB_carrier_count + gene.groupB_non_carrier_count,
          fisher,
          logistic_burden: logistic
        }

        parentPort!.postMessage({
          type: 'result',
          gene_symbol: gene.gene_symbol,
          result
        } satisfies WorkerResponse)
      } catch (error) {
        parentPort!.postMessage({
          type: 'error',
          gene_symbol: gene.gene_symbol,
          error: error instanceof Error ? error.message : String(error)
        } satisfies WorkerResponse)
      }

      parentPort!.postMessage({
        type: 'progress',
        progress: { completed: i + 1, total }
      } satisfies WorkerResponse)
    }
  }
})
