import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { AssemblyInfo, GeneRefInfo } from '../../shared/types/gene-reference'

interface AssemblyRow {
  id: string
  display_name: string
  aliases: string
  source_version: string | null
}

interface CountRow {
  c: number
}

interface BuiltAtRow {
  built_at: number
}

export interface WebGeneReferenceDb {
  getInfo: () => GeneRefInfo
  getAssemblies: () => AssemblyInfo[]
}

let instance: WebGeneReferenceDb | null = null

function resolveWebGeneReferencePath(): string {
  const explicit = process.env.VARLENS_GENE_REF_DB_PATH
  if (explicit !== undefined && explicit.trim() !== '') return explicit

  const candidates = [
    resolve(process.cwd(), 'resources/gene_reference.db'),
    join(process.resourcesPath ?? '', 'gene_reference.db')
  ]

  const found = candidates.find((candidate) => candidate !== '' && existsSync(candidate))
  if (found !== undefined) return found

  throw new Error(
    `Gene reference database not found for web server. Checked: ${candidates.join(', ')}`
  )
}

function queryJson<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' }).trim()
  if (output === '') return []
  return JSON.parse(output) as T[]
}

function firstCount(dbPath: string, tableName: string): number {
  return queryJson<CountRow>(dbPath, `SELECT COUNT(*) AS c FROM ${tableName}`)[0]?.c ?? 0
}

function createWebGeneReferenceDb(dbPath: string): WebGeneReferenceDb {
  return {
    getInfo() {
      const assemblies = queryJson<{ id: string }>(dbPath, 'SELECT id FROM assemblies').map(
        (row) => row.id
      )
      const builtAt =
        queryJson<BuiltAtRow>(dbPath, 'SELECT built_at FROM assemblies LIMIT 1')[0]?.built_at ?? 0
      return {
        geneCount: firstCount(dbPath, 'genes'),
        aliasCount: firstCount(dbPath, 'gene_aliases'),
        coordinateCount: firstCount(dbPath, 'gene_coordinates'),
        assemblies,
        builtAt
      }
    },
    getAssemblies() {
      return queryJson<AssemblyRow>(
        dbPath,
        'SELECT id, display_name, aliases, source_version FROM assemblies'
      ).map((row) => ({
        id: row.id,
        display_name: row.display_name,
        aliases: JSON.parse(row.aliases) as string[],
        source_version: row.source_version
      }))
    }
  }
}

export function getWebGeneReferenceDb(): WebGeneReferenceDb {
  instance ??= createWebGeneReferenceDb(resolveWebGeneReferencePath())
  return instance
}

export function closeWebGeneReferenceDb(): void {
  instance = null
}
