/**
 * Gene Reference DB Loader - Singleton for the bundled gene reference database.
 *
 * Handles finding and opening the read-only gene_reference.db that ships
 * with the application. The DB file location differs between development
 * and production builds.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import { GeneReferenceDb } from './GeneReferenceDb'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mainLogger } from '../services/MainLogger'

let instance: GeneReferenceDb | null = null
let rawDb: import('better-sqlite3-multiple-ciphers').Database | null = null

/**
 * Resolve the path to the bundled gene_reference.db file.
 *
 * Path resolution order:
 * 1. Production: process.resourcesPath/gene_reference.db
 * 2. Dev: app.getAppPath()/resources/gene_reference.db
 * 3. Fallback: __dirname/../../resources/gene_reference.db
 */
function resolveDbPath(): string {
  // 1. Production build: extraResources copies to resourcesPath root
  const prodPath = join(process.resourcesPath, 'gene_reference.db')
  if (existsSync(prodPath)) {
    mainLogger.debug(`Gene reference DB found at production path: ${prodPath}`, 'gene-ref')
    return prodPath
  }

  // 2. Dev mode: project root resources/ directory
  const devPath = join(app.getAppPath(), 'resources', 'gene_reference.db')
  if (existsSync(devPath)) {
    mainLogger.debug(`Gene reference DB found at dev path: ${devPath}`, 'gene-ref')
    return devPath
  }

  // 3. Fallback: relative to compiled output
  const fallbackPath = join(__dirname, '..', '..', 'resources', 'gene_reference.db')
  if (existsSync(fallbackPath)) {
    mainLogger.debug(`Gene reference DB found at fallback path: ${fallbackPath}`, 'gene-ref')
    return fallbackPath
  }

  throw new Error(
    `Gene reference database not found. Checked:\n` +
      `  - ${prodPath}\n` +
      `  - ${devPath}\n` +
      `  - ${fallbackPath}`
  )
}

/**
 * Get the singleton GeneReferenceDb instance.
 * Opens the database on first call (lazy initialization).
 */
export function getGeneReferenceDb(): GeneReferenceDb {
  if (instance !== null) return instance

  const dbPath = resolveDbPath()
  mainLogger.info(`Opening gene reference DB: ${dbPath}`, 'gene-ref')

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  rawDb = db
  instance = new GeneReferenceDb(db)

  const info = instance.getInfo()
  mainLogger.info(
    `Gene reference DB loaded: ${info.geneCount} genes, ${info.aliasCount} aliases, ${info.coordinateCount} coordinates`,
    'gene-ref'
  )

  return instance
}

/**
 * Close the gene reference database connection and reset the singleton.
 */
export function closeGeneReferenceDb(): void {
  if (instance === null) return

  try {
    mainLogger.info('Closing gene reference DB', 'gene-ref')
    if (rawDb !== null) {
      rawDb.close()
    }
  } catch (error) {
    mainLogger.error(
      `Error closing gene reference DB: ${error instanceof Error ? error.message : String(error)}`,
      'gene-ref'
    )
  }

  rawDb = null
  instance = null
}
