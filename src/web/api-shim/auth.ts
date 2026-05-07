import type { AuthDomainContract } from '../../shared/ipc/domains/auth'
import { httpInvoke } from './http-invoke'

export const createAuthApi = (): AuthDomainContract => ({
  login: (username, password) => httpInvoke('/api/auth/login', [username, password]),
  logout: () => httpInvoke('/api/auth/logout', []),
  currentUser: () => httpInvoke('/api/auth/currentUser', []),
  isAccountsEnabled: () => httpInvoke('/api/auth/isAccountsEnabled', []),
  createUser: (username, displayName, tempPassword) =>
    httpInvoke('/api/auth/createUser', [username, displayName, tempPassword]),
  listUsers: () => httpInvoke('/api/auth/listUsers', []),
  deactivateUser: (username) => httpInvoke('/api/auth/deactivateUser', [username]),
  resetPassword: (username, newPassword) =>
    httpInvoke('/api/auth/resetPassword', [username, newPassword]),
  changePassword: (oldPassword, newPassword) =>
    httpInvoke('/api/auth/changePassword', [oldPassword, newPassword])
})
