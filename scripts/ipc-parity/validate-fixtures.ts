import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AlphaFoldResponseSchema,
  EnsemblGeneLookupSchema,
  InterProResponseSchema,
  UniProtResponseSchema
} from '../../src/main/services/api/schemas/protein-response'
import { HpoAutocompleteResponseSchema } from '../../src/main/services/api/schemas/hpo-response'
import { VepResponseSchema } from '../../src/main/services/api/schemas/vep-response'

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const ipcFixturePath = resolve(repoRoot, 'tests/fixtures/ipc-parity/manifest.json')
const dataFixturePath = resolve(repoRoot, 'scripts/data-fixtures/sources.json')

const expectedIpcAreas = [
  'analysis-groups',
  'annotations',
  'audit',
  'batch-import',
  'case-comments',
  'case-metadata',
  'case-metrics',
  'cases',
  'cohort',
  'database',
  'export',
  'presets',
  'gene-lists',
  'gene-ref',
  'hpo',
  'import',
  'panels',
  'protein',
  'region-files',
  'tags',
  'transcripts',
  'variants',
  'vep'
]

type JsonRecord = Record<string, unknown>

type IpcOperation = {
  domain: string
  method: string
  args: unknown[]
  fixture?: string
}

type IpcScenario = {
  id: string
  covers: string[]
  operations: IpcOperation[]
}

function main(): void {
  const manifest = readJson(ipcFixturePath)
  const dataManifest = readJson(dataFixturePath)

  assert(manifest.schemaVersion === 1, 'IPC fixture manifest must use schemaVersion 1')
  const target = asRecord(manifest.coverageTarget, 'coverageTarget')
  const requiredIpcAreas = asStringArray(target.requiredIpcAreas, 'coverageTarget.requiredIpcAreas')
  assertSameSet(requiredIpcAreas, expectedIpcAreas, 'coverageTarget.requiredIpcAreas')

  validateDataLineage(manifest)
  validateBaseData(manifest, dataManifest)
  validateApiFixtures(manifest)
  validateScenarioCoverage(manifest)
  validateOperationSemantics(manifest)

  process.stdout.write(
    `IPC parity fixtures valid: ${expectedIpcAreas.length}/${expectedIpcAreas.length} IPC areas covered\n`
  )
}

function validateDataLineage(manifest: JsonRecord): void {
  const lineage = asRecord(manifest.dataLineage, 'dataLineage')
  for (const threadName of ['caseVariantThread', 'referenceApiThread']) {
    const thread = asRecord(lineage[threadName], `dataLineage.${threadName}`)
    assert(
      asString(thread.intent, `dataLineage.${threadName}.intent`).length > 0,
      `dataLineage.${threadName}.intent must be non-empty`
    )
    const sources = asArray(thread.sources, `dataLineage.${threadName}.sources`)
    assert(sources.length > 0, `dataLineage.${threadName}.sources must not be empty`)
    for (const [index, value] of sources.entries()) {
      const source = asRecord(value, `dataLineage.${threadName}.sources[${index}]`)
      if (typeof source.path === 'string' && !source.path.includes('/.cache/')) {
        assertPathExists(source.path, `dataLineage.${threadName}.sources[${index}].path`)
      }
      assert(
        asStringArray(source.usedFor, `dataLineage.${threadName}.sources[${index}].usedFor`)
          .length > 0,
        `dataLineage.${threadName}.sources[${index}].usedFor must not be empty`
      )
    }
    assert(
      asStringArray(thread.links, `dataLineage.${threadName}.links`).length > 0,
      `dataLineage.${threadName}.links must not be empty`
    )
  }
}

function validateBaseData(manifest: JsonRecord, dataManifest: JsonRecord): void {
  const fixtureIds = new Set(
    asArray(dataManifest.fixtures, 'data fixtures').map((fixture, index) =>
      asString(asRecord(fixture, `data fixtures[${index}]`).id, `data fixtures[${index}].id`)
    )
  )
  const baseData = asRecord(manifest.baseData, 'baseData')

  for (const [key, value] of Object.entries(baseData)) {
    if (key === 'variantAnchors') continue
    const fixture = asRecord(value, `baseData.${key}`)
    const fixtureId = asString(fixture.fixtureId, `baseData.${key}.fixtureId`)
    assert(fixtureIds.has(fixtureId), `baseData.${key}.fixtureId references unknown ${fixtureId}`)

    if (typeof fixture.filePath === 'string' && !fixture.filePath.includes('/.cache/')) {
      assertPathExists(fixture.filePath, `baseData.${key}.filePath`)
    }
  }

  const anchors = asRecord(baseData.variantAnchors, 'baseData.variantAnchors')
  for (const anchorName of ['primary', 'secondary']) {
    const anchor = asRecord(anchors[anchorName], `baseData.variantAnchors.${anchorName}`)
    for (const field of ['chr', 'pos', 'ref', 'alt', 'gene_symbol', 'consequence', 'func']) {
      assert(anchor[field] !== undefined, `variant anchor ${anchorName} missing ${field}`)
    }
  }
}

function validateApiFixtures(manifest: JsonRecord): void {
  const apiFixtures = asRecord(manifest.apiFixtures, 'apiFixtures')
  const hpo = readFixture(apiFixtures, 'hpo')
  const hpoParsed = HpoAutocompleteResponseSchema.parse(hpo)
  assert(hpoParsed[3].length > 0, 'HPO fixture must contain at least one term')

  const vep = VepResponseSchema.parse(readFixture(apiFixtures, 'vep'))
  assert(vep.length === 1, 'VEP fixture should contain one variant result')
  assert(
    (vep[0]?.transcript_consequences?.length ?? 0) >= 3,
    'VEP fixture must contain at least three transcript consequences'
  )
  assert(
    vep[0]?.transcript_consequences?.some((transcript) => transcript.impact === 'MODIFIER') ===
      true,
    'VEP fixture must include a non-primary transcript consequence for merge/dropdown coverage'
  )
  assert(
    vep[0]?.colocated_variants?.some(
      (variant) => variant.clin_sig !== undefined || variant.frequencies !== undefined
    ) === true,
    'VEP fixture must include colocated clinical/frequency context'
  )

  const uniprot = UniProtResponseSchema.parse(readFixture(apiFixtures, 'uniprot'))
  assert(uniprot.results.length === 1, 'UniProt fixture should contain one mapping result')

  const interpro = InterProResponseSchema.parse(readFixture(apiFixtures, 'interpro'))
  assert(interpro.results.length > 0, 'InterPro fixture must contain at least one domain result')

  const alphafold = AlphaFoldResponseSchema.parse(readFixture(apiFixtures, 'alphafold'))
  assert(alphafold.length === 1, 'AlphaFold fixture should contain one prediction')

  const ensembl = EnsemblGeneLookupSchema.parse(readFixture(apiFixtures, 'ensembl'))
  assert(
    (ensembl.Transcript?.[0]?.Exon?.length ?? 0) >= 8,
    'Ensembl fixture must contain enough exon rows to exercise ordering/ranking'
  )
}

function validateScenarioCoverage(manifest: JsonRecord): void {
  const scenarios = asArray(manifest.scenarios, 'scenarios').map((scenario, index) =>
    normalizeScenario(scenario, index)
  )
  const covered = new Set<string>()

  for (const scenario of scenarios) {
    assert(scenario.id.length > 0, 'scenario id must be non-empty')
    assert(scenario.covers.length > 0, `scenario ${scenario.id} must cover at least one IPC area`)
    assert(
      scenario.operations.length > 0,
      `scenario ${scenario.id} must define at least one operation`
    )

    for (const area of scenario.covers) {
      assert(
        expectedIpcAreas.includes(area),
        `scenario ${scenario.id} covers unknown IPC area ${area}`
      )
      covered.add(area)
    }

    for (const operation of scenario.operations) {
      assert(operation.domain.length > 0, `scenario ${scenario.id} has operation without domain`)
      assert(operation.method.length > 0, `scenario ${scenario.id} has operation without method`)
      assert(
        operation.args !== undefined && Array.isArray(operation.args),
        `scenario ${scenario.id} ${operation.domain}:${operation.method} args must be an array`
      )
      if (typeof operation.fixture === 'string' && !operation.fixture.startsWith('$')) {
        assertPathExists(operation.fixture, `scenario ${scenario.id} fixture`)
      }
    }
  }

  assertSameSet([...covered], expectedIpcAreas, 'scenario coverage')
}

function validateOperationSemantics(manifest: JsonRecord): void {
  const scenarios = asArray(manifest.scenarios, 'scenarios').map((scenario, index) =>
    normalizeScenario(scenario, index)
  )

  for (const scenario of scenarios) {
    for (const operation of scenario.operations) {
      const op = `${operation.domain}:${operation.method}`
      if (op === 'annotations:upsertGlobal') {
        validateOnlyKnownKeys(
          asRecord(operation.args[4], `${scenario.id} ${op} updates`),
          ['global_comment', 'starred', 'acmg_classification', 'acmg_evidence', 'user_name'],
          `${scenario.id} ${op}`
        )
      }
      if (op === 'annotations:upsertPerCase') {
        validateOnlyKnownKeys(
          asRecord(operation.args[2], `${scenario.id} ${op} updates`),
          ['per_case_comment', 'starred', 'acmg_classification', 'acmg_evidence', 'user_name'],
          `${scenario.id} ${op}`
        )
      }
      if (op === 'cohort:getVariants' || op === 'export:cohort') {
        const params = asRecord(operation.args[0], `${scenario.id} ${op} params`)
        assert(
          params.search_query === undefined,
          `${scenario.id} ${op} must use gene_symbol/search_term, not search_query`
        )
      }
      if (op === 'panels:create') {
        const params = asRecord(operation.args[0], `${scenario.id} ${op} params`)
        const source = params.source
        assert(
          source === undefined ||
            source === 'manual' ||
            source === 'panelapp_uk' ||
            source === 'panelapp_aus' ||
            source === 'stringdb' ||
            source === 'bed_import',
          `${scenario.id} ${op} has invalid source ${String(source)}`
        )
      }
      if (op === 'analysis-groups:create') {
        const params = asRecord(operation.args[0], `${scenario.id} ${op} params`)
        const groupType = params.groupType
        assert(
          groupType === undefined || groupType === 'family' || groupType === 'tumor_normal',
          `${scenario.id} ${op} has invalid groupType ${String(groupType)}`
        )
      }
      if (op === 'presets:create') {
        const params = asRecord(operation.args[0], `${scenario.id} ${op} params`)
        const filterJson = asRecord(params.filterJson, `${scenario.id} ${op} filterJson`)
        assert(
          filterJson.clinvar === undefined,
          `${scenario.id} ${op} must use filterJson.clinvars, not clinvar`
        )
      }
    }
  }
}

function validateOnlyKnownKeys(value: JsonRecord, allowedKeys: string[], label: string): void {
  const allowed = new Set(allowedKeys)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  assert(unknown.length === 0, `${label} has unknown keys: ${unknown.join(', ')}`)
}

function normalizeScenario(value: unknown, index: number): IpcScenario {
  const record = asRecord(value, `scenarios[${index}]`)
  return {
    id: asString(record.id, `scenarios[${index}].id`),
    covers: asStringArray(record.covers, `scenarios[${index}].covers`),
    operations: asArray(record.operations, `scenarios[${index}].operations`).map(
      (operation, operationIndex) => {
        const operationRecord = asRecord(
          operation,
          `scenarios[${index}].operations[${operationIndex}]`
        )
        return {
          domain: asString(
            operationRecord.domain,
            `scenarios[${index}].operations[${operationIndex}].domain`
          ),
          method: asString(
            operationRecord.method,
            `scenarios[${index}].operations[${operationIndex}].method`
          ),
          args: asArray(
            operationRecord.args,
            `scenarios[${index}].operations[${operationIndex}].args`
          ),
          fixture: typeof operationRecord.fixture === 'string' ? operationRecord.fixture : undefined
        }
      }
    )
  }
}

function readFixture(apiFixtures: JsonRecord, key: string): unknown {
  const fixture = asRecord(apiFixtures[key], `apiFixtures.${key}`)
  const path = asString(fixture.path, `apiFixtures.${key}.path`)
  assertPathExists(path, `apiFixtures.${key}.path`)
  return readJson(resolve(repoRoot, path))
}

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
}

function assertPathExists(path: string, label: string): void {
  const absolute = resolve(repoRoot, path)
  assert(existsSync(absolute), `${label} does not exist: ${path}`)
}

function asRecord(value: unknown, label: string): JsonRecord {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`
  )
  return value as JsonRecord
}

function asArray(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} must be an array`)
  return value
}

function asString(value: unknown, label: string): string {
  assert(typeof value === 'string', `${label} must be a string`)
  return value
}

function asStringArray(value: unknown, label: string): string[] {
  return asArray(value, label).map((item, index) => asString(item, `${label}[${index}]`))
}

function assertSameSet(actual: string[], expected: string[], label: string): void {
  const missing = expected.filter((item) => !actual.includes(item))
  const extra = actual.filter((item) => !expected.includes(item))
  assert(missing.length === 0, `${label} missing: ${missing.join(', ')}`)
  assert(extra.length === 0, `${label} has unknown entries: ${extra.join(', ')}`)
  assert(new Set(actual).size === actual.length, `${label} contains duplicate entries`)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

main()
