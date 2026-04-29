import { ipcRenderer } from 'electron'
import type { DatabaseDomainContract } from '../../shared/ipc/domains/database'

export function createDatabaseApi(): DatabaseDomainContract {
  return {
    selectFile: () => ipcRenderer.invoke('database:selectFile'),
    selectSaveLocation: (defaultName) =>
      ipcRenderer.invoke('database:selectSaveLocation', defaultName),
    open: (path, password) => ipcRenderer.invoke('database:open', path, password),
    create: (path, password) => ipcRenderer.invoke('database:create', path, password),
    rekey: (newPassword) => ipcRenderer.invoke('database:rekey', newPassword),
    info: () => ipcRenderer.invoke('database:info'),
    capabilities: () => ipcRenderer.invoke('database:capabilities'),
    postgresDiagnostics: () => ipcRenderer.invoke('database:postgresDiagnostics'),
    recentList: () => ipcRenderer.invoke('database:recentList'),
    getOverview: () => ipcRenderer.invoke('database:overview'),
    removeRecent: (path) => ipcRenderer.invoke('database:removeRecent', path),
    deleteFile: (path) => ipcRenderer.invoke('database:deleteFile', path),
    showInFolder: (path) => ipcRenderer.invoke('database:showInFolder', path)
  }
}
