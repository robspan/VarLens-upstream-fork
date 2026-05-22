#!/usr/bin/env node
import { copyFile, writeFile } from 'node:fs/promises'

import {
  ensureParent,
  parseArgs,
  readManifest,
  resolveRepoPath,
  selectFixtures,
  sourceLocalPath,
  verifyFile,
  verifyFixtureSources
} from './data-utils.mjs'
import { transformFixture as transformVcfToVarLensJson } from './transform-vcf-to-varlens-json.mjs'
import { buildDeterministicZip } from './zip-writer.mjs'

function usage() {
  return `Usage: node scripts/data-fixtures/prepare-fixtures.mjs [--fixture ID ...] [--all] [--allow-large]

Creates generated VarLens-ready artifacts from gathered source data.
Outputs go to gitignored cache paths unless a manifest entry explicitly says otherwise.
`
}

async function runTransform(fixture, manifest, transform) {
  if (transform.type === 'copy') {
    const input = sourceLocalPath(fixture, manifest)
    const output = resolveRepoPath(transform.output)
    await verifyFile(input, fixture.source, `source ${fixture.id}`)
    await ensureParent(output)
    await copyFile(input, output)
    await verifyFile(output, transform, `generated ${fixture.id}:${transform.id}`)
    console.log(`[data:prepare] ${fixture.id}:${transform.id} -> ${output}`)
    return
  }

  if (transform.type === 'copy-many') {
    await verifyFixtureSources(fixture, manifest)
    for (const file of transform.files ?? []) {
      const input = resolveRepoPath(file.input)
      const output = resolveRepoPath(file.output)
      await verifyFile(input, file, `source ${fixture.id}:${file.id}`)
      await ensureParent(output)
      await copyFile(input, output)
      await verifyFile(output, file, `generated ${fixture.id}:${file.id}`)
      console.log(`[data:prepare] ${fixture.id}:${file.id} -> ${output}`)
    }
    return
  }

  if (transform.type === 'zip') {
    await verifyFixtureSources(fixture, manifest)
    const output = resolveRepoPath(transform.output)
    const entries = (transform.entries ?? []).map((entry) => ({
      path: resolveRepoPath(entry.input),
      entryName: entry.entryName
    }))
    await ensureParent(output)
    await writeFile(output, await buildDeterministicZip(entries))
    await verifyFile(output, transform, `generated ${fixture.id}:${transform.id}`)
    console.log(`[data:prepare] ${fixture.id}:${transform.id} -> ${output}`)
    return
  }

  if (transform.type === 'vcf-to-varlens-json') {
    await verifyFile(sourceLocalPath(fixture, manifest), fixture.source, `source ${fixture.id}`)
    await transformVcfToVarLensJson(fixture, manifest, transform)
    return
  }

  throw new Error(`Fixture ${fixture.id} has unsupported transform type: ${transform.type}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  const fixtures = selectFixtures(manifest, options)
  if (fixtures.length === 0) {
    console.log('[data:prepare] no fixtures selected')
    return
  }

  for (const fixture of fixtures) {
    if (fixture.large === true && options.allowLarge !== true) {
      throw new Error(
        `Fixture ${fixture.id} is marked large. Re-run with --allow-large if you really want to prepare it.`
      )
    }
    const transforms = fixture.transforms ?? []
    if (transforms.length === 0) {
      console.log(`[data:prepare] ${fixture.id} has no transforms`)
      continue
    }
    for (const transform of transforms) {
      await runTransform(fixture, manifest, transform)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
