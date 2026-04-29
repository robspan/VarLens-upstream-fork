import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import type { PostgresMigration } from './types'

interface MigrationFile {
  version: string
  name: string
  fileName: string
}

const MIGRATION_FILES: readonly MigrationFile[] = [
  { version: '0001', name: 'create_cases', fileName: '0001_create_cases.sql' },
  { version: '0002', name: 'create_case_metadata', fileName: '0002_create_case_metadata.sql' },
  { version: '0003', name: 'create_variants', fileName: '0003_create_variants.sql' },
  {
    version: '0004',
    name: 'generated_search_documents',
    fileName: '0004_generated_search_documents.sql'
  }
]

const SOURCE_SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'sql')

const PACKAGED_SQL_DIR = join(getResourcesPath(), 'postgres-migrations')

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = MIGRATION_FILES.map(
  ({ version, name, fileName }) => {
    const sql = readMigrationSql(fileName)
    return {
      version,
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex')
    }
  }
)

function readMigrationSql(fileName: string): string {
  const filePath = resolveMigrationPath(fileName)
  return readFileSync(filePath, 'utf8')
}

function resolveMigrationPath(fileName: string): string {
  const candidates = [
    join(PACKAGED_SQL_DIR, fileName),
    join(SOURCE_SQL_DIR, fileName),
    resolve(process.cwd(), 'src/main/storage/postgres/migrations/sql', fileName)
  ]

  const filePath = candidates.find((candidate) => existsSync(candidate))
  if (filePath === undefined) {
    throw new Error(`Unable to locate PostgreSQL migration SQL file: ${fileName}`)
  }
  return filePath
}

function getResourcesPath(): string {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
  return processWithResources.resourcesPath ?? process.cwd()
}
