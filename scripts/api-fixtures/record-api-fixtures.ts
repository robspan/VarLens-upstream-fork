import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { AlphaFoldResponseSchema } from '../../src/main/services/api/schemas/protein-response'
import {
  EnsemblGeneLookupSchema,
  InterProResponseSchema,
  UniProtResponseSchema
} from '../../src/main/services/api/schemas/protein-response'
import { HpoAutocompleteResponseSchema } from '../../src/main/services/api/schemas/hpo-response'
import { VepResponseSchema } from '../../src/main/services/api/schemas/vep-response'

type FixtureId = 'hpo' | 'vep' | 'uniprot' | 'interpro' | 'alphafold' | 'ensembl'

type FixtureDefinition = {
  id: FixtureId
  label: string
  url: string
  rawPath: string
  fixturePath: string
  validateRaw: (value: unknown) => unknown
  curate: (value: unknown) => unknown
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const rawRoot = resolve(repoRoot, '.planning/artifacts/web/api-fixtures/raw')
const fixtureRoot = resolve(repoRoot, 'tests/fixtures/api')

const userAgent = 'VarLens API fixture recorder (offline parity tests)'

const fixtures: FixtureDefinition[] = [
  {
    id: 'hpo',
    label: 'HPO search for seizure',
    url: 'https://clinicaltables.nlm.nih.gov/api/hpo/v3/search?terms=seizure&count=3&df=id,name',
    rawPath: 'hpo/search-seizure.raw.json',
    fixturePath: 'hpo/search-seizure.json',
    validateRaw: (value) => HpoAutocompleteResponseSchema.parse(value),
    curate: (value) => HpoAutocompleteResponseSchema.parse(value)
  },
  {
    id: 'vep',
    label: 'Ensembl VEP annotation for TP53-region chr17 variant',
    url: 'https://rest.ensembl.org/vep/human/region/17:7674220:7674220/T?content-type=application/json&CADD=1&sift=b&polyphen=b&merged=1',
    rawPath: 'vep/chr17-7674220-g-t.raw.json',
    fixturePath: 'vep/chr17-7674220-g-t.json',
    validateRaw: (value) => VepResponseSchema.parse(value),
    curate: (value) => curateVep(value)
  },
  {
    id: 'uniprot',
    label: 'UniProt mapping for TP53',
    url: 'https://rest.uniprot.org/uniprotkb/search?query=gene_exact:TP53+AND+organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name,length&format=json&size=1',
    rawPath: 'uniprot/tp53.raw.json',
    fixturePath: 'uniprot/tp53.json',
    validateRaw: (value) => UniProtResponseSchema.parse(value),
    curate: (value) => UniProtResponseSchema.parse(value)
  },
  {
    id: 'interpro',
    label: 'InterPro domains for P04637',
    url: 'https://www.ebi.ac.uk/interpro/api/entry/interpro/protein/uniprot/P04637',
    rawPath: 'interpro/p04637.raw.json',
    fixturePath: 'interpro/p04637.json',
    validateRaw: (value) => InterProResponseSchema.parse(value),
    curate: (value) => curateInterPro(value)
  },
  {
    id: 'alphafold',
    label: 'AlphaFold structure for P04637',
    url: 'https://alphafold.ebi.ac.uk/api/prediction/P04637',
    rawPath: 'alphafold/p04637.raw.json',
    fixturePath: 'alphafold/p04637.json',
    validateRaw: (value) => AlphaFoldResponseSchema.parse(value),
    curate: (value) => AlphaFoldResponseSchema.parse(value).slice(0, 1)
  },
  {
    id: 'ensembl',
    label: 'Ensembl gene structure for TP53',
    url: 'https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53?expand=1&content-type=application/json',
    rawPath: 'ensembl/tp53-gene-structure.raw.json',
    fixturePath: 'ensembl/tp53-gene-structure.json',
    validateRaw: (value) => EnsemblGeneLookupSchema.parse(value),
    curate: (value) => curateEnsembl(value)
  }
]

async function main(): Promise<void> {
  for (const fixture of fixtures) {
    process.stdout.write(`Fetching ${fixture.id}: ${fixture.label}\n`)
    const raw = await fetchJson(fixture.url)
    fixture.validateRaw(raw)

    const curated = fixture.curate(raw)
    fixture.validateRaw(curated)

    const rawPath = resolve(rawRoot, fixture.rawPath)
    const fixturePath = resolve(fixtureRoot, fixture.fixturePath)
    await writeJson(rawPath, raw)
    await writeJson(fixturePath, curated)

    process.stdout.write(
      `  raw ${shortHash(raw)} -> ${relative(rawPath)}\n` +
        `  fixture ${shortHash(curated)} -> ${relative(fixturePath)}\n`
    )
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent
    }
  })

  if (!response.ok) {
    throw new Error(`Fixture source returned HTTP ${response.status}: ${url}`)
  }

  return await response.json()
}

function curateVep(value: unknown): unknown {
  const parsed = VepResponseSchema.parse(value)
  const item = parsed[0]
  if (item === undefined) return parsed

  const transcriptCandidates = item.transcript_consequences ?? []
  const transcript_consequences = uniqueByTranscriptId([
    transcriptCandidates.find((transcript) => transcript.mane_select !== undefined),
    transcriptCandidates.find((transcript) => transcript.canonical === 1),
    transcriptCandidates[0],
    transcriptCandidates.find((transcript) => transcript.polyphen_prediction !== undefined),
    transcriptCandidates.find((transcript) => transcript.impact === 'MODIFIER')
  ]).slice(0, 4)

  const colocatedWithClinicalContext = item.colocated_variants?.find(
    (variant) => variant.clin_sig !== undefined || variant.frequencies !== undefined
  )
  const colocated_variants = [item.colocated_variants?.[0], colocatedWithClinicalContext].filter(
    (variant): variant is NonNullable<typeof variant> => variant !== undefined
  )

  return VepResponseSchema.parse([
    {
      id: item.id,
      input: item.input,
      most_severe_consequence: item.most_severe_consequence,
      transcript_consequences,
      colocated_variants
    }
  ])
}

function uniqueByTranscriptId(
  values: Array<
    | NonNullable<
        ReturnType<typeof VepResponseSchema.parse>[number]['transcript_consequences']
      >[number]
    | undefined
  >
): NonNullable<ReturnType<typeof VepResponseSchema.parse>[number]['transcript_consequences']> {
  const seen = new Set<string>()
  const result: NonNullable<
    ReturnType<typeof VepResponseSchema.parse>[number]['transcript_consequences']
  > = []
  for (const value of values) {
    if (value === undefined || seen.has(value.transcript_id)) continue
    seen.add(value.transcript_id)
    result.push(value)
  }
  return result
}

function curateInterPro(value: unknown): unknown {
  const parsed = InterProResponseSchema.parse(value)
  const includedTypes = new Set([
    'domain',
    'region',
    'motif',
    'transmembrane',
    'signal',
    'repeat',
    'conserved_site'
  ])
  const results = parsed.results
    .filter((entry) => includedTypes.has(entry.metadata.type.toLowerCase()))
    .slice(0, 3)

  return InterProResponseSchema.parse({
    count: results.length,
    results
  })
}

function curateEnsembl(value: unknown): unknown {
  const parsed = EnsemblGeneLookupSchema.parse(value)
  const transcripts = parsed.Transcript ?? []
  const selected =
    transcripts.find(
      (transcript) =>
        transcript.is_canonical === 1 && transcript.Exon !== undefined && transcript.Exon.length > 0
    ) ??
    transcripts.find((transcript) => transcript.Exon !== undefined && transcript.Exon.length > 0)

  return EnsemblGeneLookupSchema.parse({
    ...parsed,
    Transcript: selected === undefined ? [] : [selected]
  })
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function shortHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
}

function relative(path: string): string {
  return path.replace(`${repoRoot}/`, '')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
