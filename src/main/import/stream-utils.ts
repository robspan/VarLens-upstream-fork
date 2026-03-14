import { createReadStream, openSync, readSync, closeSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import type { Readable } from 'node:stream'

/** Gzip magic number: first two bytes of any gzip file */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])

/**
 * Check if a file is gzip-compressed by reading its magic bytes.
 */
export function isGzipped(filePath: string): boolean {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(2)
    const bytesRead = readSync(fd, buf, 0, 2, 0)
    return bytesRead >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]
  } finally {
    closeSync(fd)
  }
}

/**
 * Create a readable stream that auto-detects gzip compression.
 * Returns a stream of decompressed (or raw) data ready for JSON parsing.
 */
export function createDecompressedStream(filePath: string): Readable {
  const raw = createReadStream(filePath)
  if (isGzipped(filePath)) {
    return raw.pipe(createGunzip())
  }
  return raw
}
