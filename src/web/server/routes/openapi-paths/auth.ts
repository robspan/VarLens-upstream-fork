import { z } from 'zod'

import {
  AuthBooleanSchema,
  AuthInvokeBodySchemas,
  AuthOkSchema,
  AuthResultSchema,
  AuthSessionUserSchema,
  AuthSuccessSchema,
  AuthUserSchema
} from '../../../../shared/api/schemas/auth'
import {
  authOperation,
  unsupportedDispatcherMethodOperation,
  type OpenApiPathItem
} from '../openapi-utils'

export function buildAuthOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/auth/login': authOperation({
      summary: 'Authenticate and create a web session',
      body: AuthInvokeBodySchemas.login,
      response: AuthResultSchema,
      public: true
    }),
    '/api/auth/logout': authOperation({
      summary: 'Clear the current web session',
      body: AuthInvokeBodySchemas.logout,
      response: AuthOkSchema
    }),
    '/api/auth/currentUser': authOperation({
      summary: 'Return the authenticated session user',
      body: AuthInvokeBodySchemas.currentUser,
      response: AuthSessionUserSchema.nullable()
    }),
    '/api/auth/isAccountsEnabled': authOperation({
      summary: 'Return whether web accounts are enabled',
      body: AuthInvokeBodySchemas.isAccountsEnabled,
      response: AuthBooleanSchema,
      public: true
    }),
    '/api/auth/createUser': unsupportedDispatcherMethodOperation({
      tag: 'auth',
      summary: 'Disabled for this single-tenant release',
      body: AuthInvokeBodySchemas.createUser
    }),
    '/api/auth/listUsers': authOperation({
      summary: 'List user accounts',
      body: AuthInvokeBodySchemas.listUsers,
      response: z.array(AuthUserSchema)
    }),
    '/api/auth/deactivateUser': authOperation({
      summary: 'Deactivate a user account',
      body: AuthInvokeBodySchemas.deactivateUser
    }),
    '/api/auth/resetPassword': authOperation({
      summary: 'Reset a user password',
      body: AuthInvokeBodySchemas.resetPassword
    }),
    '/api/auth/changePassword': authOperation({
      summary: 'Change the current user password',
      body: AuthInvokeBodySchemas.changePassword,
      response: AuthSuccessSchema
    })
  }
}
