import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readJsonIfExists } from './web-report-ctrf.mjs'
import {
  apiFixtureRoot,
  dataFixtureManifestPath,
  generatedFixtureRoot,
  latestDir
} from './web-report-context.mjs'

function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function fixtureSourceSummary(fixture) {
  if (fixture.source?.kind === 'local-set') {
    return (fixture.source.files ?? []).map((file) => file.path).join(', ')
  }
  return fixture.source?.path ?? fixture.source?.url ?? 'unknown'
}

function fixtureArtifactSummary(fixture) {
  const target = fixture.varlensTarget ?? {}
  if (typeof target.artifact === 'string') return target.artifact
  if (Array.isArray(target.files)) {
    return target.files.map((file) => file.filePath).join(', ')
  }
  return 'not directly imported'
}

function renderTestDataCatalog(dataManifest, manifest) {
  const fixtures = Array.isArray(dataManifest?.fixtures)
    ? dataManifest.fixtures.filter((fixture) => fixture.enabledByDefault === true)
    : []
  const lines = [
    '# Web Parity Test Data Catalog',
    '',
    `Run ID: ${manifest.runId}`,
    `Git: ${manifest.git.branch ?? 'unknown'} @ ${manifest.git.sha ?? 'unknown'}${
      manifest.git.dirty ? ' (dirty)' : ''
    }`,
    `Generated: ${manifest.finishedAt ?? new Date().toISOString()}`,
    '',
    'This catalog describes the fixture inputs used by the web validation report. The folder next to this file contains the exact generated artifacts consumed by the parity tests plus API response fixtures used to stabilize external-service calls.',
    '',
    '## Folder Contents',
    '',
    '- `source-manifest.json` is the canonical machine-readable fixture manifest, including origin paths, checksums, transforms, and intended coverage.',
    '- `source-catalog.md` is this human-readable catalog.',
    '- `generated/` contains the generated VarLens-ready data artifacts used by import and query parity tests.',
    '- `api-fixtures/` contains deterministic API responses used by HPO, VEP, protein, and related network-backed checks.',
    '',
    '## Fixture Inventory',
    '',
    '| Fixture | Purpose | Source | Test Artifact | Mode | Size | Coverage |',
    '| --- | --- | --- | --- | --- | ---: | --- |'
  ]

  for (const fixture of fixtures) {
    const coverage = Array.isArray(fixture.expectedCoverage)
      ? fixture.expectedCoverage.join(', ')
      : 'not specified'
    const sourceSize =
      typeof fixture.source?.sizeBytes === 'number'
        ? fixture.source.sizeBytes
        : Array.isArray(fixture.source?.files)
          ? fixture.source.files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
          : undefined
    lines.push(
      `| ${fixture.id} | ${fixture.purpose ?? ''} | \`${fixtureSourceSummary(fixture)}\` | \`${fixtureArtifactSummary(
        fixture
      )}\` | ${fixture.varlensTarget?.importMode ?? 'supporting fixture'} | ${formatBytes(
        sourceSize
      )} | ${coverage} |`
    )
  }

  lines.push(
    '',
    '## Verification',
    '',
    'The report runner verifies every selected source and generated artifact before application tests run. Verification includes checksum/size checks from `source-manifest.json` and cheap container checks for VCF, JSON, BED, and ZIP fixtures.',
    '',
    '## Scope Note',
    '',
    'These fixtures are intentionally compact and representative. They are evidence for the validation scope in the report, not a replacement for broad clinical dataset validation.'
  )

  return `${lines.join('\n')}\n`
}

async function writeTestDataEvidencePackage(runDir, manifest) {
  const evidenceDir = resolve(runDir, 'test-data')
  await rm(evidenceDir, { recursive: true, force: true })
  await mkdir(evidenceDir, { recursive: true })

  const dataManifest = await readJsonIfExists(dataFixtureManifestPath)
  await copyFile(dataFixtureManifestPath, resolve(evidenceDir, 'source-manifest.json'))
  await writeFile(
    resolve(evidenceDir, 'source-catalog.md'),
    renderTestDataCatalog(dataManifest, manifest),
    'utf8'
  )

  if (existsSync(generatedFixtureRoot)) {
    await cp(generatedFixtureRoot, resolve(evidenceDir, 'generated'), { recursive: true })
  }

  if (existsSync(apiFixtureRoot)) {
    await cp(apiFixtureRoot, resolve(evidenceDir, 'api-fixtures'), { recursive: true })
  }
}

async function compactReportPackage(runDir) {
  const removablePaths = [
    'ctrf-report.json',
    'junit',
    'manifest.json',
    'secrets',
    'stakeholder-report.html',
    'stakeholder-report.md',
    'vitest'
  ]

  for (const removablePath of removablePaths) {
    await rm(resolve(runDir, removablePath), { recursive: true, force: true })
  }
}

async function publishLatestReport(runDir) {
  await rm(latestDir, { recursive: true, force: true })
  await mkdir(latestDir, { recursive: true })

  await copyFile(resolve(runDir, 'summary.md'), resolve(latestDir, 'summary.md'))

  const pdfPath = resolve(runDir, 'stakeholder-report.pdf')
  if (existsSync(pdfPath)) {
    await copyFile(pdfPath, resolve(latestDir, 'stakeholder-report.pdf'))
  }

  const pdfErrorPath = resolve(runDir, 'stakeholder-report.pdf.error.txt')
  if (existsSync(pdfErrorPath)) {
    await copyFile(pdfErrorPath, resolve(latestDir, 'stakeholder-report.pdf.error.txt'))
  }

  const logsDir = resolve(runDir, 'logs')
  if (existsSync(logsDir)) {
    await cp(logsDir, resolve(latestDir, 'logs'), { recursive: true })
  }

  const testDataDir = resolve(runDir, 'test-data')
  if (existsSync(testDataDir)) {
    await cp(testDataDir, resolve(latestDir, 'test-data'), { recursive: true })
  }

  const parityDir = resolve(runDir, 'parity')
  if (existsSync(parityDir)) {
    await cp(parityDir, resolve(latestDir, 'parity'), { recursive: true })
  }
}

export { compactReportPackage, publishLatestReport, writeTestDataEvidencePackage }
