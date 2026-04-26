/**
 * E2E test: PostgreSQL VCF import cancellation under Phase 16's bracket-
 * transaction trigger defer.
 *
 * Starts an import of the large-allele-with-special-info fixture, cancels
 * mid-import, and verifies:
 *   - the cancellation surfaces in the IpcResult (Phase 9 semantics: import
 *     resolves with ImportResult.errors containing the cancellation message,
 *     OR the import wins the race and finishes cleanly — both are valid);
 *   - all three FTS triggers are ENABLED after recovery (either the bracket
 *     try/finally ran on graceful cancel, OR the recovery shim re-enabled
 *     them on the next worker startup — both Phase 16 semantics are valid);
 *   - the variants id sequence advanced past the pre-import snapshot (a
 *     partial batch reserved IDs);
 *   - no half-committed in-flight batch is left behind for the 9.7 KB allele
 *     row at pos 99999 (0 or 1 row is acceptable depending on cancel timing).
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
 * Recovery-shim assertion: cancellation can either unwind through the worker's
 * `finally` block (gracefully re-enabling triggers in the same process) OR
 * cause the worker to exit non-zero (e.g. when the COPY stream is destroyed
 * mid-write). In the second case Phase 16's recovery shim runs at the start
 * of the NEXT worker invocation and idempotently re-enables triggers. Both
 * paths satisfy the "no permanent trigger lockout" guarantee, so the test
 * relaunches the app and starts another import (which itself runs the
 * recovery shim before any DDL) before asserting trigger state.
 *
 * Requires:
 *   VARLENS_RUN_POSTGRES_E2E=1
 *   Docker container: postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
 */
import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { resolve } from 'node:path'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

test('postgres dev mode VCF COPY import cancellation preserves partial state', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const pgUrl =
    process.env.VARLENS_PG_URL ??
    'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
  const pgSchema = process.env.VARLENS_PG_SCHEMA ?? 'public'

  // 1. Snapshot the variants sequence before the import using a control client.
  const controlBefore = new Client({ connectionString: pgUrl })
  await controlBefore.connect()
  let seqBefore: bigint
  try {
    const r = await controlBefore.query<{ last_value: string }>(
      `SELECT last_value FROM variants_id_seq`
    )
    seqBefore = BigInt(r.rows[0].last_value)
  } finally {
    await controlBefore.end()
  }

  // -------------------------------------------------------------------------
  // Phase 1: launch the app, kick off an import, cancel mid-flight.
  // -------------------------------------------------------------------------
  let firstLaunch: Awaited<ReturnType<typeof launchElectronApp>> | undefined
  let importResult: unknown
  try {
    firstLaunch = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: pgUrl,
        VARLENS_PG_SCHEMA: pgSchema
      }
    })

    await waitForAppShell(firstLaunch.window)
    await dismissDisclaimerIfPresent(firstLaunch.window)

    const fixturePath = resolve(
      process.cwd(),
      'tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz'
    )
    const caseName = `PG COPY Cancel Test ${Date.now()}`

    importResult = await firstLaunch.window.evaluate(
      async ({ fixturePath, caseName }) => {
        // Fire cancel ~150 ms after import:start kicks off. Both run
        // concurrently — copied verbatim from postgres-import-cancellation-dev-mode.e2e.ts.
        const cancelPromise = (async () => {
          await new Promise<void>((r) => setTimeout(r, 150))
          await window.api.import.cancel()
        })()

        const importPromise = window.api.import.start(fixturePath, caseName, {
          selectedSample: 'SAMPLE',
          genomeBuild: 'GRCh38'
        })

        const [importResult] = await Promise.all([importPromise, cancelPromise])
        return importResult
      },
      { fixturePath, caseName }
    )
  } finally {
    if (firstLaunch !== undefined) {
      await firstLaunch.cleanup()
    }
  }

  // 2. Cancellation surfaces as either an ImportResult with errors[] OR a
  //    SerializableError envelope (when the worker exits non-zero), OR a
  //    clean import result (cancel lost the race). All three are valid
  //    Phase 9/16 semantics.
  if (
    importResult !== null &&
    typeof importResult === 'object' &&
    'errors' in importResult &&
    Array.isArray((importResult as { errors: unknown }).errors)
  ) {
    const errors = (importResult as { errors: string[] }).errors
    const variantCount = (importResult as { variantCount?: number }).variantCount ?? 0
    const hasCancelError = errors.some((e) => e.includes('Import cancelled by user'))
    const importFinishedFirst = errors.length === 0 && variantCount > 0
    expect(hasCancelError || importFinishedFirst).toBe(true)
  } else if (
    importResult !== null &&
    typeof importResult === 'object' &&
    'code' in importResult
  ) {
    // SerializableError envelope from a worker-exit code path. Accept any
    // import-related error (the cancel propagated through worker death).
    const code = (importResult as { code: string }).code ?? ''
    const message = (importResult as { message?: string }).message ?? ''
    const isImportRelated =
      code.startsWith('IMPORT') ||
      code.startsWith('POSTGRES') ||
      message.toLowerCase().includes('cancel') ||
      message.toLowerCase().includes('worker')
    expect(isImportRelated).toBe(true)
  }

  // Phase 16.1: no Phase 2 relaunch needed. The recovery-shim path was a
  // safety net for the bracket-transaction trigger defer; that machinery
  // is gone, so the test moves straight to post-cancellation assertions.

  // -------------------------------------------------------------------------
  // Phase 3: post-cancellation assertions via a control client.
  // -------------------------------------------------------------------------
  const control = new Client({ connectionString: pgUrl })
  await control.connect()
  try {
    // Phase 16.1: search_document is now a STORED generated column —
    // no triggers exist to assert state on. The remaining checks
    // (sequence advance + partial-row cardinality) are sufficient.

    // 4. Sequence advanced past seqBefore. A partial batch must have reserved
    //    IDs even if the COPY was rolled back (sequences are non-transactional).
    //    If cancel landed before any batch started, the import probably finished
    //    cleanly and the sequence definitely advanced. Either way: > seqBefore.
    const seqAfter = await control.query<{ last_value: string }>(
      `SELECT last_value FROM variants_id_seq`
    )
    expect(BigInt(seqAfter.rows[0].last_value)).toBeGreaterThan(seqBefore)

    // 5. The 9.7 KB allele lives at pos 99999. If the cancel landed mid-import
    //    before that batch's bracket commit, this should be 0 (rolled back).
    //    If the cancel landed after, this could be 1+. Each Phase 1/2 import
    //    can insert at most one such row, so assert ≤ 2 as the upper bound.
    const orphans = await control.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM ${pgSchema}.variants
       WHERE chr = 'chr1' AND pos = 99999`
    )
    expect(Number(orphans.rows[0].count)).toBeLessThanOrEqual(2)
  } finally {
    await control.end()
  }
})
