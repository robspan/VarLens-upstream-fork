import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import {
  getMetadata,
  upsertMetadata,
  listCohorts,
  createCohort,
  updateCohort,
  deleteCohort,
  getCohortByName,
  getCaseCohorts,
  assignCohort,
  removeCohort,
  setCohorts,
  getHpoTerms,
  assignHpoTerm,
  removeHpoTerm,
  getDataInfo,
  upsertDataInfo,
  listExternalIds,
  upsertExternalId,
  deleteExternalId,
  distinctHpoTerms,
  distinctPlatforms,
  distinctExternalIdTypes,
  getFullMetadata
} from './case-metadata-logic'

// ============================================================
// Inline Zod Schemas for Case Metadata
// ============================================================

const CohortIdSchema = z.number().int().positive()

const MetadataUpsertSchema = z.object({
  affected_status: z.string().nullish(),
  sex: z.string().nullish(),
  notes: z.string().nullish()
})

const CohortCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullish()
})

const CohortUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullish()
})

const CohortNameSchema = z.string().min(1).max(200)

const CaseCohortAssignSchema = z.object({
  caseId: CaseIdSchema,
  cohortId: CohortIdSchema
})

const CaseSetCohortsSchema = z.object({
  caseId: CaseIdSchema,
  cohortIds: z.array(z.number().int().positive())
})

const HpoTermAssignSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1),
  hpoLabel: z.string().min(1)
})

const HpoTermRemoveSchema = z.object({
  caseId: CaseIdSchema,
  hpoId: z.string().min(1)
})

const DataInfoUpsertSchema = z.object({
  platform: z.string().nullish(),
  platform_details: z.string().nullish(),
  af_filter: z.string().nullish(),
  gene_list_filter: z.string().nullish(),
  region_filter: z.string().nullish(),
  quality_filter: z.string().nullish(),
  data_notes: z.string().nullish(),
  gene_list_id: z.number().int().positive().nullish(),
  region_file_id: z.number().int().positive().nullish()
})

const ExternalIdUpsertSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1),
  idValue: z.string().min(1)
})

const ExternalIdDeleteSchema = z.object({
  caseId: CaseIdSchema,
  idType: z.string().min(1)
})

/**
 * Case Metadata IPC handlers
 *
 * Channels: case-metadata:get, case-metadata:upsert, case-metadata:listCohorts,
 *           case-metadata:createCohort, case-metadata:updateCohort, case-metadata:deleteCohort, case-metadata:getCohortByName,
 *           case-metadata:getCaseCohorts, case-metadata:assignCohort, case-metadata:removeCohort,
 *           case-metadata:setCohorts, case-metadata:getHpoTerms, case-metadata:assignHpoTerm,
 *           case-metadata:removeHpoTerm, case-metadata:getFullMetadata
 */
export function registerCaseMetadataHandlers({
  ipcMain,
  getDb,
  getDbPool
}: HandlerDependencies): void {
  // ============================================================
  // Case Metadata Handlers
  // ============================================================

  ipcMain.handle('case-metadata:get', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:get params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getMetadata(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle('case-metadata:upsert', async (_event, caseId: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      const validatedId = CaseIdSchema.safeParse(caseId)
      if (!validatedId.success) {
        mainLogger.error(
          `Invalid case-metadata:upsert caseId: ${validatedId.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      const validatedUpdates = MetadataUpsertSchema.safeParse(updates)
      if (!validatedUpdates.success) {
        mainLogger.error(
          `Invalid case-metadata:upsert updates: ${validatedUpdates.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      return upsertMetadata(validatedId.data, validatedUpdates.data, getDb)
    })
  })

  // ============================================================
  // Cohort Group Handlers
  // ============================================================

  ipcMain.handle('case-metadata:listCohorts', async () => {
    return wrapHandler(async () => {
      return listCohorts(getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'case-metadata:createCohort',
    async (_event, name: unknown, description?: unknown) => {
      return wrapHandler(async () => {
        const validated = CohortCreateSchema.safeParse({ name, description })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:createCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }
        return createCohort(validated.data, getDb)
      })
    }
  )

  ipcMain.handle(
    'case-metadata:updateCohort',
    async (_event, cohortId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        const validatedId = CohortIdSchema.safeParse(cohortId)
        if (!validatedId.success) {
          mainLogger.error(
            `Invalid case-metadata:updateCohort cohortId: ${validatedId.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const validatedUpdates = CohortUpdateSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid case-metadata:updateCohort updates: ${validatedUpdates.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        return updateCohort(validatedId.data, validatedUpdates.data, getDb)
      })
    }
  )

  ipcMain.handle('case-metadata:deleteCohort', async (_event, cohortId: unknown) => {
    return wrapHandler(async () => {
      const validatedId = CohortIdSchema.safeParse(cohortId)
      if (!validatedId.success) {
        mainLogger.error(
          `Invalid case-metadata:deleteCohort cohortId: ${validatedId.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      deleteCohort(validatedId.data, getDb)
      return undefined
    })
  })

  ipcMain.handle('case-metadata:getCohortByName', async (_event, name: unknown) => {
    return wrapHandler(async () => {
      const validated = CohortNameSchema.safeParse(name)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getCohortByName params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getCohortByName(validated.data, getDb, getDbPool)
    })
  })

  // ============================================================
  // Case-Cohort Link Handlers
  // ============================================================

  ipcMain.handle('case-metadata:getCaseCohorts', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getCaseCohorts params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getCaseCohorts(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'case-metadata:assignCohort',
    async (_event, caseId: unknown, cohortId: unknown) => {
      return wrapHandler(async () => {
        const validated = CaseCohortAssignSchema.safeParse({ caseId, cohortId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:assignCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        assignCohort(validated.data.caseId, validated.data.cohortId, getDb)
        return undefined
      })
    }
  )

  ipcMain.handle(
    'case-metadata:removeCohort',
    async (_event, caseId: unknown, cohortId: unknown) => {
      return wrapHandler(async () => {
        const validated = CaseCohortAssignSchema.safeParse({ caseId, cohortId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:removeCohort params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        removeCohort(validated.data.caseId, validated.data.cohortId, getDb)
        return undefined
      })
    }
  )

  ipcMain.handle(
    'case-metadata:setCohorts',
    async (_event, caseId: unknown, cohortIds: unknown) => {
      return wrapHandler(async () => {
        const validated = CaseSetCohortsSchema.safeParse({ caseId, cohortIds })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:setCohorts params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        setCohorts(validated.data.caseId, validated.data.cohortIds, getDb)
        return undefined
      })
    }
  )

  // ============================================================
  // HPO Term Handlers
  // ============================================================

  ipcMain.handle('case-metadata:getHpoTerms', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getHpoTerms params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getHpoTerms(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'case-metadata:assignHpoTerm',
    async (_event, caseId: unknown, hpoId: unknown, hpoLabel: unknown) => {
      return wrapHandler(async () => {
        const validated = HpoTermAssignSchema.safeParse({ caseId, hpoId, hpoLabel })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:assignHpoTerm params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        return assignHpoTerm(
          validated.data.caseId,
          validated.data.hpoId,
          validated.data.hpoLabel,
          getDb
        )
      })
    }
  )

  ipcMain.handle('case-metadata:removeHpoTerm', async (_event, caseId: unknown, hpoId: unknown) => {
    return wrapHandler(async () => {
      const validated = HpoTermRemoveSchema.safeParse({ caseId, hpoId })
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:removeHpoTerm params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }

      removeHpoTerm(validated.data.caseId, validated.data.hpoId, getDb)
      return undefined
    })
  })

  // ============================================================
  // Case Data Info Handlers
  // ============================================================

  ipcMain.handle('case-metadata:getDataInfo', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getDataInfo params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getDataInfo(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'case-metadata:upsertDataInfo',
    async (_event, caseId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        const validatedId = CaseIdSchema.safeParse(caseId)
        if (!validatedId.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertDataInfo caseId: ${validatedId.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        const validatedUpdates = DataInfoUpsertSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertDataInfo updates: ${validatedUpdates.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        return upsertDataInfo(validatedId.data, validatedUpdates.data, getDb)
      })
    }
  )

  // ============================================================
  // Case External IDs Handlers
  // ============================================================

  ipcMain.handle('case-metadata:listExternalIds', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:listExternalIds params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return listExternalIds(validated.data, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'case-metadata:upsertExternalId',
    async (_event, caseId: unknown, idType: unknown, idValue: unknown) => {
      return wrapHandler(async () => {
        const validated = ExternalIdUpsertSchema.safeParse({ caseId, idType, idValue })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:upsertExternalId params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        return upsertExternalId(
          validated.data.caseId,
          validated.data.idType,
          validated.data.idValue,
          getDb
        )
      })
    }
  )

  ipcMain.handle(
    'case-metadata:deleteExternalId',
    async (_event, caseId: unknown, idType: unknown) => {
      return wrapHandler(async () => {
        const validated = ExternalIdDeleteSchema.safeParse({ caseId, idType })
        if (!validated.success) {
          mainLogger.error(
            `Invalid case-metadata:deleteExternalId params: ${validated.error.message}`,
            'case-metadata'
          )
          throw new Error('Invalid parameters')
        }

        deleteExternalId(validated.data.caseId, validated.data.idType, getDb)
        return undefined
      })
    }
  )

  // ============================================================
  // Distinct Lookups
  // ============================================================

  ipcMain.handle('case-metadata:distinctHpoTerms', async () => {
    return wrapHandler(async () => {
      return distinctHpoTerms(getDb, getDbPool)
    })
  })

  ipcMain.handle('case-metadata:distinctPlatforms', async () => {
    return wrapHandler(async () => {
      return distinctPlatforms(getDb, getDbPool)
    })
  })

  ipcMain.handle('case-metadata:distinctExternalIdTypes', async () => {
    return wrapHandler(async () => {
      return distinctExternalIdTypes(getDb, getDbPool)
    })
  })

  // ============================================================
  // Convenience Handlers
  // ============================================================

  ipcMain.handle('case-metadata:getFullMetadata', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid case-metadata:getFullMetadata params: ${validated.error.message}`,
          'case-metadata'
        )
        throw new Error('Invalid parameters')
      }
      return getFullMetadata(validated.data, getDb, getDbPool)
    })
  })
}
