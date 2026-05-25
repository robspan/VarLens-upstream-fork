import { DatabaseError } from './errors'

export function assertNotHexLiteralKey(key: string): void {
  // SQLCipher hex-literal syntax is x'<hex>' or X'<hex>'. Reject this prefix
  // before quoting so user input cannot switch PRAGMA key interpretation.
  if (/^[xX]'/.test(key)) {
    throw new DatabaseError("Encryption key cannot start with hex-literal prefix (x'/X').")
  }
}
