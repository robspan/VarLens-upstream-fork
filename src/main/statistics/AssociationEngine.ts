import type {
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult,
  GeneAssociationResultWithFDR
} from './types'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import { fisherExactTest } from './fisher'
import { logisticBurdenTest } from './burden'
import { benjaminiHochberg } from './fdr'
import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * Main orchestrator for association analysis.
 * Runs synchronously in the main process.
 * Worker pool parallelism can be added later if needed.
 */
export class AssociationEngine {
  private db: Database.Database
  private onProgress?: (completed: number, total: number) => void
  private aborted = false

  constructor(db: Database.Database, onProgress?: (completed: number, total: number) => void) {
    this.db = db
    this.onProgress = onProgress
  }

  run(config: AssociationConfig): AssociationResults {
    const start = Date.now()
    const warnings: string[] = []
    this.aborted = false

    // 1. Build per-gene contingency data
    const builder = new AssociationDataBuilder(this.db)
    const genes = builder.build(
      config.groupA_ids,
      config.groupB_ids,
      config.filters,
      config.covariates
    )

    if (genes.length === 0) {
      return {
        results: [],
        primary_test: config.primary_test,
        config,
        warnings: ['No genes with qualifying variants'],
        elapsed_ms: Date.now() - start
      }
    }

    // 2. Run tests for each gene
    const rawResults: GeneAssociationResult[] = []
    for (let i = 0; i < genes.length; i++) {
      if (this.aborted) break

      const gene = genes[i]
      const fisher = fisherExactTest(
        gene.groupA_carrier_count,
        gene.groupB_carrier_count,
        gene.groupA_non_carrier_count,
        gene.groupB_non_carrier_count
      )
      const logistic = logisticBurdenTest(gene.samples, config.weight_scheme)

      if (logistic.warning !== undefined && logistic.warning !== '') {
        warnings.push(`${gene.gene_symbol}: ${logistic.warning}`)
      }

      rawResults.push({
        gene_symbol: gene.gene_symbol,
        n_variants: gene.samples.length > 0 ? gene.samples[0].dosages.length : 0,
        groupA_carriers: gene.groupA_carrier_count,
        groupB_carriers: gene.groupB_carrier_count,
        groupA_total: gene.groupA_carrier_count + gene.groupA_non_carrier_count,
        groupB_total: gene.groupB_carrier_count + gene.groupB_non_carrier_count,
        fisher,
        logistic_burden: logistic
      })

      this.onProgress?.(i + 1, genes.length)
    }

    // 3. Apply FDR correction
    const pValues = rawResults.map((r) => {
      if (config.primary_test === 'fisher') return r.fisher.p_value
      return r.logistic_burden.p_value
    })
    const qValues = benjaminiHochberg(pValues)

    const results: GeneAssociationResultWithFDR[] = rawResults.map((r, i) => ({
      ...r,
      q_value: qValues[i]
    }))

    // Sort by primary test p-value
    results.sort((a, b) => {
      const pa = config.primary_test === 'fisher' ? a.fisher.p_value : a.logistic_burden.p_value
      const pb = config.primary_test === 'fisher' ? b.fisher.p_value : b.logistic_burden.p_value
      if (pa === null) return 1
      if (pb === null) return -1
      return pa - pb
    })

    return {
      results,
      primary_test: config.primary_test,
      config,
      warnings,
      elapsed_ms: Date.now() - start
    }
  }

  abort(): void {
    this.aborted = true
  }
}
