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
import type { StorageReadTask, StorageReadExecutor } from '../../main/storage/read-executor'
import type { StorageWriteTask, StorageWriteExecutor } from '../../main/storage/write-executor'
import type { PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import {
  NON_TUPLE_PARAM_TASKS,
  READ_TASK_TYPE_SET,
  WRITE_TASK_TYPE_SET,
  toTaskDomain
} from './task-types'

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
        if (result.success && result.user !== null && result.user !== undefined) {
          const u = result.user as { id: number; username: string; role: string }
          request.session.user = { id: u.id, username: u.username, role: u.role }
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

    const override = overrides[key]
    if (override !== undefined) {
      return await override.handle(args, request, reply, deps)
    }

    if (READ_TASK_TYPE_SET.has(key)) {
      const params = NON_TUPLE_PARAM_TASKS.has(key) ? args[0] : args
      const task = { type: key, params } as unknown as StorageReadTask
      return await (deps.session.getReadExecutor() as StorageReadExecutor).execute(task)
    }

    if (WRITE_TASK_TYPE_SET.has(key)) {
      const params = NON_TUPLE_PARAM_TASKS.has(key) ? args[0] : args
      const task = { type: key, params } as unknown as StorageWriteTask
      return await (deps.session.getWriteExecutor() as StorageWriteExecutor).execute(task)
    }

    reply.code(404)
    return { error: 'unknown method', domain, method }
  })
}
