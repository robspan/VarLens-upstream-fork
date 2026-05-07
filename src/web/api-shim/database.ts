import type { DatabaseDomainContract } from '../../shared/ipc/domains/database'
import { httpInvoke } from './http-invoke'

// Most database operations don't apply in web mode (the server owns its
// Postgres connection). Pickers / file operations that exist here for
// the desktop file-backed flow still post to /api/* — the server route
// can return a useful 'web mode' shape (e.g. info() returns the
// current web DB info, deleteFile etc. return success: false).
export const createDatabaseApi = (): DatabaseDomainContract => ({
  selectFile: () => httpInvoke('/api/database/selectFile', []),
  selectSaveLocation: (defaultName) =>
    httpInvoke('/api/database/selectSaveLocation', [defaultName]),
  open: (path, password) => httpInvoke('/api/database/open', [path, password]),
  create: (path, password) => httpInvoke('/api/database/create', [path, password]),
  rekey: (newPassword) => httpInvoke('/api/database/rekey', [newPassword]),
  info: () => httpInvoke('/api/database/info', []),
  capabilities: () => httpInvoke('/api/database/capabilities', []),
  postgresDiagnostics: () => httpInvoke('/api/database/postgresDiagnostics', []),
  postgresProfilesList: () => httpInvoke('/api/database/postgresProfilesList', []),
  postgresProfileSave: (input) => httpInvoke('/api/database/postgresProfileSave', [input]),
  postgresProfileRemove: (profileId) =>
    httpInvoke('/api/database/postgresProfileRemove', [profileId]),
  postgresProfileTest: (input) => httpInvoke('/api/database/postgresProfileTest', [input]),
  postgresProfileOpen: (profileId) => httpInvoke('/api/database/postgresProfileOpen', [profileId]),
  recentList: () => httpInvoke('/api/database/recentList', []),
  getOverview: () => httpInvoke('/api/database/getOverview', []),
  removeRecent: (path) => httpInvoke('/api/database/removeRecent', [path]),
  deleteFile: (path) => httpInvoke('/api/database/deleteFile', [path]),
  showInFolder: (path) => httpInvoke('/api/database/showInFolder', [path])
})
