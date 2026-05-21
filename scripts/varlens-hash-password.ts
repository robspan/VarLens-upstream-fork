#!/usr/bin/env tsx
/**
 * Hash a password into the Argon2id PHC string the web bootstrap
 * expects.
 *
 * Usage:
 *
 *   $ npm run varlens:hash-password
 *   Enter password: ********
 *   Confirm:        ********
 *   $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
 *
 *   # Then in the operator environment:
 *   VARLENS_ADMIN_PASSWORD_HASH=$argon2id$v=19$...
 *   VARLENS_ADMIN_PASSWORD=                 # blank the legacy line
 *
 * Why this CLI exists: the web track refuses plaintext credentials
 * for production. The operator generates the Argon2id hash locally
 * with the same `defaultPasswordProvider` the server uses, so the
 * encoded parameters (memoryCost / timeCost / parallelism) are
 * guaranteed to match what `verifyPassword` expects at boot. Pasting
 * a hash from a third-party tool with different params would either
 * silently lock the operator out or accept a weaker hash than policy.
 *
 * No password ever lands on disk: stdin is read with echo disabled
 * (raw mode), the plaintext lives only in this process's memory for
 * the few milliseconds between input and hash, and the result goes
 * straight to stdout for the operator to copy.
 */
import { defaultPasswordProvider } from '../src/main/auth/providers/argon2-provider'

const MIN_PASSWORD_LENGTH = 12

/**
 * Read all of stdin into a line iterator. Used in non-TTY mode so a
 * single-shot pipe like `printf 'pw\npw\n' | varlens:hash-password`
 * works — the previous "read one line at a time, throw away the
 * rest of the buffer" approach lost the second line.
 */
async function bufferStdinLines(): Promise<() => string | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
  let i = 0
  return () => (i < lines.length ? lines[i++] : undefined)
}

/**
 * TTY-mode interactive read with echo suppressed. Honours backspace
 * and Ctrl-C; ignores other control characters.
 */
async function readSecretTty(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  const stdin = process.stdin
  return await new Promise<string>((resolve, reject) => {
    let buf = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const cleanup = (): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
    }
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdout.write('\n')
          cleanup()
          resolve(buf)
          return
        }
        if (ch === '') {
          cleanup()
          process.stdout.write('\n')
          reject(new Error('cancelled'))
          return
        }
        if (ch === '' || ch === '\b') {
          buf = buf.slice(0, -1)
          continue
        }
        if (ch.charCodeAt(0) < 0x20) continue
        buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  process.stderr.write('VarLens admin password — Argon2id hash generator\n')
  process.stderr.write('--------------------------------------------------\n')

  let pw: string
  let confirm: string
  if (process.stdin.isTTY === true) {
    pw = await readSecretTty('Enter password: ')
    confirm = await readSecretTty('Confirm:        ')
  } else {
    const next = await bufferStdinLines()
    pw = next() ?? ''
    confirm = next() ?? ''
  }

  if (pw.length < MIN_PASSWORD_LENGTH) {
    process.stderr.write(
      `Password too short (${pw.length} chars; minimum ${MIN_PASSWORD_LENGTH}).\n`
    )
    process.exit(2)
  }
  if (pw !== confirm) {
    process.stderr.write('Passwords did not match.\n')
    process.exit(2)
  }

  process.stderr.write('Hashing (Argon2id, m=64MB, t=3, p=4)...\n')
  const hash = await defaultPasswordProvider.hashPassword(pw)

  // Hash to stdout, instructions to stderr — so a pipe-into-file
  // captures only the hash.
  process.stdout.write(hash + '\n')
  process.stderr.write('\nDone. Add to your .env:\n')
  process.stderr.write('  VARLENS_ADMIN_PASSWORD_HASH=' + hash + '\n')
  process.stderr.write('And blank the legacy plaintext line:\n')
  process.stderr.write('  VARLENS_ADMIN_PASSWORD=\n')
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
