import { ipcRenderer } from 'electron'
import type { AuditLogDomainContract } from '../../shared/ipc/domains/audit-log'

export function createAuditLogApi(): AuditLogDomainContract {
  return {
    getByEntity: (entityKey) => ipcRenderer.invoke('audit:getByEntity', entityKey),
    query: (params) => ipcRenderer.invoke('audit:query', params)
  }
}
