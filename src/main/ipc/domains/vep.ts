import type { IpcMain } from 'electron'
import { registerVepHandlers } from '../handlers/vep'
import type { HandlerDependencies } from '../types'

export function registerVepDomain(
  ipcMain: IpcMain,
  deps: Omit<HandlerDependencies, 'ipcMain'>
): void {
  registerVepHandlers({
    ipcMain,
    ...deps
  })
}
