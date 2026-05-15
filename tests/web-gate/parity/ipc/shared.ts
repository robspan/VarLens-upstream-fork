import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export type ApiCall = <T>(domain: string, method: string, args?: unknown[]) => Promise<T>

export interface ImportEnvelope {
  caseId: number
  variantCount: number
}

export interface VariantAnchor {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
}

export interface RuntimeContext {
  call: ApiCall
  primaryCaseId: number
  secondaryCaseId: number
  primaryImport: ImportEnvelope
  secondaryImport: ImportEnvelope
  primaryVariant: VariantAnchor
  exportDir: string
}

export interface IpcScenario {
  area: string
  run: (context: RuntimeContext) => Promise<unknown[]>
}

export const PRIMARY_CASE_NAME = 'ipc-parity-primary'

export function rowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw !== null && typeof raw === 'object') {
    const value = raw as { data?: unknown[]; rows?: unknown[] }
    if (Array.isArray(value.data)) return value.data
    if (Array.isArray(value.rows)) return value.rows
  }
  return []
}

export async function normalizeExport(raw: unknown): Promise<unknown> {
  const value = raw as { success?: boolean; filePath?: string; error?: string }
  if (value.filePath === undefined || value.filePath === '') return value
  const content = readFileSync(value.filePath)
  return {
    success: value.success,
    fileBytes: content.byteLength,
    fileHash: createHash('sha256').update(content).digest('hex')
  }
}

export function zipBatchPath(): string {
  return resolve(process.cwd(), 'tests/.cache/public-data/generated/zip/json-batch.zip')
}

export function bedFilePath(): string {
  return resolve(process.cwd(), 'tests/test-data/vcf/test-regions.bed')
}

export function basenames(paths: string[]): string[] {
  return paths.map((path) => basename(path)).sort()
}
