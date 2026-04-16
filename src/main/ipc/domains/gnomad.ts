import type { IpcMain } from 'electron'
import { registerGnomadHandlers } from '../handlers/gnomad'

export function registerGnomadDomain(ipcMain: IpcMain): void {
  registerGnomadHandlers({ ipcMain })
}
