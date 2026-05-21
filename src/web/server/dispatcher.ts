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
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import type { StorageSession } from '../../main/storage/session'
import type { StorageReadTask } from '../../main/storage/read-executor'
import type { StorageWriteTask } from '../../main/storage/write-executor'
import { isReadTaskType, isWriteTaskType, toTaskDomain } from './task-types'
import { buildAnnotationOverrides } from './routes/annotations'
import { buildAssetOverrides } from './routes/assets'
import { buildAuthOverrides } from './routes/auth'
import { buildCasesOverrides } from './routes/cases'
import { buildCohortOverrides } from './routes/cohort'
import { unsupportedWebCapability } from './routes/common'
import { buildDatabaseOverrides } from './routes/database'
import { buildImportOverrides } from './routes/import'
import { buildReferenceApiOverrides } from './routes/reference-api'
import type { DispatcherDeps, InvokeBody, OverrideHandler } from './routes/types'
import type { SortItem, VariantFilter } from '../../shared/types/database'
import type { TranscriptInsertRow } from '../../shared/types/transcript'
import {
  CaseIdSchema,
  CohortSearchParamsSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../shared/types/ipc-schemas'
import {
  DispatcherErrorResponseSchema,
  DispatcherInvokeBodySchema,
  DispatcherParamsSchema
} from '../../shared/api/schemas/dispatcher'
import { exportPostgresCohort, exportPostgresVariants } from '../../main/ipc/handlers/export-logic'
import { quoteIdentifier } from '../../main/storage/postgres/identifiers'
import type { Pool } from 'pg'
import { webParityFixturesEnabled } from './api-fixture-responses'

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
const DEV_API_LATENCY_ENV = 'VARLENS_WEB_API_LATENCY_MS'
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

export type { DispatcherDeps, InvokeBody, OverrideHandler } from './routes/types'

/**
 * Per-method overrides. Key shape: `<kebab-domain>:<method>`.
 *
 * Login binds the session cookie on success; logout clears it; the
 * preHandler reads `request.session.userId` to gate everything else.
 */
function buildOverrides(): Record<string, OverrideHandler> {
  return {
    ...buildAuthOverrides(),
    ...buildAnnotationOverrides(),
    ...buildAssetOverrides(),
    ...buildCasesOverrides(),
    ...buildCohortOverrides(),
    ...buildDatabaseOverrides(),
    ...buildImportOverrides(),
    ...buildReferenceApiOverrides(),

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
  app.withTypeProvider<ZodTypeProvider>().post<{
    Params: { domain: string; method: string }
    Body: InvokeBody
  }>(
    '/api/:domain/:method',
    {
      schema: {
        tags: ['web-dispatcher'],
        summary: 'Invoke a VarLens API method',
        description:
          'Compatibility endpoint used by the web SPA. The wire contract mirrors the ' +
          'desktop preload API: POST /api/<domain>/<method> with body { args: [...] }.',
        params: DispatcherParamsSchema,
        body: DispatcherInvokeBodySchema,
        response: {
          400: DispatcherErrorResponseSchema,
          401: DispatcherErrorResponseSchema,
          403: DispatcherErrorResponseSchema,
          404: DispatcherErrorResponseSchema,
          501: DispatcherErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
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
    }
  )
}
