import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { parser } from 'stream-json'
import type { FileFormat, FormatInfo } from './strategies/ImportStrategy'

/**
 * Detect the file format by examining top-level keys in a gzipped JSON file.
 *
 * Returns format type and the relevant case key:
 * - Columnar: first top-level key is the case ID
 * - Object: has 'metadata' and 'samples' keys, extracts first sample ID
 * - Simple: has 'variants' key at top level
 */
export async function detectFormat(filePath: string): Promise<FormatInfo> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

    const topLevelKeys: string[] = []
    let depth = 0
    let resolved = false

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    const resolveFormat = (format: FileFormat, caseKey: string): void => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({ format, caseKey })
    }

    const rejectFormat = (error: Error): void => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(error)
    }

    stream.on('data', (data: { name?: string; value?: unknown }) => {
      if (resolved) return

      // Track depth
      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      // Collect top-level keys
      if (data.name === 'keyValue' && depth === 1) {
        topLevelKeys.push(String(data.value))

        // Check for simple format
        if (topLevelKeys.includes('variants')) {
          resolveFormat('simple', 'variants')
          return
        }

        // Check for object format markers
        if (topLevelKeys.includes('metadata') && topLevelKeys.includes('samples')) {
          resolved = true
          cleanup()
          extractFirstSampleId(filePath)
            .then((sampleId) => {
              resolve({ format: 'object', caseKey: sampleId })
            })
            .catch(reject)
          return
        }

        // Check for unwrapped columnar: data + header at top level
        if (topLevelKeys.includes('data') && topLevelKeys.includes('header')) {
          resolve({ format: 'columnar', caseKey: '', wrapped: false })
          resolved = true
          cleanup()
          return
        }
      }
    })

    stream.on('end', () => {
      if (resolved) return

      if (topLevelKeys.length === 0) {
        rejectFormat(new Error('Could not detect file format: no top-level keys found'))
        return
      }

      if (topLevelKeys.includes('variants')) {
        resolveFormat('simple', 'variants')
      } else if (topLevelKeys.includes('metadata') || topLevelKeys.includes('samples')) {
        resolved = true
        extractFirstSampleId(filePath)
          .then((sampleId) => {
            resolve({ format: 'object', caseKey: sampleId })
          })
          .catch(reject)
      } else if (topLevelKeys.includes('data') && topLevelKeys.includes('header')) {
        resolve({ format: 'columnar', caseKey: '', wrapped: false })
      } else {
        resolveFormat('columnar', topLevelKeys[0])
      }
    })

    stream.on('error', rejectFormat)
  })
}

/**
 * Extract the first sample ID from an object format file.
 */
export async function extractFirstSampleId(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

    let inSamples = false
    let sampleId: string | null = null
    let depth = 0
    let resolved = false

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    stream.on('data', (data: { name?: string; value?: unknown }) => {
      if (resolved) return

      if (data.name === 'startObject' || data.name === 'startArray') {
        depth++
      } else if (data.name === 'endObject' || data.name === 'endArray') {
        depth--
      }

      if (data.name === 'keyValue' && depth === 1 && data.value === 'samples') {
        inSamples = true
      }

      if (inSamples && data.name === 'keyValue' && depth === 2 && sampleId === null) {
        sampleId = String(data.value)
        resolved = true
        cleanup()
        resolve(sampleId)
      }
    })

    stream.on('end', () => {
      if (resolved) return
      resolved = true
      cleanup()
      if (sampleId !== null) {
        resolve(sampleId)
      } else {
        reject(new Error('Could not extract sample ID from object format JSON'))
      }
    })

    stream.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(err)
    })
  })
}
