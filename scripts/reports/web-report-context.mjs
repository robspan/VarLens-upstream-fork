import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const artifactRoot = resolve(repoRoot, '.planning/artifacts/web/test-reporting')
export const latestDir = resolve(artifactRoot, 'latest')
export const runsDir = resolve(artifactRoot, 'runs')
export const dataFixtureManifestPath = resolve(repoRoot, 'scripts/data-fixtures/sources.json')
export const generatedFixtureRoot = resolve(repoRoot, 'tests/.cache/public-data/generated')
export const apiFixtureRoot = resolve(repoRoot, 'tests/fixtures/api')

export const ipcDomainDirs = {
  shared: 'src/shared/ipc/domains',
  preload: 'src/preload/domains',
  main: 'src/main/ipc/domains'
}
export const flatIpcHandlers = ['shell', 'shortlist', 'system', 'updater']
export const stakeholderIpcAreas = [
  { id: 'analysis-groups', label: 'Analysis Groups' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'batch-import', label: 'Batch Import' },
  { id: 'case-comments', label: 'Case Comments' },
  { id: 'case-metadata', label: 'Case Metadata' },
  { id: 'case-metrics', label: 'Case Metrics' },
  { id: 'cases', label: 'Cases' },
  { id: 'cohort', label: 'Cohort' },
  { id: 'database', label: 'Database' },
  { id: 'export', label: 'Export' },
  { id: 'presets', label: 'Filter Presets' },
  { id: 'gene-lists', label: 'Gene Lists' },
  { id: 'gene-ref', label: 'Gene Reference' },
  { id: 'hpo', label: 'HPO' },
  { id: 'import', label: 'Import' },
  { id: 'panels', label: 'Panels' },
  { id: 'protein', label: 'Protein' },
  { id: 'region-files', label: 'Region Files' },
  { id: 'tags', label: 'Tags' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'variants', label: 'Variants' },
  { id: 'vep', label: 'VEP' }
]
export const stakeholderIpcSharedIds = {
  audit: 'audit-log',
  presets: 'filter-presets'
}

export function loadLocalPostgresEnvForWebMode() {
  const webMode = process.env.VARLENS_WEB === '1'
  if (!webMode || process.env.VARLENS_PG_URL !== undefined) return

  const envPath = resolve(repoRoot, '.env.postgres.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/u)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, '')
    if (key !== '' && process.env[key] === undefined) process.env[key] = value
  }
}

export function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path
}
