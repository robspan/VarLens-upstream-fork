import { basename } from 'path'
import type { DatabaseService } from '../database/DatabaseService'

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
  // Extract all case names first
  const fileInfos = filePaths.map((filePath) => {
    const fileName = extractFileName(filePath)
    const caseName = extractCaseName(fileName, stripText)
    return { filePath, fileName, caseName }
  })

  // Single batched query instead of N individual lookups
  const existingNames = db.cases.getExistingCaseNames(fileInfos.map((f) => f.caseName))

  let duplicateCount = 0
  const files: DuplicateCheckItem[] = fileInfos.map(({ filePath, fileName, caseName }) => {
    const isDuplicate = existingNames.has(caseName)
    if (isDuplicate) duplicateCount++
    return { filePath, fileName, caseName, isDuplicate }
  })

  return { files, duplicateCount }
}
