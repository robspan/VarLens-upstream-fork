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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { StorageSession } from '../../main/storage/session'
import type { StorageReadTask } from '../../main/storage/read-executor'
import type { StorageWriteTask } from '../../main/storage/write-executor'
import { PasswordPolicyError, type PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import { isReadTaskType, isWriteTaskType, toTaskDomain } from './task-types'

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

export interface DispatcherDeps {
  session: StorageSession
  authService: PostgresWebAuthService
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
          const { id, username: name, role } = result.user
          // Persist mustChangePassword on the session so the
          // pre-rotation gate (in the dispatcher route handler) can
          // enforce it without re-querying the DB on every request.
          // Cleared by the auth:changePassword override on success.
          request.session.user = { id, username: name, role }
          request.session.mustChangePassword = result.mustChangePassword === true
        }
        return result
      }
    },
    'auth:logout': {
      async handle(_args, request) {
        await request.session.destroy()
        return { ok: true }
      }
    },
    'auth:currentUser': {
      // Session is the source of truth for the cookie's lifetime.
      // Deactivation mid-session is intentionally not handled here —
      // the next /api/auth/login or session expiry resyncs.
      async handle(_args, request) {
        return request.session?.user ?? null
      }
    },
    'auth:isAccountsEnabled': {
      public: true,
      async handle() {
        return true
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

    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
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
