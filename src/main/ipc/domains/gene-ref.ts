import type { IpcMain } from 'electron'
import { registerGeneRefHandlers } from '../handlers/gene-ref'

export function registerGeneRefDomain(ipcMain: IpcMain): void {
  registerGeneRefHandlers({ ipcMain })
}
