#!/usr/bin/env node
import {
  parseArgs,
  readManifest,
  resolveRepoPath,
  selectFixtures,
  verifyFixtureSources,
  verifyFile,
  ensureParent
} from './data-utils.mjs'
import { copyFile } from 'node:fs/promises'

function usage() {
  return `Usage: node scripts/data-fixtures/transform-longread-bundle.mjs [--fixture ID ...] [--all] [--allow-large]

Runs manifest copy-many transforms for long-read bundle fixtures.
`
}

async function runBundleTransform(fixture, manifest, transform) {
  await verifyFixtureSources(fixture, manifest)
  for (const file of transform.files ?? []) {
    const input = resolveRepoPath(file.input)
    const output = resolveRepoPath(file.output)
    await verifyFile(input, file, `source ${fixture.id}:${file.id}`)
    await ensureParent(output)
    await copyFile(input, output)
    await verifyFile(output, file, `generated ${fixture.id}:${file.id}`)
  }
  console.log(`[data:longread] ${fixture.id}:${transform.id} -> ${transform.files.length} files`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  for (const fixture of selectFixtures(manifest, options)) {
    if (fixture.varlensTarget?.importMode !== 'multi-file') continue
    for (const transform of fixture.transforms ?? []) {
      if (transform.type === 'copy-many') {
        await runBundleTransform(fixture, manifest, transform)
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
