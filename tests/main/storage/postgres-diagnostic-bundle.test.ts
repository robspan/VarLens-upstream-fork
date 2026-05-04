import { describe, expect, it } from 'vitest'

import { createPostgresDiagnosticBundle } from '../../../src/main/storage/postgres/PostgresDiagnosticBundle'

describe('PostgresDiagnosticBundle', () => {
  it('redacts secrets from connection labels', () => {
    const bundle = createPostgresDiagnosticBundle({
      appVersion: '1.0.0',
      connectionUrlRedacted: 'postgres://db.example.org/varlens',
      schema: 'public',
      capabilities: { backend: 'postgres' } as never,
      diagnostics: { ok: true, schema: 'public' }
    })

    expect(JSON.stringify(bundle)).not.toContain('password')
    expect(bundle.backend).toBe('postgres')
    expect(bundle.connectionUrlRedacted).toBe('postgres://db.example.org/varlens')
  })
})
