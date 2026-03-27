/**
 * Build Gene Reference Database
 *
 * Downloads HGNC gene data and Ensembl BioMart coordinates,
 * then builds a SQLite reference database for gene lookup/autocomplete.
 *
 * Usage: npx tsx scripts/build-gene-reference-db.ts
 * Requires: npm run rebuild:node (so better-sqlite3 works under Node.js)
 */

import Database from 'better-sqlite3-multiple-ciphers'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OUTPUT_PATH = resolve(__dirname, '..', 'resources', 'gene_reference.db')

const HGNC_URL =
  'https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt'

const BIOMART_XML = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Query><Query virtualSchemaName="default" formatter="TSV" header="1" uniqueRows="1" datasetConfigVersion="0.6"><Dataset name="hsapiens_gene_ensembl" interface="default"><Attribute name="hgnc_id"/><Attribute name="chromosome_name"/><Attribute name="start_position"/><Attribute name="end_position"/><Attribute name="strand"/></Dataset></Query>`

const BIOMART_URLS: Record<string, string> = {
  GRCh38: `https://www.ensembl.org/biomart/martservice?query=${encodeURIComponent(BIOMART_XML)}`,
  GRCh37: `https://grch37.ensembl.org/biomart/martservice?query=${encodeURIComponent(BIOMART_XML)}`
}

const VALID_CHROMOSOMES = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  'X',
  'Y',
  'MT'
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string, label: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Downloading ${label}${attempt > 1 ? ` (attempt ${attempt}/${retries})` : ''}...`)
    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      const text = await res.text()
      // BioMart sometimes returns empty, error HTML, or truncated responses
      if (text.trim().length < 1000) {
        throw new Error(
          `Response too short (${text.trim().length} chars): ${text.trim().substring(0, 200)}`
        )
      }
      console.log(`  ${label}: ${(text.length / 1024 / 1024).toFixed(1)} MB`)
      return text
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Failed to download ${label} after ${retries} attempts`, { cause: err })
      }
      console.log(`  Retry ${attempt}/${retries} for ${label}: ${err}`)
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  throw new Error('Unreachable')
}

function parseTsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const headers = lines[0].split('\t')
  const rows = lines.slice(1).map((line) => line.split('\t'))
  return { headers, rows }
}

function colIndex(headers: string[], name: string): number {
  const idx = headers.indexOf(name)
  if (idx === -1) throw new Error(`Column not found: ${name}`)
  return idx
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now()

  // 1. Download data (HGNC in parallel with BioMart; BioMart sequential to avoid server throttling)
  const [hgncText, biomartTexts] = await Promise.all([
    fetchText(HGNC_URL, 'HGNC complete set'),
    (async () => {
      const grch38 = await fetchText(BIOMART_URLS.GRCh38, 'Ensembl BioMart GRCh38')
      const grch37 = await fetchText(BIOMART_URLS.GRCh37, 'Ensembl BioMart GRCh37')
      return { grch38, grch37 }
    })()
  ])
  const grch38Text = biomartTexts.grch38
  const grch37Text = biomartTexts.grch37

  // 2. Parse HGNC
  console.log('Parsing HGNC data...')
  const hgnc = parseTsv(hgncText)
  const hCol = (name: string) => colIndex(hgnc.headers, name)

  const hgncIdIdx = hCol('hgnc_id')
  const symbolIdx = hCol('symbol')
  const nameIdx = hCol('name')
  const statusIdx = hCol('status')
  const locusGroupIdx = hCol('locus_group')
  const ensemblIdx = hCol('ensembl_gene_id')
  const entrezIdx = hCol('entrez_id')
  const omimIdx = hCol('omim_id')
  const aliasSymbolIdx = hCol('alias_symbol')
  const prevSymbolIdx = hCol('prev_symbol')

  // 3. Parse BioMart coordinates
  console.log('Parsing BioMart coordinates...')
  const coordsByAssembly: Record<
    string,
    { hgnc_id: string; chromosome: string; start: number; end: number; strand: string }[]
  > = {}

  for (const [assembly, text] of Object.entries({ GRCh38: grch38Text, GRCh37: grch37Text })) {
    const parsed = parseTsv(text)
    const hIdx = colIndex(parsed.headers, 'HGNC ID')
    const chrIdx = colIndex(parsed.headers, 'Chromosome/scaffold name')
    const startIdx = colIndex(parsed.headers, 'Gene start (bp)')
    const endIdx = colIndex(parsed.headers, 'Gene end (bp)')
    const strandIdx = colIndex(parsed.headers, 'Strand')

    const coords: (typeof coordsByAssembly)[string] = []
    for (const row of parsed.rows) {
      let hgncId = row[hIdx]?.trim()
      const chr = row[chrIdx]?.trim()
      const startPos = parseInt(row[startIdx]?.trim(), 10)
      const endPos = parseInt(row[endIdx]?.trim(), 10)
      const strand = row[strandIdx]?.trim() === '1' ? '+' : '-'

      if (!hgncId || !VALID_CHROMOSOMES.has(chr) || isNaN(startPos) || isNaN(endPos)) continue
      // Normalize HGNC ID: GRCh37 BioMart omits the "HGNC:" prefix
      if (!hgncId.startsWith('HGNC:')) {
        hgncId = `HGNC:${hgncId}`
      }
      coords.push({ hgnc_id: hgncId, chromosome: chr, start: startPos, end: endPos, strand })
    }
    coordsByAssembly[assembly] = coords
    console.log(`  ${assembly}: ${coords.length} valid coordinate entries`)
  }

  // 4. Create database
  console.log('Creating database...')
  const dir = dirname(OUTPUT_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Remove existing DB if present
  if (existsSync(OUTPUT_PATH)) {
    const { unlinkSync } = await import('node:fs')
    unlinkSync(OUTPUT_PATH)
  }

  const db = new Database(OUTPUT_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // 5. Create schema
  db.exec(`
    CREATE TABLE assemblies (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      source_version TEXT,
      built_at INTEGER NOT NULL
    );

    CREATE TABLE genes (
      hgnc_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      name TEXT,
      status TEXT,
      locus_group TEXT,
      ensembl_gene_id TEXT,
      entrez_id TEXT,
      omim_id TEXT
    );

    CREATE TABLE gene_aliases (
      alias TEXT NOT NULL,
      hgnc_id TEXT NOT NULL REFERENCES genes(hgnc_id),
      alias_type TEXT NOT NULL,
      PRIMARY KEY (alias, hgnc_id)
    );

    CREATE TABLE gene_coordinates (
      hgnc_id TEXT NOT NULL REFERENCES genes(hgnc_id),
      assembly TEXT NOT NULL REFERENCES assemblies(id),
      chromosome TEXT NOT NULL,
      start_pos INTEGER NOT NULL,
      end_pos INTEGER NOT NULL,
      strand TEXT NOT NULL,
      PRIMARY KEY (hgnc_id, assembly)
    );

    CREATE INDEX idx_genes_symbol ON genes(symbol);
    CREATE INDEX idx_genes_ensembl ON genes(ensembl_gene_id);
    CREATE INDEX idx_aliases_hgnc ON gene_aliases(hgnc_id);
    CREATE INDEX idx_coords_assembly ON gene_coordinates(assembly);
    CREATE INDEX idx_coords_chr ON gene_coordinates(chromosome, assembly);
  `)

  // 6. Insert assemblies
  const builtAt = Math.floor(Date.now() / 1000)
  const insertAssembly = db.prepare(
    'INSERT INTO assemblies (id, display_name, aliases, source_version, built_at) VALUES (?, ?, ?, ?, ?)'
  )
  insertAssembly.run(
    'GRCh38',
    'GRCh38 / hg38',
    JSON.stringify(['hg38']),
    'Ensembl current',
    builtAt
  )
  insertAssembly.run('GRCh37', 'GRCh37 / hg19', JSON.stringify(['hg19']), 'Ensembl GRCh37', builtAt)

  // 7. Insert genes (in transaction)
  console.log('Inserting genes...')
  const insertGene = db.prepare(`
    INSERT OR IGNORE INTO genes (hgnc_id, symbol, name, status, locus_group, ensembl_gene_id, entrez_id, omim_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO gene_aliases (alias, hgnc_id, alias_type)
    VALUES (?, ?, ?)
  `)

  let geneCount = 0
  let aliasCount = 0

  const insertGenesTx = db.transaction(() => {
    for (const row of hgnc.rows) {
      const hgncId = row[hgncIdIdx]?.trim()
      const symbol = row[symbolIdx]?.trim()
      if (!hgncId || !symbol) continue

      insertGene.run(
        hgncId,
        symbol,
        row[nameIdx]?.trim() || null,
        row[statusIdx]?.trim() || null,
        row[locusGroupIdx]?.trim() || null,
        row[ensemblIdx]?.trim() || null,
        row[entrezIdx]?.trim() || null,
        row[omimIdx]?.trim() || null
      )
      geneCount++

      // Parse alias_symbol (pipe-separated)
      const aliases = row[aliasSymbolIdx]?.trim()
      if (aliases && aliases !== '') {
        for (const alias of aliases.split('|')) {
          const trimmed = alias.trim().replace(/^"|"$/g, '')
          if (trimmed) {
            insertAlias.run(trimmed, hgncId, 'alias_symbol')
            aliasCount++
          }
        }
      }

      // Parse prev_symbol (pipe-separated)
      const prevSymbols = row[prevSymbolIdx]?.trim()
      if (prevSymbols && prevSymbols !== '') {
        for (const prev of prevSymbols.split('|')) {
          const trimmed = prev.trim().replace(/^"|"$/g, '')
          if (trimmed) {
            insertAlias.run(trimmed, hgncId, 'prev_symbol')
            aliasCount++
          }
        }
      }
    }
  })
  insertGenesTx()
  console.log(`  Inserted ${geneCount} genes, ${aliasCount} aliases`)

  // 8. Insert coordinates (in transaction)
  console.log('Inserting coordinates...')
  const insertCoord = db.prepare(`
    INSERT OR IGNORE INTO gene_coordinates (hgnc_id, assembly, chromosome, start_pos, end_pos, strand)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  // Build a set of known HGNC IDs for FK filtering
  const knownGenes = new Set(
    (db.prepare('SELECT hgnc_id FROM genes').all() as { hgnc_id: string }[]).map((r) => r.hgnc_id)
  )

  let coordCount = 0
  let coordSkipped = 0
  const insertCoordsTx = db.transaction(() => {
    for (const [assembly, coords] of Object.entries(coordsByAssembly)) {
      for (const c of coords) {
        if (!knownGenes.has(c.hgnc_id)) {
          coordSkipped++
          continue
        }
        insertCoord.run(c.hgnc_id, assembly, c.chromosome, c.start, c.end, c.strand)
        coordCount++
      }
    }
  })
  insertCoordsTx()
  console.log(
    `  Inserted ${coordCount} coordinate entries (skipped ${coordSkipped} with unknown HGNC IDs)`
  )

  // 9. Create FTS5 indexes
  console.log('Creating FTS5 indexes...')
  db.exec(`
    CREATE VIRTUAL TABLE genes_fts USING fts5(symbol, name, content=genes, content_rowid=rowid);
    INSERT INTO genes_fts(rowid, symbol, name)
      SELECT rowid, symbol, name FROM genes;

    CREATE VIRTUAL TABLE aliases_fts USING fts5(alias, content=gene_aliases, content_rowid=rowid);
    INSERT INTO aliases_fts(rowid, alias)
      SELECT rowid, alias FROM gene_aliases;
  `)

  // 10. Optimize, switch to DELETE journal mode (avoids WAL/SHM files), vacuum, and close
  db.pragma('optimize')
  db.pragma('journal_mode = DELETE')
  db.exec('VACUUM')
  db.close()

  // 11. Print stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const { statSync } = await import('node:fs')
  const fileSize = (statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1)

  console.log('')
  console.log('=== Gene Reference Database Built ===')
  console.log(`  Output:       ${OUTPUT_PATH}`)
  console.log(`  File size:    ${fileSize} MB`)
  console.log(`  Genes:        ${geneCount}`)
  console.log(`  Aliases:      ${aliasCount}`)
  console.log(`  Coordinates:  ${coordCount}`)
  console.log(`  Assemblies:   2 (GRCh38, GRCh37)`)
  console.log(`  Time:         ${elapsed}s`)
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
