import type { CasesDomainContract } from '../../shared/ipc/domains/cases'
import { httpInvoke } from './http-invoke'

export const createCasesApi = (): CasesDomainContract => ({
  list: () => httpInvoke('/api/cases/list', []),
  query: (params) => httpInvoke('/api/cases/query', [params]),
  delete: (id) => httpInvoke('/api/cases/delete', [id]),
  deleteAll: () => httpInvoke('/api/cases/deleteAll', []),
  deleteBatch: (ids) => httpInvoke('/api/cases/deleteBatch', [ids]),
  availableBuilds: () => httpInvoke('/api/cases/availableBuilds', [])
})
