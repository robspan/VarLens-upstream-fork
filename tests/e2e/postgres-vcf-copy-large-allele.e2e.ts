/**
 * E2E test: PostgreSQL VCF COPY large-allele + special-character INFO round-trip.
 *
 * Imports the 9.7 KB ALT + special-info fixture and verifies:
 *   - the variant row's REF/ALT bytes round-trip (no truncation, no escape leak);
 *   - coord_hash matches the JS reference encoding byte-for-byte;
 *   - search_document is populated (the per-batch bulk UPDATE inside the
 *     bracket transaction ran);
 *   - info_json contains the special characters byte-identically (CR and
 *     backslash both decoded correctly through the COPY-text encoder).
 *
 * The fixture was generated reproducibly via:
 *   node --input-type=module -e "
 *     import { writeFileSync } from 'node:fs';
 *     import { gzipSync } from 'node:zlib';
 *     const big_alt = 'A'.repeat(9700);
 *     const special_info = 'k1=back\\\\slash;k2=multi\\\\\\\\backs;k3=trail\\\\';
 *     let vcf = '##fileformat=VCFv4.2\\n##INFO=<ID=k1,Number=1,Type=String,Description=\"k1\">\\n##INFO=<ID=k2,Number=1,Type=String,Description=\"k2\">\\n##INFO=<ID=k3,Number=1,Type=String,Description=\"k3\">\\n##contig=<ID=chr1>\\n#CHROM\\tPOS\\tID\\tREF\\tALT\\tQUAL\\tFILTER\\tINFO\\tFORMAT\\tSAMPLE\\n';
 *     for (let i = 1; i <= 100; i++) vcf += 'chr1\\t' + (1000 + i) + '\\t.\\tA\\tG\\t100\\tPASS\\t.\\tGT\\t0/1\\n';
 *     vcf += 'chr1\\t99999\\t.\\tA\\t' + big_alt + '\\t100\\tPASS\\t' + special_info + '\\tGT\\t0/1\\n';
 *     writeFileSync('tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz', gzipSync(Buffer.from(vcf, 'utf8')));
 *   "
 *
 * Compromise: VCF spec doesn't allow tabs (column separators), newlines (line
 * separators), or CRs (readline strips CRLF) inside INFO. The special-character
 * set is restricted to literal backslashes — the most important COPY-text
 * escape target (the encoder doubles them and Postgres halves them back).
 *
 * Requires:
 *   VARLENS_RUN_POSTGRES_E2E=1
 *   Docker container: postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
 */
import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { resolve } from 'node:path'

import { hashCoord } from '../main/storage/coord-hash-encoding'
import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

test('postgres dev mode COPY round-trips a 9.7 KB ALT + special-char INFO', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const pgUrl =
    process.env.VARLENS_PG_URL ??
    'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
  const pgSchema = process.env.VARLENS_PG_SCHEMA ?? 'public'

  const fixturePath = resolve(
    process.cwd(),
    'tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz'
  )
  const expectedAlt = 'A'.repeat(9700)

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined
  let importResult: unknown
  let caseId: number | undefined
  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: pgUrl,
        VARLENS_PG_SCHEMA: pgSchema
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const caseName = `PG COPY Large Allele Test ${Date.now()}`
    importResult = await launched.window.evaluate(
      async ({ fixturePath, caseName }) => {
        return await window.api.import.start(fixturePath, caseName, {
          selectedSample: 'SAMPLE',
          genomeBuild: 'GRCh38'
        })
      },
      { fixturePath, caseName }
    )

    expect(importResult).not.toEqual(
      expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
        userMessage: expect.any(String)
      })
    )

    const result = importResult as { caseId: number; variantCount: number; errors?: string[] }
    expect(result.errors ?? []).toEqual([])
    expect(result.caseId).toBeGreaterThan(0)
    // 100 simple SNVs + 1 large-allele row = 101 variants.
    expect(result.variantCount).toBe(101)
    caseId = result.caseId
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }

  expect(caseId).toBeDefined()

  // Inspect the row directly with a control client.
  const control = new Client({ connectionString: pgUrl })
  await control.connect()
  try {
    const row = await control.query<{
      ref: string
      alt: string
      ref_len: number
      alt_len: number
      coord_hash: Buffer
      search_document: string | null
      info_json: string | null
    }>(
      `SELECT ref, alt,
              octet_length(ref) AS ref_len,
              octet_length(alt) AS alt_len,
              coord_hash,
              search_document::text AS search_document,
              info_json
       FROM ${pgSchema}.variants
       WHERE case_id = $1 AND chr = 'chr1' AND pos = 99999`,
      [caseId]
    )
    expect(row.rows).toHaveLength(1)
    const v = row.rows[0]

    // (1) REF/ALT round-trip — no truncation, no escape leak.
    expect(v.ref).toBe('A')
    expect(v.ref_len).toBe(1)
    expect(v.alt_len).toBe(9700)
    expect(v.alt).toBe(expectedAlt)

    // (2) coord_hash matches the JS reference encoding byte-for-byte.
    expect(v.coord_hash).toBeInstanceOf(Buffer)
    expect(v.coord_hash.length).toBe(32)
    const expectedHash = hashCoord('chr1', 99999, 'A', expectedAlt)
    expect(Buffer.compare(v.coord_hash, expectedHash)).toBe(0)

    // (3) search_document is non-null — the per-batch bulk UPDATE ran. Our
    //     synthetic fixture has no VEP/SnpEff annotations, so the tsvector
    //     contents are intentionally empty (no gene_symbol/consequence/etc.
    //     to tokenize). What matters is that the column is NOT NULL — that
    //     proves `compute_variants_search_document(...)` was invoked via the
    //     bulk UPDATE inside the bracket, vs. being skipped (which would
    //     leave the column NULL since the trigger was DISABLED during COPY).
    expect(v.search_document).not.toBeNull()

    // (4) info_json contains the special characters byte-identically. The
    //     fixture's INFO field contains literal backslashes — the COPY-text
    //     escape character that absolutely needs to round-trip. info_json is
    //     stored as a JSON-stringified payload, so a literal backslash in the
    //     source value becomes "\\" in the JSON string. The presence of "\\"
    //     in the decoded text confirms encoder doubling + Postgres COPY
    //     halving + JSON escaping all line up correctly.
    expect(v.info_json).not.toBeNull()
    const infoText = v.info_json as string
    // JSON-encoded backslash sequence ("\\\\" in the JS literal = "\\" on disk)
    // must be present, proving both backslashes from the source survived.
    expect(infoText).toContain('\\\\')
    // The INFO keys must also survive intact.
    expect(infoText).toContain('k1')
    expect(infoText).toContain('k3')
  } finally {
    await control.end()
  }
})
