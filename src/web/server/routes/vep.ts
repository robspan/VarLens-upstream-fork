import { buildVepFixtureResponse, webParityFixturesEnabled } from '../api-fixture-responses'
import { VepFetchArgsSchema } from '../../../shared/api/schemas/vep'
import { badRequest, unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildVepOverrides(): Record<string, OverrideHandler> {
  return {
    'vep:fetch': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.fetch')
        const parsed = VepFetchArgsSchema.safeParse(args)
        if (!parsed.success) {
          return badRequest(reply, 'invalid-vep-fetch', 'Invalid vep.fetch parameters')
        }
        const [chr, pos, ref, alt] = parsed.data
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
    }
  }
}
