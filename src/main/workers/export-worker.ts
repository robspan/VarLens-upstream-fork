import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import type { ExportMainMessage, ExportWorkerMessage } from '../../shared/types/export-worker'

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Function' },
  { key: 'consequence', header: 'Consequence' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Similarity' },
  { key: 'moi', header: 'MOI' }
]

function postMsg(msg: ExportWorkerMessage): void {
  parentPort?.postMessage(msg)
}

function run(msg: ExportMainMessage & { type: 'start' }): void {
  let db: Database.Database | null = null

  try {
    // Open read-only DB connection in worker (WAL mode supports concurrent reads)
    db = new Database(msg.dbPath, { readonly: true })
    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      const escapedKey = msg.encryptionKey.replace(/'/g, "''")
      db.pragma(`key='${escapedKey}'`)
    }
    db.pragma('journal_mode = WAL')

    // Execute the pre-compiled query from main thread
    const variants = db.prepare(msg.compiledSql).all(...msg.compiledParams) as Record<
      string,
      unknown
    >[]

    const total = variants.length
    postMsg({ type: 'progress', current: 0, total })

    // Build XLSX
    const headers = EXPORT_COLUMNS.map((col) => col.header)
    const rows: (string | number | null)[][] = []

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]
      rows.push(
        EXPORT_COLUMNS.map((col) => {
          const value = variant[col.key]
          if (col.key === 'gnomad_af' && typeof value === 'number') {
            return value.toExponential(2)
          }
          if (col.key === 'cadd' && typeof value === 'number') {
            return value.toFixed(2)
          }
          if (col.key === 'hpo_sim_score' && typeof value === 'number') {
            return value.toFixed(4)
          }
          return (value ?? '') as string | number | null
        })
      )

      // Report progress every 1000 rows
      if ((i + 1) % 1000 === 0) {
        postMsg({ type: 'progress', current: i + 1, total })
      }
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = EXPORT_COLUMNS.map((col) => ({
      wch: col.key === 'aa_change' ? 20 : 15
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Variants')

    // Metadata sheet (includes active filter summary)
    const { filterSummary } = msg
    const metaData: (string | number)[][] = [
      ['Export Information'],
      ['Case Name', msg.caseName],
      ['Total Variants', variants.length],
      ['Export Date', new Date().toISOString()],
      [''],
      ['Active Filters'],
      ...(filterSummary.gene_symbol !== undefined && filterSummary.gene_symbol !== ''
        ? [['Gene', filterSummary.gene_symbol]]
        : []),
      ...(filterSummary.consequences !== undefined && filterSummary.consequences.length > 0
        ? [['Consequences', filterSummary.consequences.join(', ')]]
        : []),
      ...(filterSummary.funcs !== undefined && filterSummary.funcs.length > 0
        ? [['Functions', filterSummary.funcs.join(', ')]]
        : []),
      ...(filterSummary.clinvars !== undefined && filterSummary.clinvars.length > 0
        ? [['ClinVar', filterSummary.clinvars.join(', ')]]
        : []),
      ...(filterSummary.gnomad_af_max !== undefined
        ? [['Max gnomAD AF', filterSummary.gnomad_af_max]]
        : []),
      ...(filterSummary.cadd_min !== undefined ? [['Min CADD', filterSummary.cadd_min]] : [])
    ]
    const metaWs = XLSX.utils.aoa_to_sheet(metaData)
    XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

    // Write file
    XLSX.writeFile(wb, msg.outputFilePath)

    postMsg({
      type: 'complete',
      filePath: msg.outputFilePath,
      rowCount: variants.length
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    postMsg({ type: 'error', error: err.message, stack: err.stack })
  } finally {
    db?.close()
  }
}

// Listen for messages from main thread
parentPort?.on('message', (msg: ExportMainMessage) => {
  if (msg.type === 'start') {
    run(msg)
  }
  // Note: cancel is not supported — the entire query+XLSX generation
  // runs synchronously in the worker. The main thread can terminate
  // the worker if cancellation is needed.
})
