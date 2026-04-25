/**
 * JS reference implementation of the postgres `coord_hash` encoding.
 *
 * Mirrors the GENERATED ALWAYS AS expression in
 * `scripts/postgres/init-db/12-phase7-variants.sql`:
 *
 *     digest(
 *       int4send(octet_length(convert_to(chr, 'UTF8'))) || convert_to(chr, 'UTF8') ||
 *       int8send(pos) ||
 *       int4send(octet_length(convert_to(ref, 'UTF8'))) || convert_to(ref, 'UTF8') ||
 *       int4send(octet_length(convert_to(alt, 'UTF8'))) || convert_to(alt, 'UTF8'),
 *       'sha256'
 *     )
 *
 * Both test fixtures and the live-postgres E2E use this helper to construct
 * expected `coord_hash` values. If postgres and JS ever drift, the unit test
 * and the E2E both fail.
 */
import { createHash } from 'node:crypto'

export function encodeCoord(chr: string, pos: number, ref: string, alt: string): Buffer {
  const chrBytes = Buffer.from(chr, 'utf8')
  const refBytes = Buffer.from(ref, 'utf8')
  const altBytes = Buffer.from(alt, 'utf8')

  const out = Buffer.alloc(4 + chrBytes.length + 8 + 4 + refBytes.length + 4 + altBytes.length)
  let offset = 0

  out.writeUInt32BE(chrBytes.length, offset)
  offset += 4
  chrBytes.copy(out, offset)
  offset += chrBytes.length

  out.writeBigInt64BE(BigInt(pos), offset)
  offset += 8

  out.writeUInt32BE(refBytes.length, offset)
  offset += 4
  refBytes.copy(out, offset)
  offset += refBytes.length

  out.writeUInt32BE(altBytes.length, offset)
  offset += 4
  altBytes.copy(out, offset)

  return out
}

export function hashCoord(chr: string, pos: number, ref: string, alt: string): Buffer {
  return createHash('sha256').update(encodeCoord(chr, pos, ref, alt)).digest()
}
