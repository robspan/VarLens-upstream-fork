import type { IpcResult } from '../../types/errors'

export interface AuthDomainContract {
  login: (
    username: string,
    password: string
  ) => Promise<{
    success: boolean
    user?: { id: number; username: string; role: string }
    mustChangePassword?: boolean
    locked?: boolean
  }>
  logout: () => Promise<void>
  currentUser: () => Promise<IpcResult<{ id: number; username: string; role: string } | null>>
  isAccountsEnabled: () => Promise<IpcResult<boolean>>
  createUser: (
    username: string,
    displayName: string,
    tempPassword: string
  ) => Promise<IpcResult<void>>
  listUsers: () => Promise<
    IpcResult<
      Array<{
        id: number
        username: string
        display_name: string | null
        role: string
        is_active: number
        must_change_password: number
        failed_login_count: number
        created_at: string
      }>
    >
  >
  deactivateUser: (username: string) => Promise<IpcResult<void>>
  resetPassword: (username: string, newPassword: string) => Promise<IpcResult<void>>
  changePassword: (oldPassword: string, newPassword: string) => Promise<IpcResult<void>>
}
