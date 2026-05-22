#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { copyFile, rename, rm } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

import {
  ensureParent,
  parseArgs,
  readManifest,
  selectFixtures,
  sourceFiles,
  sourceLocalPath,
  verifyFile,
  verifyFixtureSources
} from './data-utils.mjs'

function usage() {
  return `Usage: node scripts/data-fixtures/download-fixtures.mjs [--fixture ID ...] [--all] [--allow-large]

Downloads or verifies source artifacts from scripts/data-fixtures/sources.json.
Default mode processes enabledByDefault fixtures only and never downloads large sources.
`
}

async function download(url, outputPath) {
  await ensureParent(outputPath)
  const partial = `${outputPath}.partial`
  await rm(partial, { force: true })

  await new Promise((resolveDownload, reject) => {
    const client = url.startsWith('https:') ? httpsGet : httpGet
    const request = client(url, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location !== undefined) {
        response.resume()
        download(new URL(response.headers.location, url).toString(), outputPath)
          .then(resolveDownload)
          .catch(reject)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`Download failed ${status}: ${url}`))
        return
      }

      const file = createWriteStream(partial)
      response.pipe(file)
      file.on('finish', () => file.close(resolveDownload))
      file.on('error', reject)
    })
    request.on('error', reject)
  })

  await rename(partial, outputPath)
}

async function processFixture(fixture, manifest, options) {
  if (fixture.large === true && options.allowLarge !== true) {
    throw new Error(
      `Fixture ${fixture.id} is marked large. Re-run with --allow-large if you really want to gather it.`
    )
  }

  const source = fixture.source
  const localPath = sourceLocalPath(fixture, manifest)

  if (source.kind === 'local' || source.kind === 'local-set') {
    await verifyFixtureSources(fixture, manifest)
    const paths = sourceFiles(fixture, manifest).map((file) => file.path)
    console.log(`[data:gather] verified local source ${fixture.id}: ${paths.join(', ')}`)
    return
  }

  if (source.kind !== 'remote') {
    throw new Error(`Fixture ${fixture.id} has unsupported source kind: ${source.kind}`)
  }

  try {
    await verifyFile(localPath, source, `cached source ${fixture.id}`)
    console.log(`[data:gather] cache hit ${fixture.id}: ${localPath}`)
    return
  } catch {
    // Cache miss or invalid cache. Replace it with a fresh download.
  }

  console.log(`[data:gather] downloading ${fixture.id}: ${source.url}`)
  await ensureParent(localPath)
  await download(source.url, localPath)

  try {
    await verifyFile(localPath, source, `downloaded source ${fixture.id}`)
  } catch (error) {
    await rm(localPath, { force: true })
    throw error
  }

  if (source.copyTo !== undefined) {
    await ensureParent(source.copyTo)
    await copyFile(localPath, source.copyTo)
  }
  console.log(`[data:gather] ready ${fixture.id}: ${localPath}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  const fixtures = selectFixtures(manifest, options)
  if (fixtures.length === 0) {
    console.log('[data:gather] no fixtures selected')
    return
  }

  for (const fixture of fixtures) {
    await processFixture(fixture, manifest, options)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
