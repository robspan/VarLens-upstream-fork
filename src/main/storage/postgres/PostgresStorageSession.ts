import type { Pool } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { Case } from '../../../shared/types/database'
import { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import { PostgresAnalysisGroupsRepository } from './PostgresAnalysisGroupsRepository'
import { PostgresAnnotationsRepository } from './PostgresAnnotationsRepository'
import { PostgresCaseLifecycleRepository } from './PostgresCaseLifecycleRepository'
import { PostgresCaseListRepository } from './PostgresCaseListRepository'
import { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'
import { PostgresCommentsMetricsRepository } from './PostgresCommentsMetricsRepository'
import { PostgresExportRepository } from './PostgresExportRepository'
import { PostgresFilterPresetsRepository } from './PostgresFilterPresetsRepository'
import { PostgresImportExecutor } from './PostgresImportExecutor'
import { PostgresOverviewRepository } from './PostgresOverviewRepository'
import { PostgresPanelsRepository } from './PostgresPanelsRepository'
import { PostgresReadExecutor } from './PostgresReadExecutor'
import { PostgresTagsRepository } from './PostgresTagsRepository'
import { PostgresVariantReadRepository } from './PostgresVariantReadRepository'
import type { StorageImportExecutor } from '../import-executor'
import type { StorageReadExecutor } from '../read-executor'
import { PostgresWriteExecutor } from './PostgresWriteExecutor'
import {
  buildPostgresClientConfig,
  buildPostgresConnectionLabel,
  redactPostgresConnectionUrl,
  type PostgresStorageConfig
} from '../config'
import { toPostgresClientConfigMessage } from '../../../shared/types/postgres-import-worker'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'
import type { StorageWriteExecutor } from '../write-executor'

interface PostgresStorageSessionOptions {
  config: PostgresStorageConfig
  pool: Pool
  createCaseListRepository?: (pool: Pool, schema: string) => PostgresCaseListRepository
}

export const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  workspace: {
    localFileLifecycle: false,
    hostedConnectionLifecycle: true,
    encryptionAtRest: false,
    migrations: true,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: true,
    deleteMany: false,
    deleteAll: false,
    overview: true
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: false,
    filterOptions: true,
    columnMeta: true,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: false,
    tagFilters: false,
    commentFilters: false,
    acmgFilters: false,
    annotationFilters: false,
    inheritanceFilters: false,
    analysisGroupFilters: false,
    phasingFilters: false
  },
  workflow: {
    tags: true,
    annotations: true,
    caseComments: true,
    caseMetrics: true,
    filterPresets: true,
    panels: true,
    geneLists: true,
    regionFiles: true,
    analysisGroups: true,
    auditLog: false
  },
  cohort: {
    query: false,
    summary: false,
    rebuild: false,
    carriers: false,
    geneBurden: false,
    columnMeta: false
  },
  export: {
    variants: true,
    cohort: false,
    streaming: true
  }
}

function unsupported(message: string): never {
  throw new Error(message)
}

export class PostgresStorageSession implements StorageSession {
  readonly capabilities = POSTGRES_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly createCaseListRepository: (
    pool: Pool,
    schema: string
  ) => PostgresCaseListRepository
  private readonly pool: Pool
  private readonly readExecutor: StorageReadExecutor
  private readonly writeExecutor: StorageWriteExecutor
  private readonly importExecutor: StorageImportExecutor
  private cases: PostgresCaseListRepository | null = null

  constructor(options: PostgresStorageSessionOptions) {
    this.pool = options.pool
    const caseMetadata = new PostgresCaseMetadataRepository(options.pool, options.config.schema)
    const tags = new PostgresTagsRepository(options.pool, options.config.schema)
    const annotations = new PostgresAnnotationsRepository(options.pool, options.config.schema)
    const commentsMetrics = new PostgresCommentsMetricsRepository(
      options.pool,
      options.config.schema
    )
    const panels = new PostgresPanelsRepository(options.pool, options.config.schema)
    const filterPresets = new PostgresFilterPresetsRepository(options.pool, options.config.schema)
    const analysisGroups = new PostgresAnalysisGroupsRepository(options.pool, options.config.schema)
    this.readExecutor = new PostgresReadExecutor({
      casesQuery: new PostgresCasesQueryRepository(options.pool, options.config.schema),
      availableBuilds: new PostgresAvailableBuildsRepository(options.pool, options.config.schema),
      overview: new PostgresOverviewRepository(options.pool, options.config.schema),
      export: new PostgresExportRepository(options.pool, options.config.schema),
      tags,
      annotations,
      commentsMetrics,
      panels,
      filterPresets,
      analysisGroups,
      caseMetadata,
      variants: new PostgresVariantReadRepository(options.pool, options.config.schema)
    })
    this.writeExecutor = new PostgresWriteExecutor(
      caseMetadata,
      new PostgresCaseLifecycleRepository(options.pool, options.config.schema),
      {
        tags,
        annotations,
        commentsMetrics,
        panels,
        filterPresets,
        analysisGroups
      }
    )
    this.importExecutor = new PostgresImportExecutor({
      schema: options.config.schema,
      // buildPostgresClientConfig always sets connectionString = config.url (a string),
      // but pg's ClientConfig types it as `string | undefined`. The assertion is safe.
      clientConfig: toPostgresClientConfigMessage(
        buildPostgresClientConfig(options.config) as import('pg').ClientConfig & {
          connectionString: string
        }
      )
    })
    this.createCaseListRepository =
      options.createCaseListRepository ??
      ((pool: Pool, schema: string) => new PostgresCaseListRepository(pool, schema))

    const connectionUrlRedacted = redactPostgresConnectionUrl(options.config.url)

    this.workspace = {
      kind: 'postgres',
      connectionUrlRedacted,
      connectionLabel: buildPostgresConnectionLabel(connectionUrlRedacted, options.config.schema),
      schema: options.config.schema
    }

    this.pool.on('error', (error: Error) => {
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.warn(`Postgres pool error: ${message}`, 'storage')
    })
  }

  async listCases(): Promise<Case[]> {
    if (this.cases === null) {
      this.cases = this.createCaseListRepository(
        this.pool,
        this.workspace.kind === 'postgres' ? this.workspace.schema : 'public'
      )
    }

    return await this.cases.listCases()
  }

  getReadExecutor(): StorageReadExecutor {
    return this.readExecutor
  }

  getWriteExecutor(): StorageWriteExecutor {
    return this.writeExecutor
  }

  getImportExecutor(): StorageImportExecutor {
    return this.importExecutor
  }

  getDatabaseService(): DatabaseService {
    return unsupported('DatabaseService is not available for postgres sessions')
  }

  getDbPool(): DbPool | null {
    return unsupported('DbPool is not available for postgres sessions')
  }

  getEncryptionKey(): string | undefined {
    return unsupported('Encryption keys are not available for postgres sessions')
  }

  needsStartupRebuild(): boolean {
    return unsupported('Startup rebuild is not supported for postgres sessions')
  }

  rekey(_newPassword: string): void {
    unsupported('SQLite rekey is not supported for postgres sessions')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async health(): Promise<StorageHealth> {
    const startedAt = Date.now()

    try {
      await this.pool.query('SELECT 1')

      return {
        ok: true,
        backend: 'postgres',
        roundTripMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        ok: false,
        backend: 'postgres',
        message: error instanceof Error ? error.message : String(error),
        roundTripMs: Date.now() - startedAt
      }
    }
  }
}
