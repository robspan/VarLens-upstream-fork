import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  AlphaFoldResponseSchema,
  EnsemblGeneLookupSchema,
  InterProResponseSchema,
  UniProtResponseSchema
} from '../../main/services/api/schemas/protein-response'
import { HpoAutocompleteResponseSchema } from '../../main/services/api/schemas/hpo-response'
import { normalizeChromosome } from '../../main/services/api/VepApiClient'
import {
  VepResponseSchema,
  type VepResponse,
  type VepTranscriptConsequence
} from '../../main/services/api/schemas/vep-response'
import type {
  GeneStructureResult,
  ProteinDomain,
  ProteinDomainResult,
  ProteinMappingResult,
  ProteinStructureInfo,
  ProteinStructureResult
} from '../../shared/types/protein'
import type { HpoSearchResult, VepFetchResult } from '../../shared/types/api-enrichment'

const API_FIXTURE_DIR_ENV = 'VARLENS_API_FIXTURES_DIR'
const WEB_PARITY_FIXTURE_ENV = 'VARLENS_WEB_PARITY_FIXTURES'

export function webParityFixturesEnabled(): boolean {
  const root = process.env[API_FIXTURE_DIR_ENV]
  return process.env[WEB_PARITY_FIXTURE_ENV] === '1' && root !== undefined && root.trim() !== ''
}

function readFixture(path: string): unknown {
  if (!webParityFixturesEnabled()) {
    throw new Error(`${WEB_PARITY_FIXTURE_ENV}=1 is required for web reference API parity`)
  }
  const root = process.env[API_FIXTURE_DIR_ENV]
  if (root === undefined || root.trim() === '') {
    throw new Error(`${API_FIXTURE_DIR_ENV} is required for web reference API parity`)
  }
  const rootPath = resolve(root)
  const fixturePath = resolve(rootPath, path)
  const pathFromRoot = relative(rootPath, fixturePath)
  if (
    pathFromRoot === '' ||
    pathFromRoot.startsWith('..') ||
    isAbsolute(pathFromRoot) ||
    path.includes('\0')
  ) {
    throw new Error('Web API fixture path escapes fixture root')
  }
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
}

export function buildHpoFixtureResponse(query: string, maxResults = 20): HpoSearchResult {
  const data = HpoAutocompleteResponseSchema.parse(
    readFixture(`hpo/search-${query.toLowerCase().trim()}.json`)
  )
  return {
    success: true,
    terms: data[3].slice(0, maxResults).map(([id, name]) => ({ id, name }))
  }
}

export function buildVepFixtureResponse(
  chr: string,
  pos: number,
  ref: string,
  alt: string
): VepFetchResult {
  const normalizedChr = normalizeChromosome(chr)
  const data = VepResponseSchema.parse(
    readFixture(
      `vep/chr${normalizedChr.toLowerCase()}-${pos}-${ref.toLowerCase()}-${alt.toLowerCase()}.json`
    )
  )
  return {
    success: true,
    data,
    cacheInfo: {
      cached: false,
      cachedAt: null
    },
    preferredTranscript: selectPreferredTranscript(data),
    allTranscripts: data[0]?.transcript_consequences ?? []
  }
}

export function buildProteinMappingFixtureResponse(geneSymbol: string): ProteinMappingResult {
  const raw = UniProtResponseSchema.parse(readFixture(`uniprot/${geneSymbol.toLowerCase()}.json`))
  const result = raw.results[0]
  if (result === undefined) {
    throw new Error(`No UniProt fixture result for ${geneSymbol}`)
  }
  return {
    success: true,
    mapping: {
      uniprotAccession: result.primaryAccession,
      geneName: result.genes?.[0]?.geneName?.value ?? geneSymbol,
      proteinName: result.proteinDescription?.recommendedName?.fullName?.value ?? '',
      proteinLength: result.sequence.length
    },
    cacheInfo: {
      cached: false
    }
  }
}

export function buildProteinDomainsFixtureResponse(accession: string): ProteinDomainResult {
  const normalizedAccession = accession.toUpperCase()
  const raw = InterProResponseSchema.parse(readFixture(`interpro/${accession.toLowerCase()}.json`))
  const { domains, proteinLength } = extractDomains(raw.results, normalizedAccession)
  return {
    success: true,
    domains,
    proteinLength,
    cacheInfo: {
      cached: false,
      cachedAt: undefined
    }
  }
}

export function buildProteinStructureFixtureResponse(accession: string): ProteinStructureResult {
  const raw = AlphaFoldResponseSchema.parse(
    readFixture(`alphafold/${accession.toLowerCase()}.json`)
  )
  return {
    success: true,
    structure: buildStructureInfo(accession, raw),
    cacheInfo: {
      cached: false
    }
  }
}

export function buildGeneStructureFixtureResponse(geneSymbol: string): GeneStructureResult {
  const raw = EnsemblGeneLookupSchema.parse(
    readFixture(`ensembl/${geneSymbol.toLowerCase()}-gene-structure.json`)
  )
  const transcripts = raw.Transcript ?? []
  const selected =
    transcripts.find(
      (transcript) =>
        transcript.is_canonical === 1 && transcript.Exon !== undefined && transcript.Exon.length > 0
    ) ??
    transcripts.find((transcript) => transcript.Exon !== undefined && transcript.Exon.length > 0)

  if (!selected || !selected.Exon || selected.Exon.length === 0) {
    throw new Error(`No exon-bearing Ensembl fixture transcript for ${geneSymbol}`)
  }

  return {
    success: true,
    geneStructure: {
      geneSymbol,
      chromosome: raw.seq_region_name,
      start: raw.start,
      end: raw.end,
      strand: raw.strand === -1 ? -1 : 1,
      transcriptId: selected.display_name ?? selected.id,
      exons: selected.Exon.map((exon) => ({ start: exon.start, end: exon.end }))
        .sort((a, b) => a.start - b.start)
        .map((exon, index) => ({
          start: exon.start,
          end: exon.end,
          rank: raw.strand === -1 ? selected.Exon!.length - index : index + 1
        }))
    },
    cacheInfo: { cached: false }
  }
}

function selectPreferredTranscript(data: VepResponse): VepTranscriptConsequence | null {
  const transcripts = data[0]?.transcript_consequences
  if (!transcripts || transcripts.length === 0) return null
  return (
    transcripts.find((transcript) => transcript.mane_select !== undefined) ??
    transcripts.find((transcript) => transcript.canonical === 1) ??
    transcripts[0]
  )
}

function extractDomains(
  results: ReturnType<typeof InterProResponseSchema.parse>['results'],
  accession: string
): { domains: ProteinDomain[]; proteinLength: number } {
  const includedTypes = new Set([
    'domain',
    'region',
    'motif',
    'transmembrane',
    'signal',
    'repeat',
    'conserved_site'
  ])
  const domains: ProteinDomain[] = []
  let proteinLength = 0

  for (const entry of results) {
    const { accession: entryAccession, name, type } = entry.metadata
    if (!includedTypes.has(type.toLowerCase())) continue
    for (const protein of entry.proteins ?? []) {
      if (
        proteinLength === 0 &&
        protein.accession.toUpperCase() === accession &&
        protein.protein_length !== undefined
      ) {
        proteinLength = protein.protein_length
      } else if (proteinLength === 0 && protein.protein_length !== undefined) {
        proteinLength = protein.protein_length
      }
      for (const location of protein.entry_protein_locations ?? []) {
        for (const fragment of location.fragments) {
          domains.push({
            accession: entryAccession,
            name,
            type: type.toLowerCase(),
            start: fragment.start,
            end: fragment.end
          })
        }
      }
    }
  }

  return { domains, proteinLength }
}

function buildStructureInfo(
  accession: string,
  predictions: ReturnType<typeof AlphaFoldResponseSchema.parse>
): ProteinStructureInfo {
  const prediction = predictions[0]
  if (prediction === undefined) {
    return { uniprotAccession: accession, alphafold: null, pdb: null }
  }

  const cifUrl = prediction.cifUrl ?? prediction.modelUrl
  return {
    uniprotAccession: accession,
    alphafold:
      cifUrl !== undefined && cifUrl !== ''
        ? {
            source: 'alphafold',
            url: cifUrl,
            format: 'cif',
            id: prediction.entryId,
            version: prediction.latestVersion
          }
        : null,
    pdb:
      prediction.pdbUrl !== undefined && prediction.pdbUrl !== ''
        ? {
            source: 'pdb',
            url: prediction.pdbUrl,
            format: 'pdb',
            id: prediction.entryId
          }
        : null
  }
}
