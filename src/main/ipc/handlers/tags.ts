import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  TagIdSchema,
  TagCreateSchema,
  TagUpdateSchema,
  VariantTagAssignSchema,
  VariantTagSetSchema,
  CaseVariantIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  getUsageCount,
  getVariantTags,
  assignVariantTag,
  removeVariantTag,
  setVariantTags
} from './tags-logic'

/**
 * Tags IPC handlers
 *
 * Channels: tags:list, tags:create, tags:update, tags:delete, tags:getUsageCount,
 *           tags:getVariantTags, tags:assignVariantTag, tags:removeVariantTag, tags:setVariantTags
 */
export function registerTagHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  // ============================================================
  // Tag CRUD Handlers
  // ============================================================

  ipcMain.handle('tags:list', async () => {
    return wrapHandler(() => listTags(getDb, getDbPool))
  })

  ipcMain.handle('tags:create', async (_event, name: unknown, color: unknown) => {
    return wrapHandler(async () => {
      const validated = TagCreateSchema.safeParse({ name, color })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:create params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid tag parameters')
      }
      return createTag(validated.data.name, validated.data.color, getDb)
    })
  })

  ipcMain.handle('tags:update', async (_event, id: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      const validatedId = TagIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:update id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }
      const validatedUpdates = TagUpdateSchema.safeParse(updates)
      if (!validatedUpdates.success) {
        mainLogger.error(`Invalid tags:update updates: ${validatedUpdates.error.message}`, 'tags')
        throw new Error('Invalid tag update parameters')
      }
      return updateTag(validatedId.data, validatedUpdates.data, getDb)
    })
  })

  ipcMain.handle('tags:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validatedId = TagIdSchema.safeParse(id)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:delete id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }
      deleteTag(validatedId.data, getDb)
      return undefined
    })
  })

  ipcMain.handle('tags:getUsageCount', async (_event, tagId: unknown) => {
    return wrapHandler(async () => {
      const validatedId = TagIdSchema.safeParse(tagId)
      if (!validatedId.success) {
        mainLogger.error(`Invalid tags:getUsageCount id: ${validatedId.error.message}`, 'tags')
        throw new Error('Invalid tag ID')
      }
      return getUsageCount(validatedId.data, getDb, getDbPool)
    })
  })

  // ============================================================
  // Variant Tag Assignment Handlers
  // ============================================================

  ipcMain.handle('tags:getVariantTags', async (_event, caseId: unknown, variantId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
      if (!validated.success) {
        mainLogger.error(`Invalid tags:getVariantTags params: ${validated.error.message}`, 'tags')
        throw new Error('Invalid case/variant ID')
      }
      return getVariantTags(validated.data.caseId, validated.data.variantId, getDb, getDbPool)
    })
  })

  ipcMain.handle(
    'tags:assignVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:assignVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag assignment parameters')
        }
        assignVariantTag(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagId,
          getDb
        )
        return undefined
      })
    }
  )

  ipcMain.handle(
    'tags:removeVariantTag',
    async (_event, caseId: unknown, variantId: unknown, tagId: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagAssignSchema.safeParse({ caseId, variantId, tagId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid tags:removeVariantTag params: ${validated.error.message}`,
            'tags'
          )
          throw new Error('Invalid tag removal parameters')
        }
        removeVariantTag(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagId,
          getDb
        )
        return undefined
      })
    }
  )

  ipcMain.handle(
    'tags:setVariantTags',
    async (_event, caseId: unknown, variantId: unknown, tagIds: unknown) => {
      return wrapHandler(async () => {
        const validated = VariantTagSetSchema.safeParse({ caseId, variantId, tagIds })
        if (!validated.success) {
          mainLogger.error(`Invalid tags:setVariantTags params: ${validated.error.message}`, 'tags')
          throw new Error('Invalid tag set parameters')
        }
        setVariantTags(
          validated.data.caseId,
          validated.data.variantId,
          validated.data.tagIds,
          getDb
        )
        return undefined
      })
    }
  )
}
