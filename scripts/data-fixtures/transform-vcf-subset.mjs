#!/usr/bin/env node
import { createGunzip, gzipSync } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import {
  ensureParent,
  parseArgs,
  readManifest,
  resolveRepoPath,
  selectFixtures,
  sourceLocalPath,
  verifyFile
} from './data-utils.mjs'

function usage() {
  return `Usage: node scripts/data-fixtures/transform-vcf-subset.mjs [--fixture ID ...] [--all] [--allow-large]

Runs manifest vcf-subset transforms. Each transform may define region, maxRecords, output, sha256, and sizeBytes.
`
}

function parseRegion(region) {
  if (typeof region !== 'string' || region === '') return null
  const match = /^(?<chr>[^:]+):(?<start>\d+)-(?<end>\d+)$/u.exec(region)
  if (match?.groups === undefined) throw new Error(`Invalid region: ${region}`)
  return {
    chr: match.groups.chr,
    start: Number(match.groups.start),
    end: Number(match.groups.end)
  }
}

async function readVcfLines(path) {
  if (!path.endsWith('.gz')) {
    return (await readFile(path, 'utf8')).split(/\r?\n/u).filter((line) => line !== '')
  }

  return await new Promise((resolveLines, reject) => {
    const lines = []
    const rl = createInterface({
      input: createReadStream(path).pipe(createGunzip()),
      crlfDelay: Infinity
    })
    rl.on('line', (line) => lines.push(line))
    rl.on('close', () => resolveLines(lines))
    rl.on('error', reject)
  })
}

function inRegion(line, region) {
  if (region === null) return true
  const columns = line.split('\t')
  if (columns.length < 2) return false
  return (
    columns[0] === region.chr &&
    Number(columns[1]) >= region.start &&
    Number(columns[1]) <= region.end
  )
}

async function runTransform(fixture, manifest, transform) {
  const input = sourceLocalPath(fixture, manifest)
  const output = resolveRepoPath(transform.output)
  await verifyFile(input, fixture.source, `source ${fixture.id}`)

  const region = parseRegion(transform.region)
  const maxRecords = typeof transform.maxRecords === 'number' ? transform.maxRecords : Infinity
  const lines = await readVcfLines(input)
  const headers = lines.filter((line) => line.startsWith('#'))
  const records = lines
    .filter((line) => !line.startsWith('#') && inRegion(line, region))
    .slice(0, maxRecords)

  if (records.length === 0) {
    throw new Error(`Fixture ${fixture.id}:${transform.id} produced zero VCF records`)
  }

  const payload = `${[...headers, ...records].join('\n')}\n`
  await ensureParent(output)
  await writeFile(output, output.endsWith('.gz') ? gzipSync(payload, { mtime: 0 }) : payload)
  await verifyFile(output, transform, `generated ${fixture.id}:${transform.id}`)
  console.log(
    `[data:subset] ${fixture.id}:${transform.id} -> ${output} (${records.length} records)`
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  for (const fixture of selectFixtures(manifest, options)) {
    for (const transform of fixture.transforms ?? []) {
      if (transform.type === 'vcf-subset') {
        await runTransform(fixture, manifest, transform)
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
