#!/usr/bin/env node
import { createGunzip } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import {
  ensureParent,
  parseArgs,
  readManifest,
  resolveRepoPath,
  selectFixtures,
  sourceLocalPath
} from './data-utils.mjs'

const ANN = {
  allele: 0,
  annotation: 1,
  impact: 2,
  gene: 3,
  transcript: 6,
  hgvsc: 9,
  hgvsp: 10
}

function usage() {
  return `Usage: node scripts/data-fixtures/transform-vcf-to-varlens-json.mjs [--fixture ID ...]

Generates VarLens simple/object/columnar JSON from VCF source fixtures.
`
}

function parseInfo(infoRaw) {
  const info = new Map()
  if (infoRaw === '.' || infoRaw === '') return info
  for (const part of infoRaw.split(';')) {
    if (part === '') continue
    const eq = part.indexOf('=')
    if (eq === -1) info.set(part, '')
    else info.set(part.slice(0, eq), part.slice(eq + 1))
  }
  return info
}

function parseCsqHeader(line) {
  const match = line.match(/Format: ([^"]+)/)
  if (match === null) return []
  return match[1].split('|')
}

function matchesAllele(annotationAllele, alt, ref) {
  if (annotationAllele === alt) return true
  if (annotationAllele === '-' && alt.length < ref.length) return true
  if (alt.length > 1 && annotationAllele === alt.slice(1)) return true
  return false
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '' || value === '.') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCsq(info, fields, alt, ref) {
  const raw = info.get('CSQ')
  if (raw === undefined || raw === '') return {}
  for (const entry of raw.split(',')) {
    const parts = entry.split('|')
    const mapped = new Map()
    for (let i = 0; i < fields.length && i < parts.length; i++) {
      mapped.set(fields[i], parts[i])
    }
    if (!matchesAllele(mapped.get('Allele') ?? '', alt, ref)) continue
    return {
      gene_symbol: mapped.get('SYMBOL') || null,
      consequence: mapped.get('IMPACT') || null,
      func: mapped.get('Consequence') || null,
      transcript: mapped.get('Feature') || null,
      cdna: mapped.get('HGVSc') || null,
      aa_change: mapped.get('HGVSp') || null,
      gnomad_af: numberOrNull(mapped.get('gnomADe_AF') || mapped.get('gnomADg_AF')),
      cadd: numberOrNull(mapped.get('CADD_PHRED')),
      clinvar: mapped.get('ClinVar_CLNSIG') || null
    }
  }
  return {}
}

function parseAnn(info, alt, ref) {
  const raw = info.get('ANN')
  if (raw === undefined || raw === '') return {}
  for (const entry of raw.split(',')) {
    const parts = entry.split('|')
    if (!matchesAllele(parts[ANN.allele] ?? '', alt, ref)) continue
    return {
      gene_symbol: parts[ANN.gene] || null,
      consequence: parts[ANN.impact] || null,
      func: parts[ANN.annotation] || null,
      transcript: parts[ANN.transcript] || null,
      cdna: parts[ANN.hgvsc] || null,
      aa_change: parts[ANN.hgvsp] || null
    }
  }
  return {}
}

function fallbackInfoFields(info) {
  return {
    gnomad_af: numberOrNull(
      info.get('gnomADe_AF') ?? info.get('gnomADg_AF') ?? info.get('gnomAD_AF') ?? info.get('AF')
    ),
    cadd: numberOrNull(
      info.get('CADD_phred') ?? info.get('dbNSFP_CADD_phred') ?? info.get('CADD_PHRED')
    ),
    clinvar: info.get('CLNSIG') ?? info.get('CLINVAR_CLNSIG') ?? info.get('ClinVar_CLNSIG') ?? null
  }
}

export async function parseVcfToVariants(vcfPath) {
  const raw = createReadStream(vcfPath)
  const stream = vcfPath.endsWith('.gz') ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const variants = []
  let csqFields = []

  for await (const line of rl) {
    if (line.startsWith('##INFO=<ID=CSQ')) {
      csqFields = parseCsqHeader(line)
      continue
    }
    if (line.startsWith('#')) continue
    if (line.trim() === '') continue

    const columns = line.split('\t')
    if (columns.length < 8) continue
    const [chr, posRaw, , ref, altRaw, qualRaw, filterRaw, infoRaw] = columns
    const info = parseInfo(infoRaw)
    const alts = altRaw.split(',')
    for (const alt of alts) {
      const annotation =
        info.has('CSQ') && csqFields.length > 0
          ? parseCsq(info, csqFields, alt, ref)
          : parseAnn(info, alt, ref)
      const fallback = fallbackInfoFields(info)
      variants.push({
        chr,
        pos: Number(posRaw),
        ref,
        alt,
        gene_symbol: annotation.gene_symbol ?? null,
        consequence: annotation.consequence ?? null,
        func: annotation.func ?? null,
        transcript: annotation.transcript ?? null,
        cdna: annotation.cdna ?? null,
        aa_change: annotation.aa_change ?? null,
        gnomad_af: annotation.gnomad_af ?? fallback.gnomad_af,
        cadd: annotation.cadd ?? fallback.cadd,
        clinvar: annotation.clinvar ?? fallback.clinvar,
        qual: numberOrNull(qualRaw),
        filter: filterRaw === '.' ? null : filterRaw
      })
    }
  }

  return variants
}

function toSimpleJson(variants) {
  return { variants }
}

function toObjectJson(fixtureId, variants) {
  return {
    metadata: {
      generatedBy: 'scripts/data-fixtures/transform-vcf-to-varlens-json.mjs',
      fixtureId
    },
    samples: {
      [fixtureId]: {
        variants
      }
    }
  }
}

function toColumnarJson(fixtureId, variants) {
  const header = [
    { id: 'selectedTranscript', type: 'number', label: 'Selected Transcript' },
    { id: 'Chr', type: 'text', label: 'Chromosome' },
    { id: 'Pos', type: 'number', label: 'Position' },
    { id: 'Ref', type: 'text', label: 'Reference' },
    { id: 'Alt', type: 'text', label: 'Alternate' },
    { id: 'Gene', type: 'text', label: 'Gene' },
    { id: 'Consequence', type: 'text', label: 'Impact' },
    { id: 'Func', type: 'text', label: 'Function' },
    { id: 'Transcript', type: 'text', label: 'Transcript' },
    { id: 'CADDPhredScore', type: 'number', label: 'CADD' },
    { id: 'ClinVSig', type: 'text', label: 'ClinVar' },
    { id: 'GnomadAF', type: 'number', label: 'gnomAD AF' }
  ]
  const data = variants.map((variant) => [
    0,
    variant.chr,
    variant.pos,
    variant.ref,
    variant.alt,
    variant.gene_symbol,
    variant.consequence,
    variant.func,
    variant.transcript,
    variant.cadd,
    variant.clinvar,
    variant.gnomad_af
  ])
  return { [fixtureId]: { header, data } }
}

async function writeJson(path, data) {
  await ensureParent(path)
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export async function transformFixture(fixture, manifest, transform) {
  const variants = await parseVcfToVariants(sourceLocalPath(fixture, manifest))
  if (variants.length === 0) {
    throw new Error(`Fixture ${fixture.id} produced zero JSON variants`)
  }
  const outputs = transform.outputs
  await writeJson(resolveRepoPath(outputs.simple), toSimpleJson(variants))
  await writeJson(resolveRepoPath(outputs.object), toObjectJson(fixture.id, variants))
  await writeJson(resolveRepoPath(outputs.columnar), toColumnarJson(fixture.id, variants))
  console.log(`[data:transform] ${fixture.id}:${transform.id} -> ${variants.length} variants`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = await readManifest()
  const fixtures = selectFixtures(manifest, options)
  for (const fixture of fixtures) {
    for (const transform of fixture.transforms ?? []) {
      if (transform.type === 'vcf-to-varlens-json') {
        await transformFixture(fixture, manifest, transform)
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    process.exitCode = 1
  })
}
