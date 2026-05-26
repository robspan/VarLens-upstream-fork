#!/usr/bin/env node
import { createGunzip } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import {
  parseArgs,
  readManifest,
  resolveRepoPath,
  selectFixtures,
  sourceFiles,
  verifyFile,
  verifyFixtureSources
} from './data-utils.mjs'

function usage() {
  return `Usage: node scripts/data-fixtures/verify-fixtures.mjs [--fixture ID ...] [--all] [--allow-large]

Verifies source and generated fixture checksums plus cheap type checks.
`
}

function isGzip(path) {
  return path.endsWith('.gz')
}

async function firstLine(path) {
  return await new Promise((resolveLine, reject) => {
    const raw = createReadStream(path)
    const stream = isGzip(path) ? raw.pipe(createGunzip()) : raw
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let resolved = false
    rl.on('line', (line) => {
      if (resolved) return
      resolved = true
      rl.close()
      raw.destroy()
      resolveLine(line)
    })
    rl.on('close', () => {
      if (!resolved) resolveLine('')
    })
    rl.on('error', reject)
    stream.on('error', reject)
  })
}

async function assertContainer(path, container, label) {
  if (container === 'vcf' || container === 'vcf.gz') {
    const line = await firstLine(path)
    if (!line.startsWith('##fileformat=VCFv')) {
      throw new Error(`${label} is not a VCF file: first line is "${line}"`)
    }
    return
  }
  if (container === 'json' || container === 'json.gz') {
    const raw = isGzip(path)
      ? await new Promise((resolveRaw, reject) => {
          const chunks = []
          createReadStream(path)
            .pipe(createGunzip())
            .on('data', (chunk) => chunks.push(chunk))
            .on('error', reject)
            .on('end', () => resolveRaw(Buffer.concat(chunks).toString('utf8')))
        })
      : await readFile(path, 'utf8')
    JSON.parse(raw)
    return
  }
  if (container === 'bed' || container === 'bed.gz') {
    const line = await firstLine(path)
    const fields = line.split('\t')
    if (fields.length < 3 || Number.isNaN(Number(fields[1])) || Number.isNaN(Number(fields[2]))) {
      throw new Error(`${label} is not a BED-like file: first line is "${line}"`)
    }
    return
  }
  if (container === 'zip') {
    const handle = await readFile(path)
    if (handle.length < 4 || handle.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`${label} is not a ZIP file: missing local file header`)
    }
  }
}

async function verifyFixture(fixture, manifest, options) {
  if (fixture.large === true && options.allowLarge !== true) {
    throw new Error(
      `Fixture ${fixture.id} is marked large. Re-run with --allow-large if you really want to verify it.`
    )
  }

  await verifyFixtureSources(fixture, manifest)
  for (const source of sourceFiles(fixture, manifest)) {
    const container = source.container ?? fixture.sourceType?.container
    if (typeof container === 'string') {
      await assertContainer(source.path, container, source.label)
    }
  }

  for (const transform of fixture.transforms ?? []) {
    if (transform.type === 'copy') {
      const output = resolveRepoPath(transform.output)
      await verifyFile(output, transform, `generated ${fixture.id}:${transform.id}`)
      await assertContainer(
        output,
        fixture.sourceType.container,
        `generated ${fixture.id}:${transform.id}`
      )
    } else if (transform.type === 'copy-many') {
      for (const file of transform.files ?? []) {
        const output = resolveRepoPath(file.output)
        await verifyFile(output, file, `generated ${fixture.id}:${file.id}`)
        await assertContainer(output, file.container, `generated ${fixture.id}:${file.id}`)
      }
    } else if (transform.type === 'zip') {
      const output = resolveRepoPath(transform.output)
      await verifyFile(output, transform, `generated ${fixture.id}:${transform.id}`)
      await assertContainer(output, 'zip', `generated ${fixture.id}:${transform.id}`)
    } else if (transform.type === 'vcf-to-varlens-json') {
      for (const [shape, outputPath] of Object.entries(transform.outputs ?? {})) {
        const output = resolveRepoPath(outputPath)
        const expected = transform.outputChecksums?.[shape] ?? {}
        await verifyFile(output, expected, `generated ${fixture.id}:${transform.id}:${shape}`)
        await assertContainer(output, 'json', `generated ${fixture.id}:${transform.id}:${shape}`)
      }
    } else {
      throw new Error(`Fixture ${fixture.id} has unsupported transform type: ${transform.type}`)
    }
  }

  console.log(`[data:verify] ${fixture.id}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  const fixtures = selectFixtures(manifest, options)
  if (fixtures.length === 0) {
    console.log('[data:verify] no fixtures selected')
    return
  }

  for (const fixture of fixtures) {
    await verifyFixture(fixture, manifest, options)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
