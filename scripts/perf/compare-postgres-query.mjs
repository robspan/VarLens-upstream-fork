#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/postgres-query')

function listArtifacts() {
  let entries
  try {
    entries = readdirSync(ARTIFACT_DIR)
  } catch {
    globalThis.console.log(
      `No artifact directory at ${ARTIFACT_DIR}. Run the postgres query perf benchmark first.`
    )
    return []
  }

  return entries.filter((name) => name.endsWith('-postgres-query.md')).sort()
}

function parseArtifact(filename) {
  const text = readFileSync(resolve(ARTIFACT_DIR, filename), 'utf8')
  const rows = [...text.matchAll(/^\| ([^|]+) \| ([0-9.]+) \| ([0-9]+) \|$/gm)]
  return Object.fromEntries(rows.map((row) => [row[1].trim(), Number(row[2])]))
}

function formatRatio(previousMs, currentMs) {
  if (previousMs === undefined || previousMs === 0) {
    return 'n/a'
  }
  return (currentMs / previousMs).toFixed(2)
}

const files = listArtifacts()

if (files.length < 2) {
  globalThis.console.log('Need at least two postgres query artifacts to compare.')
  process.exit(0)
}

const previous = files.at(-2)
const current = files.at(-1)

if (previous === undefined || current === undefined) {
  throw new Error('Expected at least two postgres query artifacts')
}

const previousTimings = parseArtifact(previous)
const currentTimings = parseArtifact(current)

globalThis.console.log(`# PostgreSQL Query Perf Comparison\n`)
globalThis.console.log(`Previous: ${previous}`)
globalThis.console.log(`Current: ${current}\n`)
globalThis.console.log('| Query | previous ms | current ms | ratio |')
globalThis.console.log('| --- | ---: | ---: | ---: |')

for (const query of Object.keys(currentTimings)) {
  const previousMs = previousTimings[query]
  const currentMs = currentTimings[query]
  const previousLabel = previousMs?.toFixed(2) ?? 'n/a'
  globalThis.console.log(
    `| ${query} | ${previousLabel} | ${currentMs.toFixed(2)} | ${formatRatio(previousMs, currentMs)} |`
  )
}
