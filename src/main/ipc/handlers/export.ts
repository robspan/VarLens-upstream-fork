import { z } from 'zod'
import { dialog, BrowserWindow } from 'electron'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import {
  CaseIdSchema,
  VariantFilterPartialSchema,
  CohortSearchParamsSchema
} from '../../../shared/types/ipc-schemas'
import { safeEmit } from '../utils/safeEmit'
import {
  prepareVariantExport,
  exportVariants,
  exportCohort,
  exportPostgresVariants
} from './export-logic'
import type { ExportCallbacks } from './export-logic'

/** Schema for variant export parameters */
const VariantExportParamsSchema = z.object({
  caseId: CaseIdSchema,
  filters: VariantFilterPartialSchema,
  caseName: z.string().min(1).max(500)
})

/**
 * Export IPC handlers
 * Channels: export:variants, export:cohort
 */
export function registerExportHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle(
    'export:variants',
    async (
      _event,
      caseId: unknown,
      filters: unknown,
      caseName: unknown
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantExportParamsSchema.safeParse({ caseId, filters, caseName })
        if (!validated.success) {
          mainLogger.error(`Invalid export:variants params: ${validated.error.message}`, 'export')
          throw new Error('Invalid parameters')
        }

        mainLogger.debug(
          `Export handler called with caseId=${validated.data.caseId}, caseName=${validated.data.caseName}`,
          'export'
        )

        const session = getDbManager().getCurrentSession()
        const isPostgres = session.capabilities.backend === 'postgres'

        // Pre-check count/limit BEFORE showing save dialog to avoid
        // the user picking a file path only to be told the export is too large.
        const preparation = isPostgres
          ? null
          : prepareVariantExport(getDb, validated.data.caseId, validated.data.filters)
        if (preparation !== null && 'success' in preparation) {
          return preparation
        }

        const mainWindow = BrowserWindow.getAllWindows()[0]

        if (mainWindow === undefined || mainWindow.isDestroyed()) {
          return { success: false, error: 'No window available for export dialog' }
        }

        // Show save dialog
        const defaultFileName = `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_variants.${isPostgres ? 'csv' : 'xlsx'}`
        const result = await dialog.showSaveDialog(mainWindow, {
          title: isPostgres ? 'Export Variants to CSV' : 'Export Variants to Excel',
          defaultPath: defaultFileName,
          filters: isPostgres
            ? [
                { name: 'CSV Files', extensions: ['csv'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            : [
                { name: 'Excel Files', extensions: ['xlsx'] },
                { name: 'All Files', extensions: ['*'] }
              ]
        })

        if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
          return { success: false, error: 'Export cancelled' }
        }

        /** Wire progress events to renderer via safeEmit. */
        const exportCallbacks: ExportCallbacks = {
          onProgress: (data) => {
            if (!mainWindow.isDestroyed()) {
              safeEmit('export:progress', data)
            }
          }
        }

        if (isPostgres) {
          const rows = (await session.getReadExecutor().execute({
            type: 'export:variants',
            params: [
              {
                ...validated.data.filters,
                case_id: validated.data.caseId
              }
            ]
          })) as AsyncIterable<Record<string, unknown>>
          return await exportPostgresVariants(rows, result.filePath, exportCallbacks)
        }

        if (preparation === null) {
          throw new Error('SQLite export preparation was not created')
        }

        return exportVariants(
          getDb,
          preparation.compiled,
          validated.data.filters,
          validated.data.caseName,
          result.filePath,
          exportCallbacks
        )
      }) as Promise<{ success: boolean; filePath?: string; error?: string }>
    }
  )

  ipcMain.handle(
    'export:cohort',
    async (
      _event,
      params: unknown
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          mainLogger.error(`Invalid export:cohort params: ${validated.error.message}`, 'export')
          throw new Error('Invalid parameters')
        }

        mainLogger.debug(
          `Cohort export handler called with params: ${JSON.stringify(validated.data)}`,
          'export'
        )
        const mainWindow = BrowserWindow.getAllWindows()[0]

        // Check for valid window before showing dialog
        if (mainWindow === undefined || mainWindow.isDestroyed()) {
          mainLogger.warn(
            'Window closed before cohort export dialog, cannot show save dialog',
            'export'
          )
          return { success: false, error: 'No window available for export dialog' }
        }

        // Show save dialog
        const defaultFileName = `cohort_variants_${new Date().toISOString().slice(0, 10)}.xlsx`
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export Cohort Variants to Excel',
          defaultPath: defaultFileName,
          filters: [
            { name: 'Excel Files', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (result.canceled === true || result.filePath === undefined || result.filePath === '') {
          return { success: false, error: 'Export cancelled' }
        }

        return exportCohort(getDb, validated.data, result.filePath)
      }) as Promise<{ success: boolean; filePath?: string; error?: string }>
    }
  )
}
