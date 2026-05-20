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
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

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
import type { AuditAppendParams } from '../../main/storage/audit-log-types'
import { PasswordPolicyError, type PostgresWebAuthService } from '../auth/PostgresWebAuthService'
import type { WebEventHub } from './events'
import { isReadTaskType, isWriteTaskType, toTaskDomain } from './task-types'
import type { SortItem, VariantFilter } from '../../shared/types/database'
import type { MultiFileImportSpec } from '../../shared/types/api'
import type { StorageCapabilities } from '../../shared/types/storage-capabilities'
import type { TranscriptInsertRow } from '../../shared/types/transcript'
import {
  CaseIdSchema,
  CohortSearchParamsSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../shared/types/ipc-schemas'
import { exportPostgresCohort, exportPostgresVariants } from '../../main/ipc/handlers/export-logic'
import { quoteIdentifier } from '../../main/storage/postgres/identifiers'
import type { Pool } from 'pg'
import {
  buildGeneStructureFixtureResponse,
  buildHpoFixtureResponse,
  buildProteinDomainsFixtureResponse,
  buildProteinMappingFixtureResponse,
  buildProteinStructureFixtureResponse,
  buildVepFixtureResponse,
  webParityFixturesEnabled
} from './api-fixture-responses'
import { getWebGeneReferenceDb } from './web-gene-reference'

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
const DEV_API_LATENCY_ENV = 'VARLENS_WEB_API_LATENCY_MS'
const CohortCarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

function webCapabilities(base: StorageCapabilities): StorageCapabilities {
  if (webParityFixturesEnabled()) return base
  return {
    ...base,
    export: {
      variants: false,
      cohort: false,
      streaming: false
    }
  }
}

function unsupportedWebCapability(
  reply: FastifyReply,
  capability: string
): {
  error: string
  capability: string
  message: string
} {
  reply.code(501)
  return {
    error: 'unsupported-web-capability',
    capability,
    message: `${capability} is not available in web mode yet.`
  }
}

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

function postgresContext(session: StorageSession): { pool: Pool; schemaName: string } {
  if (session.workspace.kind !== 'postgres') {
    throw new Error('Postgres storage session is required for web IPC parity route')
  }
  const maybePool = (session as { getPool?: () => Pool }).getPool
  if (maybePool === undefined) {
    throw new Error('Postgres storage session does not expose a pg pool')
  }
  return {
    pool: maybePool.call(session),
    schemaName: quoteIdentifier(session.workspace.schema)
  }
}

export function resolveDevApiLatencyMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.NODE_ENV !== 'development') return 0

  const raw = env[DEV_API_LATENCY_ENV]
  if (raw === undefined || raw.trim() === '') return 0

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 5000) {
    throw new Error(`${DEV_API_LATENCY_ENV} must be an integer between 0 and 5000; got ${raw}`)
  }
  return value
}

async function applyDevApiLatency(): Promise<void> {
  const delayMs = resolveDevApiLatencyMs()
  if (delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

function normalizeBedLine(
  line: string
): { chr: string; start: number; end: number; label?: string } | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const [chr, startRaw, endRaw, label] = trimmed.split(/\s+/u)
  const start = Number(startRaw)
  const end = Number(endRaw)
  if (chr === undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`Invalid BED row: ${line}`)
  }
  return {
    chr,
    start,
    end,
    ...(label !== undefined && label !== '' ? { label } : {})
  }
}

function globalAuditEntries(
  coords: { chr: string; pos: number; ref: string; alt: string },
  updates: Record<string, unknown>,
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  const entityKey = `${coords.chr}:${coords.pos}:${coords.ref}:${coords.alt}`
  const entries: AuditAppendParams[] = []
  if (updates.acmg_classification !== undefined) {
    entries.push({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification }),
      new_value: JSON.stringify({ acmg_classification: updates.acmg_classification }),
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
    })
  }
  if (updates.acmg_evidence !== undefined) {
    entries.push({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence }),
      new_value: JSON.stringify({ acmg_evidence: updates.acmg_evidence }),
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
    })
  }
  if (updates.starred !== undefined) {
    entries.push({
      action_type: updates.starred === true ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation === null ? null : JSON.stringify({ starred: oldAnnotation.starred }),
      new_value: JSON.stringify({ starred: updates.starred === true ? 1 : 0 }),
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
    })
  }
  return entries
}

function perCaseAuditEntries(
  caseId: number,
  variantId: number,
  updates: Record<string, unknown>,
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  return globalAuditEntries(
    { chr: 'case', pos: caseId, ref: 'variant', alt: String(variantId) },
    updates,
    oldAnnotation
  ).map((entry) => ({
    ...entry,
    entity_type: 'case_variant_annotation',
    entity_key: `case:${caseId}:variant:${variantId}`
  }))
}

async function appendAuditEntries(
  session: StorageSession,
  entries: AuditAppendParams[]
): Promise<void> {
  for (const entry of entries) {
    await session.getWriteExecutor().execute({ type: 'audit:append', params: [entry] })
  }
}

async function readBedEntries(
  filePath: string
): Promise<Array<{ chr: string; start: number; end: number; label?: string }>> {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/u)
    .map(normalizeBedLine)
    .filter(
      (entry): entry is { chr: string; start: number; end: number; label?: string } =>
        entry !== null
    )
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

    'cohort:getSummaryStatus': {
      handle() {
        return { is_stale: false, last_rebuilt_at: 0 }
      }
    },

    'cohort:rebuildSummary': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.rebuildSummary')
      }
    },

    'cohort:runAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.runAssociation')
      }
    },

    'cohort:cancelAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.cancelAssociation')
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
        return webCapabilities(session.capabilities)
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

    'database:getOverview': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'database:overview',
          params: []
        })
      }
    },

    'database:recentList': {
      handle() {
        return []
      }
    },

    'export:variants': {
      async handle(args, _request, reply, { session }) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'export.variants')
        const [caseId, filters, caseName] = args
        const validated = z
          .object({
            caseId: CaseIdSchema,
            filters: VariantFilterPartialSchema,
            caseName: z.string().min(1).max(500)
          })
          .safeParse({ caseId, filters, caseName })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-export-variants-params' }
        }

        const rows = (await session.getReadExecutor().execute({
          type: 'export:variants',
          params: [{ ...validated.data.filters, case_id: validated.data.caseId }]
        })) as AsyncIterable<Record<string, unknown>>
        const filePath = join(
          tmpdir(),
          `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_web_${randomUUID()}.csv`
        )
        return await exportPostgresVariants(rows, filePath, {})
      }
    },

    'export:cohort': {
      async handle(args, _request, reply, { session }) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'export.cohort')
        const [params] = args
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-export-cohort-params' }
        }

        const rows = (await session.getReadExecutor().execute({
          type: 'export:cohort',
          params: [validated.data]
        })) as AsyncIterable<Record<string, unknown>>
        const filePath = join(tmpdir(), `cohort_variants_web_${randomUUID()}.csv`)
        return await exportPostgresCohort(rows, filePath, {})
      }
    },

    'gene-ref:info': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'geneRef.info')
        return getWebGeneReferenceDb().getInfo()
      }
    },

    'gene-ref:assemblies': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'geneRef.assemblies')
        }
        return getWebGeneReferenceDb().getAssemblies()
      }
    },

    'hpo:search': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'hpo.search')
        const [query, maxResults] = args
        if (typeof query !== 'string') throw new Error('hpo.search query must be a string')
        return buildHpoFixtureResponse(
          query,
          typeof maxResults === 'number' ? maxResults : undefined
        )
      }
    },

    'hpo:clearCache': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'hpo.clearCache')
        return { success: true }
      }
    },

    'vep:fetch': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.fetch')
        const [chr, pos, ref, alt] = args
        if (
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string'
        ) {
          throw new Error('Invalid vep.fetch parameters')
        }
        return buildVepFixtureResponse(chr, pos, ref, alt)
      }
    },

    'vep:getCacheStats': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.getCacheStats')
        return { vepCount: 0, hpoCount: 0, totalBytes: 0 }
      }
    },

    'vep:clearCache': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.clearCache')
        return { success: true }
      }
    },

    'vep:cancel': {
      handle(_args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.cancel')
        return { success: true }
      }
    },

    'protein:getMapping': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getMapping')
        }
        const [geneSymbol] = args
        if (typeof geneSymbol !== 'string') throw new Error('gene symbol must be a string')
        return buildProteinMappingFixtureResponse(geneSymbol)
      }
    },

    'protein:getDomains': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getDomains')
        }
        const [accession] = args
        if (typeof accession !== 'string') throw new Error('UniProt accession must be a string')
        return buildProteinDomainsFixtureResponse(accession)
      }
    },

    'protein:getStructure': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getStructure')
        }
        const [accession] = args
        if (typeof accession !== 'string') throw new Error('UniProt accession must be a string')
        return buildProteinStructureFixtureResponse(accession)
      }
    },

    'protein:getGeneStructure': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getGeneStructure')
        }
        const [geneSymbol] = args
        if (typeof geneSymbol !== 'string') throw new Error('gene symbol must be a string')
        return buildGeneStructureFixtureResponse(geneSymbol)
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

    'case-metadata:createCohort': {
      async handle(args, _request, reply, { session }) {
        const [name, description] = args
        if (typeof name !== 'string') {
          reply.code(400)
          return { error: 'invalid-cohort-name' }
        }
        return await session.getWriteExecutor().execute({
          type: 'case-metadata:createCohort',
          params: [{ name, description: typeof description === 'string' ? description : null }]
        })
      }
    },

    'analysis-groups:create': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        if (params === null || typeof params !== 'object') {
          reply.code(400)
          return { error: 'invalid-analysis-group' }
        }
        const raw = params as { name?: unknown; groupType?: unknown; description?: unknown }
        if (typeof raw.name !== 'string') {
          reply.code(400)
          return { error: 'invalid-analysis-group-name' }
        }
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:create',
          params: [
            raw.name,
            raw.groupType === 'tumor_normal' ? raw.groupType : 'family',
            typeof raw.description === 'string' ? raw.description : undefined
          ]
        })
      }
    },

    'analysis-groups:addMember': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        if (params === null || typeof params !== 'object') {
          reply.code(400)
          return { error: 'invalid-analysis-group-member' }
        }
        const raw = params as {
          groupId?: unknown
          caseId?: unknown
          role?: unknown
          affectedStatus?: unknown
          individualId?: unknown
        }
        if (
          typeof raw.groupId !== 'number' ||
          typeof raw.caseId !== 'number' ||
          typeof raw.role !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-analysis-group-member' }
        }
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:addMember',
          params: [
            raw.groupId,
            raw.caseId,
            raw.role as never,
            typeof raw.affectedStatus === 'string' ? (raw.affectedStatus as never) : undefined,
            typeof raw.individualId === 'string' ? raw.individualId : undefined
          ]
        })
      }
    },

    'annotations:getGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        if (
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-coordinates' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [{ chr, pos, ref, alt }]
        })
      }
    },

    'annotations:upsertGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt, updates] = args
        if (
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string' ||
          updates === null ||
          typeof updates !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-upsert' }
        }
        const coords = { chr, pos, ref, alt }
        const oldAnnotation = (await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [coords]
        })) as Record<string, unknown> | null
        const result = await session.getWriteExecutor().execute({
          type: 'annotations:upsertGlobal',
          params: [coords, updates as never]
        })
        await appendAuditEntries(
          session,
          globalAuditEntries(coords, updates as Record<string, unknown>, oldAnnotation)
        )
        return result
      }
    },

    'annotations:upsertPerCase': {
      async handle(args, _request, reply, { session }) {
        const [caseId, variantId, updates] = args
        if (
          typeof caseId !== 'number' ||
          typeof variantId !== 'number' ||
          updates === null ||
          typeof updates !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-per-case-annotation-upsert' }
        }
        const oldAnnotation = (await session.getReadExecutor().execute({
          type: 'annotations:getPerCase',
          params: [caseId, variantId]
        })) as Record<string, unknown> | null
        const result = await session.getWriteExecutor().execute({
          type: 'annotations:upsertPerCase',
          params: [caseId, variantId, updates as never]
        })
        await appendAuditEntries(
          session,
          perCaseAuditEntries(caseId, variantId, updates as Record<string, unknown>, oldAnnotation)
        )
        return result
      }
    },

    'annotations:getForVariant': {
      async handle(args, _request, reply, { session }) {
        const [caseId, chr, pos, ref, alt] = args
        if (
          typeof caseId !== 'number' ||
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-query' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getForVariant',
          params: [caseId, { chr, pos, ref, alt }]
        })
      }
    },

    'region-files:importBed': {
      async handle(args, _request, reply, { session }) {
        const [fileId, filePath] = args
        if (typeof fileId !== 'number' || typeof filePath !== 'string' || !isAbsolute(filePath)) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        return await session.getWriteExecutor().execute({
          type: 'region-files:importBed',
          params: [fileId, await readBedEntries(filePath)]
        })
      }
    },

    'gene-lists:setGenes': {
      async handle(args, _request, reply, { session }) {
        const [listId, genes] = args
        if (
          typeof listId !== 'number' ||
          !Array.isArray(genes) ||
          !genes.every((gene) => typeof gene === 'string')
        ) {
          reply.code(400)
          return { error: 'invalid-gene-list-genes' }
        }
        await session.getWriteExecutor().execute({
          type: 'gene-lists:setGenes',
          params: [listId, genes]
        })
        return await session.getReadExecutor().execute({
          type: 'gene-lists:getGenes',
          params: [listId]
        })
      }
    },

    'variants:search': {
      async handle(args, _request, reply, { session }) {
        const [caseId, query, limit] = args
        if (typeof caseId !== 'number' || typeof query !== 'string') {
          reply.code(400)
          return { error: 'invalid-variant-search' }
        }
        return await session.getReadExecutor().execute({
          type: 'variants:query',
          params: [
            { case_id: caseId, gene_symbol: query },
            typeof limit === 'number' ? limit : 20,
            0,
            undefined,
            true,
            false
          ]
        })
      }
    },

    'variants:columnMeta': {
      async handle(args, _request, reply, { session }) {
        const [payload] = args
        if (payload === null || typeof payload !== 'object') {
          reply.code(400)
          return { error: 'invalid-column-meta-payload' }
        }
        const value = payload as { caseId?: unknown; caseIds?: unknown; columnKey?: unknown }
        if (
          typeof value.columnKey !== 'string' ||
          (typeof value.caseId !== 'number' &&
            (!Array.isArray(value.caseIds) ||
              !value.caseIds.every((caseId) => typeof caseId === 'number')))
        ) {
          reply.code(400)
          return { error: 'invalid-column-meta-payload' }
        }
        const scope =
          typeof value.caseId === 'number'
            ? { caseId: value.caseId }
            : { caseIds: value.caseIds as number[] }
        return await session.getReadExecutor().execute({
          type: 'variants:columnMeta',
          params: [scope, value.columnKey]
        })
      }
    },

    'transcripts:list': {
      async handle(args, _request, reply, { session }) {
        const [variantId] = args
        if (typeof variantId !== 'number') {
          reply.code(400)
          return { error: 'invalid-transcript-variant-id' }
        }
        const { pool, schemaName } = postgresContext(session)
        const result = await pool.query(
          `SELECT id, variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change,
                  hpo_sim_score, moi, is_selected, is_mane_select, is_canonical
             FROM ${schemaName}.variant_transcripts
            WHERE variant_id = $1
            ORDER BY is_selected DESC, transcript_id ASC`,
          [variantId]
        )
        return result.rows
      }
    },

    'transcripts:insertAndSwitch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcript] = args
        if (
          typeof variantId !== 'number' ||
          transcript === null ||
          typeof transcript !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-transcript-insert' }
        }
        const row = transcript as TranscriptInsertRow
        const { pool, schemaName } = postgresContext(session)
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query(
            `UPDATE ${schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
            [variantId]
          )
          await client.query(
            `INSERT INTO ${schemaName}.variant_transcripts
               (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change,
                hpo_sim_score, moi, is_selected, is_mane_select, is_canonical)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NULL, NULL)
             ON CONFLICT (variant_id, transcript_id)
             DO UPDATE SET
               gene_symbol = EXCLUDED.gene_symbol,
               consequence = EXCLUDED.consequence,
               cdna = EXCLUDED.cdna,
               aa_change = EXCLUDED.aa_change,
               hpo_sim_score = EXCLUDED.hpo_sim_score,
               moi = EXCLUDED.moi,
               is_selected = 1`,
            [
              variantId,
              row.transcript_id,
              row.gene_symbol,
              row.consequence,
              row.cdna,
              row.aa_change,
              row.hpo_sim_score,
              row.moi
            ]
          )
          await client.query('COMMIT')
          return { success: true }
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
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
    await applyDevApiLatency()

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
