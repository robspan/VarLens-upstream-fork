import type { FastifyReply, FastifyRequest } from 'fastify'

import {
  ChangePasswordArgsSchema,
  CreateUserArgsSchema,
  LoginArgsSchema,
  ResetPasswordArgsSchema,
  UsernameArgsSchema
} from '../../../shared/api/schemas/auth'
import { PasswordPolicyError } from '../../auth/PostgresWebAuthService'
import type { OverrideHandler } from './types'

function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): { username: string } | undefined {
  const user = request.session?.user
  if (user?.role !== 'admin') {
    reply.code(403)
    return undefined
  }
  return { username: user.username }
}

export function buildAuthOverrides(): Record<string, OverrideHandler> {
  return {
    'auth:login': {
      public: true,
      async handle(args, request, reply, { authService }) {
        const parsed = LoginArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'username and password (string) required' }
        }
        const [username, password] = parsed.data
        const result = await authService.authenticate(username, password)
        if (result.success && result.user !== null) {
          const { id, username: name, role, password_changed_at: passwordChangedAt } = result.user
          request.session.user = { id, username: name, role, passwordChangedAt }
          request.session.mustChangePassword = result.mustChangePassword === true
        }
        return result
      }
    },
    'auth:logout': {
      async handle(_args, request) {
        request.session.delete()
        return { ok: true }
      }
    },
    'auth:currentUser': {
      async handle(_args, request) {
        return request.session?.user ?? null
      }
    },
    'auth:isAccountsEnabled': {
      public: true,
      async handle(_args, _request, _reply, { authService }) {
        return await authService.isAccountsEnabled()
      }
    },
    'auth:changePassword': {
      async handle(args, request, reply, { authService }) {
        const session = request.session
        const sessionUser = session?.user
        if (sessionUser === undefined) {
          reply.code(401)
          return { error: 'authentication required' }
        }

        const parsed = ChangePasswordArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'oldPassword and newPassword (string) required' }
        }
        const [oldPassword, newPassword] = parsed.data

        try {
          const ok = await authService.changePassword(
            sessionUser.username,
            oldPassword,
            newPassword
          )
          if (!ok) {
            reply.code(401)
            return { success: false, error: 'old-password-invalid' }
          }
          const refreshed = await authService.getUser(sessionUser.username)
          if (refreshed !== undefined) {
            session.user = {
              id: refreshed.id,
              username: refreshed.username,
              role: refreshed.role,
              passwordChangedAt: refreshed.password_changed_at
            }
          }
          session.mustChangePassword = false
          return { success: true }
        } catch (err) {
          if (err instanceof PasswordPolicyError) {
            reply.code(422)
            return { success: false, error: err.code, message: err.message }
          }
          throw err
        }
      }
    },
    'auth:createUser': {
      async handle(args, request, reply) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }

        const parsed = CreateUserArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-user-payload' }
        }
        const [_username, _displayName, _tempPassword] = parsed.data

        reply.code(501)
        return {
          error: 'multi-user-disabled',
          message:
            'Creating additional web users is disabled until clinical tables are scoped by user_id.'
        }
      }
    },
    'auth:listUsers': {
      async handle(_args, request, reply, { authService }) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }
        return await authService.listUsers()
      }
    },
    'auth:deactivateUser': {
      async handle(args, request, reply, { authService }) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }

        const parsed = UsernameArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-username' }
        }
        const [username] = parsed.data
        if (username === admin.username) {
          reply.code(400)
          return { error: 'cannot-deactivate-self' }
        }

        await authService.deactivateUser(username)
        return undefined
      }
    },
    'auth:resetPassword': {
      async handle(args, request, reply, { authService }) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }

        const parsed = ResetPasswordArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-reset-payload' }
        }
        const [username, newPassword] = parsed.data

        await authService.resetPassword(username, newPassword)
        return undefined
      }
    }
  }
}
