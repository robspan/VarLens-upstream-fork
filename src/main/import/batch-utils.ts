import { basename } from 'path'
import type { DatabaseService } from '../database/DatabaseService'
import { NotFoundError } from '../database/errors'

export interface DuplicateCheckItem {
  filePath: string
  fileName: string
  caseName: string
  isDuplicate: boolean
}

/**
 * Extract file name from path
 */
export function extractFileName(filePath: string): string {
  return basename(filePath) || 'unknown'
}

/**
 * Extract case name from file name (strip extensions and optional user text)
 */
export function extractCaseName(fileName: string, stripText?: string): string {
  let name = fileName
  if (name.endsWith('.gz') === true) {
    name = name.slice(0, -3)
  }
  if (name.endsWith('.json') === true) {
    name = name.slice(0, -5)
  }
  if (stripText !== undefined && stripText !== '') {
    name = name.split(stripText).join('').trim()
  }
  return name
}

/**
 * Check which files have duplicate case names in the database.
 */
export function checkDuplicates(
  db: DatabaseService,
  filePaths: string[],
  stripText?: string
): { files: DuplicateCheckItem[]; duplicateCount: number } {
  const files: DuplicateCheckItem[] = []
  let duplicateCount = 0

  for (const filePath of filePaths) {
    const fileName = extractFileName(filePath)
    const caseName = extractCaseName(fileName, stripText)

    let isDuplicate = false
    try {
      db.cases.getCaseByName(caseName)
      isDuplicate = true
      duplicateCount++
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error
      }
    }

    files.push({ filePath, fileName, caseName, isDuplicate })
  }

  return { files, duplicateCount }
}
