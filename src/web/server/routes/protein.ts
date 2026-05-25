import {
  buildGeneStructureFixtureResponse,
  buildProteinDomainsFixtureResponse,
  buildProteinMappingFixtureResponse,
  buildProteinStructureFixtureResponse,
  webParityFixturesEnabled
} from '../api-fixture-responses'
import {
  ProteinAccessionArgsSchema,
  ProteinGeneArgsSchema
} from '../../../shared/api/schemas/protein'
import { badRequest, unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildProteinOverrides(): Record<string, OverrideHandler> {
  return {
    'protein:getMapping': {
      handle(args, _request, reply) {
        if (!webParityFixturesEnabled()) {
          return unsupportedWebCapability(reply, 'protein.getMapping')
        }
        const parsed = ProteinGeneArgsSchema.safeParse(args)
        if (!parsed.success) {
          return badRequest(reply, 'invalid-protein-gene', 'gene symbol must be a string')
        }
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
        if (!parsed.success) {
          return badRequest(
            reply,
            'invalid-protein-accession',
            'UniProt accession must be a string'
          )
        }
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
        if (!parsed.success) {
          return badRequest(
            reply,
            'invalid-protein-accession',
            'UniProt accession must be a string'
          )
        }
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
        if (!parsed.success) {
          return badRequest(reply, 'invalid-protein-gene', 'gene symbol must be a string')
        }
        const [geneSymbol] = parsed.data
        return buildGeneStructureFixtureResponse(geneSymbol)
      }
    }
  }
}
