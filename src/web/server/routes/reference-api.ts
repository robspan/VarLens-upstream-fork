import {
  buildGeneStructureFixtureResponse,
  buildHpoFixtureResponse,
  buildProteinDomainsFixtureResponse,
  buildProteinMappingFixtureResponse,
  buildProteinStructureFixtureResponse,
  buildVepFixtureResponse,
  webParityFixturesEnabled
} from '../api-fixture-responses'
import {
  HpoSearchArgsSchema,
  ProteinAccessionArgsSchema,
  ProteinGeneArgsSchema,
  VepFetchArgsSchema
} from '../../../shared/api/schemas/reference'
import { getWebGeneReferenceDb } from '../web-gene-reference'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildReferenceApiOverrides(): Record<string, OverrideHandler> {
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
    },

    'hpo:search': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'hpo.search')
        const parsed = HpoSearchArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('hpo.search query must be a string')
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
    },

    'vep:fetch': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'vep.fetch')
        const parsed = VepFetchArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('Invalid vep.fetch parameters')
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
    },

    'protein:getMapping': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getMapping')
        }
        const parsed = ProteinGeneArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('gene symbol must be a string')
        const [geneSymbol] = parsed.data
        return buildProteinMappingFixtureResponse(geneSymbol)
      }
    },

    'protein:getDomains': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getDomains')
        }
        const parsed = ProteinAccessionArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('UniProt accession must be a string')
        const [accession] = parsed.data
        return buildProteinDomainsFixtureResponse(accession)
      }
    },

    'protein:getStructure': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getStructure')
        }
        const parsed = ProteinAccessionArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('UniProt accession must be a string')
        const [accession] = parsed.data
        return buildProteinStructureFixtureResponse(accession)
      }
    },

    'protein:getGeneStructure': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getGeneStructure')
        }
        const parsed = ProteinGeneArgsSchema.safeParse(args)
        if (!parsed.success) throw new Error('gene symbol must be a string')
        const [geneSymbol] = parsed.data
        return buildGeneStructureFixtureResponse(geneSymbol)
      }
    }
  }
}
