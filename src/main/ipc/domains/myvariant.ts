import type { IpcMain } from 'electron'
import type { HandlerDependencies } from '../types'
import { registerMyVariantHandlers } from '../handlers/myvariant'

export function registerMyvariantDomain(ipcMain: IpcMain, deps: HandlerDependencies): void {
  registerMyVariantHandlers({
    ipcMain,
    getDb: deps.getDb
  })
}
