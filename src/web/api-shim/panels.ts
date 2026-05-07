import type { PanelsDomainContract } from '../../shared/ipc/domains/panels'
import { httpInvoke } from './http-invoke'

export const createPanelsApi = (): PanelsDomainContract => ({
  list: () => httpInvoke('/api/panels/list', []),
  get: (id) => httpInvoke('/api/panels/get', [id]),
  create: (params) => httpInvoke('/api/panels/create', [params]),
  update: (params) => httpInvoke('/api/panels/update', [params]),
  delete: (id) => httpInvoke('/api/panels/delete', [id]),
  duplicate: (id, newName) => httpInvoke('/api/panels/duplicate', [id, newName]),
  setGenes: (panelId, genes) => httpInvoke('/api/panels/setGenes', [panelId, genes]),
  getGenes: (panelId) => httpInvoke('/api/panels/getGenes', [panelId]),
  activate: (caseId, panelId, paddingBp) =>
    httpInvoke('/api/panels/activate', [caseId, panelId, paddingBp]),
  deactivate: (caseId, panelId) => httpInvoke('/api/panels/deactivate', [caseId, panelId]),
  activeForCase: (caseId) => httpInvoke('/api/panels/activeForCase', [caseId]),
  validateSymbols: (symbols) => httpInvoke('/api/panels/validateSymbols', [symbols]),
  autocomplete: (query, limit) => httpInvoke('/api/panels/autocomplete', [query, limit]),
  searchPanelApp: (keyword, region) => httpInvoke('/api/panels/searchPanelApp', [keyword, region]),
  importPanelApp: (params) => httpInvoke('/api/panels/importPanelApp', [params]),
  generateStringDb: (params) => httpInvoke('/api/panels/generateStringDb', [params]),
  exportBed: (panelId, assembly, paddingBp) =>
    httpInvoke('/api/panels/exportBed', [panelId, assembly, paddingBp])
})
