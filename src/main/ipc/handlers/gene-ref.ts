import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { getGeneReferenceDb, closeGeneReferenceDb } from '../../database/geneReferenceLoader'
import { mainLogger } from '../../services/MainLogger'
import { execFile } from 'child_process'
import { resolve, join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'

/**
 * Gene Reference database IPC handlers
 */
export function registerGeneRefHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('gene-ref:info', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      return geneRef.getInfo()
    })
  })

  ipcMain.handle('gene-ref:assemblies', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      return geneRef.getAssemblies()
    })
  })

  /**
   * Check if the gene reference DB needs updating.
   * Returns age info and whether it's older than 90 days.
   */
  ipcMain.handle('gene-ref:check-updates', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      const info = geneRef.getInfo()
      const nowMs = Date.now()
      const builtAtMs = info.builtAt * 1000 // builtAt is Unix seconds
      const daysSinceBuilt = Math.floor((nowMs - builtAtMs) / (1000 * 60 * 60 * 24))
      const needsUpdate = daysSinceBuilt > 90

      return {
        currentBuiltAt: info.builtAt,
        daysSinceBuilt,
        needsUpdate
      }
    })
  })

  /**
   * Update the gene reference DB by running the build script.
   * Uses child_process to execute the build script, then reloads the DB singleton.
   */
  ipcMain.handle('gene-ref:update', async () => {
    return wrapHandler(async () => {
      // Resolve the build script path
      const appPath = app.getAppPath()
      const scriptPath = resolve(appPath, 'scripts', 'build-gene-reference-db.ts')

      if (!existsSync(scriptPath)) {
        mainLogger.warn(`Gene ref build script not found at: ${scriptPath}`, 'gene-ref')
        return {
          success: false,
          message:
            'Build script not available in packaged app. Use "npm run build:gene-ref" from the project directory.'
        }
      }

      // Find tsx binary (used to run TypeScript scripts)
      const tsxPath = join(appPath, 'node_modules', '.bin', 'tsx')

      mainLogger.info('Starting gene reference DB update...', 'gene-ref')

      return new Promise<{ success: boolean; message: string }>((resolve_p) => {
        execFile(
          tsxPath,
          [scriptPath],
          {
            cwd: appPath,
            timeout: 5 * 60 * 1000, // 5 minute timeout
            env: { ...process.env }
          },
          (error, stdout, stderr) => {
            if (error) {
              const errMsg = stderr || error.message
              mainLogger.error(`Gene ref update failed: ${errMsg}`, 'gene-ref')
              resolve_p({
                success: false,
                message: `Update failed: ${errMsg}`
              })
              return
            }

            mainLogger.info(`Gene ref build output: ${stdout}`, 'gene-ref')

            // Reload the DB singleton
            try {
              closeGeneReferenceDb()
              const geneRef = getGeneReferenceDb()
              const info = geneRef.getInfo()
              mainLogger.info(`Gene reference DB reloaded: ${info.geneCount} genes`, 'gene-ref')
              resolve_p({
                success: true,
                message: `Updated successfully. ${info.geneCount.toLocaleString()} genes loaded.`
              })
            } catch (reloadError) {
              mainLogger.error(
                `Gene ref reload failed: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
                'gene-ref'
              )
              resolve_p({
                success: false,
                message: `Build succeeded but reload failed: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`
              })
            }
          }
        )
      })
    })
  })
}
