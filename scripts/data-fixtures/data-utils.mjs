import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
export const manifestPath = resolve(repoRoot, 'scripts/data-fixtures/sources.json')

export async function readManifest() {
  const raw = await readFile(manifestPath, 'utf8')
  return JSON.parse(raw)
}

export function resolveRepoPath(path) {
  return resolve(repoRoot, path)
}

export async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true })
}

export async function sha256File(path) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

export async function verifyFile(path, expected, label) {
  let fileStat
  try {
    fileStat = await stat(path)
  } catch {
    throw new Error(`${label} missing: ${path}`)
  }

  if (typeof expected.sizeBytes === 'number' && fileStat.size !== expected.sizeBytes) {
    throw new Error(
      `${label} size mismatch: expected ${expected.sizeBytes}, got ${fileStat.size} (${path})`
    )
  }

  if (typeof expected.minSizeBytes === 'number' && fileStat.size < expected.minSizeBytes) {
    throw new Error(
      `${label} too small: expected at least ${expected.minSizeBytes}, got ${fileStat.size} (${path})`
    )
  }

  if (typeof expected.maxSizeBytes === 'number' && fileStat.size > expected.maxSizeBytes) {
    throw new Error(
      `${label} too large: expected at most ${expected.maxSizeBytes}, got ${fileStat.size} (${path})`
    )
  }

  if (typeof expected.sha256 === 'string' && expected.sha256 !== '') {
    const actual = await sha256File(path)
    if (actual !== expected.sha256) {
      throw new Error(
        `${label} sha256 mismatch: expected ${expected.sha256}, got ${actual} (${path})`
      )
    }
  }
}

export function selectFixtures(manifest, options) {
  const fixtures = manifest.fixtures ?? []
  if (options.fixtureIds.length > 0) {
    const selected = []
    for (const id of options.fixtureIds) {
      const fixture = fixtures.find((item) => item.id === id)
      if (fixture === undefined) {
        throw new Error(`Unknown fixture id: ${id}`)
      }
      selected.push(fixture)
    }
    return selected
  }
  if (options.all === true) return fixtures
  return fixtures.filter((fixture) => fixture.enabledByDefault === true)
}

export function parseArgs(argv) {
  const options = {
    all: false,
    allowLarge: false,
    fixtureIds: []
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') {
      options.all = true
    } else if (arg === '--allow-large') {
      options.allowLarge = true
    } else if (arg === '--fixture') {
      const id = argv[++i]
      if (id === undefined || id === '') throw new Error('--fixture requires an id')
      options.fixtureIds.push(id)
    } else if (arg.startsWith('--fixture=')) {
      options.fixtureIds.push(arg.slice('--fixture='.length))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

export function sourceLocalPath(fixture, manifest) {
  if (fixture.source.kind === 'local') return resolveRepoPath(fixture.source.path)
  const cacheRoot = manifest.cacheRoot ?? 'tests/.cache/public-data'
  return resolveRepoPath(`${cacheRoot}/${fixture.source.cachePath}`)
}

export function sourceFiles(fixture, manifest) {
  if (fixture.source.kind === 'local-set') {
    return (fixture.source.files ?? []).map((file) => ({
      id: file.id,
      path: resolveRepoPath(file.path),
      expected: file,
      container: file.container,
      label: `source ${fixture.id}:${file.id}`
    }))
  }

  return [
    {
      id: fixture.id,
      path: sourceLocalPath(fixture, manifest),
      expected: fixture.source,
      container: fixture.sourceType?.container,
      label: `source ${fixture.id}`
    }
  ]
}

export async function verifyFixtureSources(fixture, manifest) {
  for (const source of sourceFiles(fixture, manifest)) {
    await verifyFile(source.path, source.expected, source.label)
  }
}
