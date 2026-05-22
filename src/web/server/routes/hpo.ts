import { buildHpoFixtureResponse, webParityFixturesEnabled } from '../api-fixture-responses'
import { HpoSearchArgsSchema } from '../../../shared/api/schemas/hpo'
import { badRequest, unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildHpoOverrides(): Record<string, OverrideHandler> {
  return {
    'hpo:search': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'hpo.search')
        const parsed = HpoSearchArgsSchema.safeParse(args)
        if (!parsed.success) {
          return badRequest(reply, 'invalid-hpo-search', 'hpo.search query must be a string')
        }
        const [query, maxResults] = parsed.data
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
    }
  }
}
