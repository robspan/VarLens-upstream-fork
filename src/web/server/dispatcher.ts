/**
 * Single-route HTTP dispatcher for `window.api.<domain>.<method>(...)`.
 *
 * The browser's `window.api` is a Proxy (src/web/client/api.ts) that
 * forwards every call as `POST /api/<domain>/<method>` with body
 * `{ args: [...] }`. This file is the server side: one route resolves
 * the call against three layers, in order:
 *
 *   1. Per-domain OVERRIDES — for methods that don't fit the
 *      executor task model (auth login/logout/whoami, cases:list,
 *      database:capabilities). Override handlers receive `(args, deps)`.
 *   2. Read-task autoroute — if `<domain>:<method>` is one of the
 *      StorageReadTask types, dispatch to `getReadExecutor()`.
 *   3. Write-task autoroute — same for StorageWriteTask.
 *
 * Anything else returns 404. The type sets in task-types.ts are
 * `as const satisfies` against the executor unions, so the
 * autoroute mapping cannot drift silently.
 *
 * Sessions / auth are wired separately as a Fastify preHandler in
 * server/auth.ts; this dispatcher assumes the caller is already
 * authenticated for everything except the few public overrides
 * marked `public: true`.
 */
import { isAbsolute } from 'path'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  startImport,
  startMultiFileImport,
  type VcfImportOptions
} from '../../main/ipc/handlers/import-logic'
import {
  cleanupZipTemp,
  extractZip,
  testZipPassword
} from '../../main/ipc/handlers/batch-import-logic'
import type { StorageSession } from '../../main/storage/session'
import type { StorageReadTask } from '../../main/storage/read-executor'
import type { StorageWriteTask } from '../../main/storage/write-executor'
import { PasswordPolicyError, type PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import type { WebEventHub } from './events'
import { isReadTaskType, isWriteTaskType, toTaskDomain } from './task-types'
import type { SortItem, VariantFilter } from '../../shared/types/database'
import type { MultiFileImportSpec } from '../../shared/types/api'
import {
  CaseIdSchema,
  CohortSearchParamsSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../shared/types/ipc-schemas'

/**
 * Methods reachable to a session that still has
 * must_change_password=TRUE. Everything else returns 403 until the
 * user rotates. This is the load-bearing gate that closes the
 * bootstrap-credential exposure window: even with a valid session
 * cookie, the bootstrap user has zero application-surface access
 * until the new password is committed.
 *
 * `auth:logout` is included so a user who's stuck in the rotation
 * flow can drop their session and start over.
 */
const PRE_ROTATION_ALLOWED = new Set<string>(['auth:changePassword', 'auth:logout'])
const SERVER_PATH_IMPORT_ENV = 'VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT'
const CohortCarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): { id: number; username: string; role: string; passwordChangedAt: string | null } | undefined {
  const user = request.session?.user
  if (user === undefined || user.role !== 'admin') {
    reply.code(403)
    return undefined
  }
  return user
}

export interface DispatcherDeps {
  session: StorageSession
  authService: PostgresWebAuthService
  events: WebEventHub
}

export interface InvokeBody {
  args?: unknown[]
}

export interface OverrideHandler {
  /** True = bypasses the auth preHandler (e.g. login). Default: false. */
  public?: boolean
  /** Receives raw args array + request + deps; returns the value to JSON-encode. */
  handle: (
    args: unknown[],
    request: FastifyRequest,
    reply: FastifyReply,
    deps: DispatcherDeps
  ) => Promise<unknown> | unknown
}

/**
 * Per-method overrides. Key shape: `<kebab-domain>:<method>`.
 *
 * Login binds the session cookie on success; logout clears it; the
 * preHandler reads `request.session.userId` to gate everything else.
 */
function buildOverrides(): Record<string, OverrideHandler> {
  return {
    'auth:login': {
      public: true,
      async handle(args, request, reply, { authService }) {
        const [username, password] = args as [unknown, unknown]
        if (typeof username !== 'string' || typeof password !== 'string') {
          reply.code(400)
          return { error: 'username and password (string) required' }
        }
        const result = await authService.authenticate(username, password)
        if (result.success && result.user !== null) {
          const { id, username: name, role, password_changed_at: passwordChangedAt } = result.user
          // Persist mustChangePassword on the session so the
          // pre-rotation gate (in the dispatcher route handler) can
          // enforce it without re-querying the DB on every request.
          // Cleared by the auth:changePassword override on success.
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
      // Session identity has already been revalidated by the auth preHandler.
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
      // Requires a session — the pre-rotation gate explicitly allows
      // this method through even when the session still carries
      // must_change_password. On success we clear the rotation flag
      // on the session so subsequent requests get the full
      // application surface without needing a re-login.
      async handle(args, request, reply, { authService }) {
        const session = request.session
        const sessionUser = session?.user
        if (sessionUser === undefined) {
          reply.code(401)
          return { error: 'authentication required' }
        }
        const [oldPassword, newPassword] = args as [unknown, unknown]
        if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
          reply.code(400)
          return { error: 'oldPassword and newPassword (string) required' }
        }
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
      async handle(args, request, reply, { authService }) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) return { error: 'admin-required' }

        const [username, displayName, tempPassword] = args
        if (
          typeof username !== 'string' ||
          typeof displayName !== 'string' ||
          typeof tempPassword !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-user-payload' }
        }

        return await authService.createUser(username, displayName, tempPassword, admin.username)
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

        const [username] = args
        if (typeof username !== 'string') {
          reply.code(400)
          return { error: 'invalid-username' }
        }
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

        const [username, newPassword] = args
        if (typeof username !== 'string' || typeof newPassword !== 'string') {
          reply.code(400)
          return { error: 'invalid-reset-payload' }
        }

        await authService.resetPassword(username, newPassword)
        return undefined
      }
    },

    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
      }
    },

    'cohort:getVariants': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-cohort-params', message: 'Invalid cohort search parameters' }
        }

        return await session.getReadExecutor().execute({
          type: 'cohort:query',
          params: [validated.data]
        })
      }
    },

    'cohort:getColumnMeta': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:columnMeta',
          params: []
        })
      }
    },

    'cohort:getSummary': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:summary',
          params: []
        })
      }
    },

    'cohort:getCarriers': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = CohortCarriersParamsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-carrier-params', message: 'Invalid carrier query parameters' }
        }

        return await session.getReadExecutor().execute({
          type: 'cohort:carriers',
          params: [validated.data.chr, validated.data.pos, validated.data.ref, validated.data.alt]
        })
      }
    },

    'cohort:getGeneBurden': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:geneBurden',
          params: []
        })
      }
    },

    'database:capabilities': {
      async handle(_args, _request, _reply, { session }) {
        return session.capabilities
      }
    },

    'database:health': {
      async handle(_args, _request, _reply, { session }) {
        return await session.health()
      }
    },

    'database:info': {
      handle(_args, _request, _reply, { session }) {
        return {
          path: `web:${session.capabilities.backend}`,
          name: 'VarLens Web',
          encrypted: false
        }
      }
    },

    'database:recentList': {
      handle() {
        return []
      }
    },

    'import:start': {
      async handle(args, request, reply, { session, events }) {
        if (process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1') {
          reply.code(403)
          return {
            error: 'server-path-import-disabled',
            message:
              'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
          }
        }

        const [filePath, caseName, vcfOptions] = args
        if (typeof filePath !== 'string' || filePath.trim() === '' || !isAbsolute(filePath)) {
          reply.code(400)
          return { error: 'invalid-file-path', message: 'filePath must be an absolute path' }
        }
        if (typeof caseName !== 'string' || caseName.trim() === '') {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }

        const normalizedOptions: VcfImportOptions | undefined =
          vcfOptions !== null && typeof vcfOptions === 'object'
            ? {
                selectedSample:
                  typeof (vcfOptions as { selectedSample?: unknown }).selectedSample === 'string'
                    ? (vcfOptions as { selectedSample: string }).selectedSample
                    : undefined,
                genomeBuild:
                  typeof (vcfOptions as { genomeBuild?: unknown }).genomeBuild === 'string'
                    ? (vcfOptions as { genomeBuild: string }).genomeBuild
                    : undefined
              }
            : undefined

        return await startImport(filePath, caseName, normalizedOptions, () => session, {
          onProgress: (progress) => {
            const userId = request.session.user?.id
            if (userId !== undefined) {
              events.publish(userId, 'import:progress', progress)
            }
          }
        })
      }
    },

    'import:startMultiFile': {
      async handle(args, request, reply, { session, events }) {
        if (process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1') {
          reply.code(403)
          return {
            error: 'server-path-import-disabled',
            message:
              'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
          }
        }

        const [caseName, files, vcfOptions, filters] = args
        if (typeof caseName !== 'string' || caseName.trim() === '') {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }
        if (!Array.isArray(files) || files.length === 0) {
          reply.code(400)
          return { error: 'invalid-files', message: 'files must be a non-empty array' }
        }

        const normalizedFiles: MultiFileImportSpec[] = []
        for (const file of files) {
          if (file === null || typeof file !== 'object') {
            reply.code(400)
            return { error: 'invalid-file', message: 'Each file must be an object' }
          }
          const raw = file as Record<string, unknown>
          if (typeof raw.filePath !== 'string' || !isAbsolute(raw.filePath)) {
            reply.code(400)
            return { error: 'invalid-file-path', message: 'filePath must be absolute' }
          }
          if (typeof raw.variantType !== 'string' || raw.variantType.trim() === '') {
            reply.code(400)
            return { error: 'invalid-variant-type', message: 'variantType is required' }
          }
          normalizedFiles.push({
            filePath: raw.filePath,
            variantType: raw.variantType,
            caller: typeof raw.caller === 'string' ? raw.caller : null,
            annotationFormat: typeof raw.annotationFormat === 'string' ? raw.annotationFormat : null
          })
        }

        const normalizedOptions: VcfImportOptions | undefined =
          vcfOptions !== null && typeof vcfOptions === 'object'
            ? {
                selectedSample:
                  typeof (vcfOptions as { selectedSample?: unknown }).selectedSample === 'string'
                    ? (vcfOptions as { selectedSample: string }).selectedSample
                    : undefined,
                genomeBuild:
                  typeof (vcfOptions as { genomeBuild?: unknown }).genomeBuild === 'string'
                    ? (vcfOptions as { genomeBuild: string }).genomeBuild
                    : undefined
              }
            : undefined

        const normalizedFilters =
          filters !== null && typeof filters === 'object'
            ? (filters as {
                bedFile?: string | null
                bedPadding?: number
                passOnly?: boolean
                minQual?: number | null
                minGq?: number | null
                minDp?: number | null
              })
            : undefined

        return await startMultiFileImport(
          caseName,
          normalizedFiles,
          normalizedOptions,
          () => session,
          () => {
            throw new Error('SQLite database is not available in web mode')
          },
          {
            onProgress: (progress) => {
              const userId = request.session.user?.id
              if (userId !== undefined) {
                events.publish(userId, 'import:progress', progress)
              }
            }
          },
          undefined,
          normalizedFilters
        )
      }
    },

    'batch-import:extractZip': {
      async handle(args, _request, reply) {
        if (process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1') {
          reply.code(403)
          return {
            error: 'server-path-import-disabled',
            message:
              'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
          }
        }
        const [zipPath, password] = args
        if (typeof zipPath !== 'string' || zipPath.trim() === '' || !isAbsolute(zipPath)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return await extractZip(zipPath, typeof password === 'string' ? password : undefined)
      }
    },

    'batch-import:testZipPassword': {
      handle(args, _request, reply) {
        if (process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1') {
          reply.code(403)
          return {
            error: 'server-path-import-disabled',
            message:
              'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
          }
        }
        const [zipPath, password] = args
        if (typeof zipPath !== 'string' || zipPath.trim() === '' || !isAbsolute(zipPath)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return testZipPassword(zipPath, typeof password === 'string' ? password : '')
      }
    },

    'batch-import:cleanupZipTemp': {
      handle() {
        cleanupZipTemp()
      }
    },

    'variants:query': {
      async handle(args, _request, reply, { session }) {
        const [caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount] = args

        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        const validatedFilters = VariantFilterPartialSchema.safeParse(filters)
        if (!validatedFilters.success) {
          reply.code(400)
          return { error: 'invalid-filters', message: 'Invalid filter parameters' }
        }

        const offsetResult =
          offset === undefined || offset === null ? { data: 0 } : OffsetSchema.safeParse(offset)
        if ('success' in offsetResult && !offsetResult.success) {
          reply.code(400)
          return { error: 'invalid-offset', message: 'Invalid offset parameter' }
        }

        const limitResult =
          limit === undefined || limit === null ? { data: 50 } : LimitSchema.safeParse(limit)
        if ('success' in limitResult && !limitResult.success) {
          reply.code(400)
          return { error: 'invalid-limit', message: 'Invalid limit parameter' }
        }

        let validatedSortBy: SortItem[] | undefined
        if (sortBy !== undefined && sortBy !== null) {
          const sortByResult = z.array(SortItemSchema).safeParse(sortBy)
          if (!sortByResult.success) {
            reply.code(400)
            return { error: 'invalid-sort', message: 'Invalid sort parameters' }
          }
          validatedSortBy = sortByResult.data
        }

        const fullFilter: VariantFilter = {
          case_id: validatedCaseId.data,
          ...validatedFilters.data
        }

        return await session.getReadExecutor().execute({
          type: 'variants:query',
          params: [
            fullFilter,
            limitResult.data,
            offsetResult.data,
            validatedSortBy,
            skipCount === true,
            includeUnfilteredCount === true
          ]
        })
      }
    },

    'variants:getFilterOptions': {
      async handle(args, _request, reply, { session }) {
        const [caseId] = args
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        return await session.getReadExecutor().execute({
          type: 'variants:filterOptions',
          params: [validatedCaseId.data]
        })
      }
    }
  }
}

const PUBLIC_OVERRIDE_KEYS = (overrides: Record<string, OverrideHandler>): Set<string> =>
  new Set(
    Object.entries(overrides)
      .filter(([, v]) => v.public === true)
      .map(([k]) => k)
  )

export function publicOverrideKeys(overrides: Record<string, OverrideHandler>): Set<string> {
  return PUBLIC_OVERRIDE_KEYS(overrides)
}

export function buildDispatcher(_deps: DispatcherDeps): {
  overrides: Record<string, OverrideHandler>
  publicMethods: Set<string>
} {
  const overrides = buildOverrides()
  return { overrides, publicMethods: publicOverrideKeys(overrides) }
}

/**
 * Register the single dispatcher route. All `POST /api/<domain>/<method>`
 * traffic from the browser lands here.
 */
export function registerDispatcher(
  app: FastifyInstance,
  deps: DispatcherDeps,
  overrides: Record<string, OverrideHandler>
): void {
  app.post<{
    Params: { domain: string; method: string }
    Body: InvokeBody
  }>('/api/:domain/:method', async (request, reply) => {
    const { domain, method } = request.params
    const args = (request.body?.args ?? []) as unknown[]

    const taskDomain = toTaskDomain(domain)
    const key = `${taskDomain}:${method}`

    // Pre-rotation gate. A session that still carries
    // must_change_password gets exactly two methods reachable —
    // changePassword (the way out) and logout (the escape hatch).
    // Everything else, including reads, is 403'd. This closes the
    // bootstrap-credential exposure window completely: there is no
    // moment in which a user with the bootstrap password can call
    // any application endpoint.
    if (
      request.session?.user !== undefined &&
      request.session.mustChangePassword === true &&
      !PRE_ROTATION_ALLOWED.has(key)
    ) {
      reply.code(403)
      return {
        error: 'password-rotation-required',
        message:
          'Your password must be changed before any other action. ' +
          'Call auth:changePassword first.'
      }
    }

    const override = overrides[key]
    if (override !== undefined) {
      return await override.handle(args, request, reply, deps)
    }

    if (isReadTaskType(key)) {
      const task = { type: key, params: args } as StorageReadTask
      return await deps.session.getReadExecutor().execute(task)
    }

    if (isWriteTaskType(key)) {
      const task = { type: key, params: args } as StorageWriteTask
      return await deps.session.getWriteExecutor().execute(task)
    }

    reply.code(404)
    return { error: 'unknown method', domain, method }
  })
}
