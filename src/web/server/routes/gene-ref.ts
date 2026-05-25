import { webParityFixturesEnabled } from '../api-fixture-responses'
import { getWebGeneReferenceDb } from '../web-gene-reference'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildGeneRefOverrides(): Record<string, OverrideHandler> {
  return {
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
    }
  }
}
