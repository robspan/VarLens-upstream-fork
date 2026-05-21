import {
  buildGeneStructureFixtureResponse,
  buildHpoFixtureResponse,
  buildProteinDomainsFixtureResponse,
  buildProteinMappingFixtureResponse,
  buildProteinStructureFixtureResponse,
  buildVepFixtureResponse,
  webParityFixturesEnabled
} from '../api-fixture-responses'
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
    }
  }
}
