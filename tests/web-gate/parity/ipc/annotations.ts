import type { IpcScenario, RuntimeContext } from './shared'

const ACMG_ALIAS_CASES = [
  { input: 'P', expected: 'Pathogenic' },
  { input: 'LP', expected: 'Likely pathogenic' },
  { input: 'VUS', expected: 'Uncertain significance' },
  { input: 'LB', expected: 'Likely benign' },
  { input: 'B', expected: 'Benign' }
] as const

async function expectRejected(call: () => Promise<unknown>): Promise<{ rejected: true }> {
  try {
    await call()
  } catch {
    return { rejected: true }
  }
  throw new Error('Expected annotation call to be rejected')
}

function expectGlobalClassification(value: unknown, expected: string): unknown {
  const actual = (value as { acmg_classification?: unknown }).acmg_classification
  if (actual !== expected) {
    throw new Error(`Expected global ACMG ${expected}; got ${String(actual)}`)
  }
  return value
}

function expectPerCaseClassification(value: unknown, expected: string): unknown {
  const actual = (value as { perCase?: { acmg_classification?: unknown } | null }).perCase
    ?.acmg_classification
  if (actual !== expected) {
    throw new Error(`Expected per-case ACMG ${expected}; got ${String(actual)}`)
  }
  return value
}

async function runGlobalAliasCase(
  ctx: RuntimeContext,
  input: string,
  expected: string
): Promise<unknown[]> {
  await ctx.call('annotations', 'upsertGlobal', [
    ctx.primaryVariant.chr,
    ctx.primaryVariant.pos,
    ctx.primaryVariant.ref,
    ctx.primaryVariant.alt,
    {
      acmg_classification: input,
      global_comment: `Global ${input} alias parity`
    }
  ])
  return [
    expectGlobalClassification(
      await ctx.call('annotations', 'getGlobal', [
        ctx.primaryVariant.chr,
        ctx.primaryVariant.pos,
        ctx.primaryVariant.ref,
        ctx.primaryVariant.alt
      ]),
      expected
    )
  ]
}

async function runPerCaseAliasCase(
  ctx: RuntimeContext,
  input: string,
  expected: string
): Promise<unknown[]> {
  await ctx.call('annotations', 'upsertPerCase', [
    ctx.primaryCaseId,
    ctx.primaryVariant.id,
    {
      acmg_classification: input,
      per_case_comment: `Per-case ${input} alias parity`
    }
  ])
  return [
    expectPerCaseClassification(
      await ctx.call('annotations', 'getForVariant', [
        ctx.primaryCaseId,
        ctx.primaryVariant.chr,
        ctx.primaryVariant.pos,
        ctx.primaryVariant.ref,
        ctx.primaryVariant.alt
      ]),
      expected
    )
  ]
}

function expectUpsertReturned(value: unknown, label: string): unknown {
  // Both Postgres and SQLite executors return a non-null value for a successful
  // upsert (row object or change count). Null/undefined indicates no write occurred.
  if (value === null || value === undefined) {
    throw new Error(`${label}: upsert returned nullish — write may not have occurred`)
  }
  return value
}

export const annotationsScenario: IpcScenario = {
  area: 'annotations',
  run: async (ctx) => {
    // --- write coverage: verify upsertGlobal and upsertPerCase return non-null values
    const upsertGlobalResult = await ctx.call('annotations', 'upsertGlobal', [
      ctx.primaryVariant.chr,
      ctx.primaryVariant.pos,
      ctx.primaryVariant.ref,
      ctx.primaryVariant.alt,
      {
        starred: true,
        acmg_classification: 'Pathogenic',
        global_comment: 'Global parity annotation'
      }
    ])
    expectUpsertReturned(upsertGlobalResult, 'upsertGlobal')

    const upsertPerCaseResult = await ctx.call('annotations', 'upsertPerCase', [
      ctx.primaryCaseId,
      ctx.primaryVariant.id,
      {
        starred: true,
        acmg_classification: 'Likely pathogenic',
        per_case_comment: 'Per-case parity'
      }
    ])
    expectUpsertReturned(upsertPerCaseResult, 'upsertPerCase')

    // --- read-back: confirm the writes landed via getGlobal and getForVariant
    const globalReadBack = expectGlobalClassification(
      await ctx.call('annotations', 'getGlobal', [
        ctx.primaryVariant.chr,
        ctx.primaryVariant.pos,
        ctx.primaryVariant.ref,
        ctx.primaryVariant.alt
      ]),
      'Pathogenic'
    )

    const results: unknown[] = [upsertGlobalResult, upsertPerCaseResult, globalReadBack]

    for (const { input, expected } of ACMG_ALIAS_CASES) {
      results.push(...(await runGlobalAliasCase(ctx, input, expected)))
      results.push(...(await runPerCaseAliasCase(ctx, input, expected)))
    }

    results.push(
      await ctx.call('annotations', 'getForVariant', [
        ctx.primaryCaseId,
        ctx.primaryVariant.chr,
        ctx.primaryVariant.pos,
        ctx.primaryVariant.ref,
        ctx.primaryVariant.alt
      ]),
      await expectRejected(async () => {
        await ctx.call('annotations', 'upsertGlobal', [
          ctx.primaryVariant.chr,
          ctx.primaryVariant.pos,
          ctx.primaryVariant.ref,
          ctx.primaryVariant.alt,
          { acmg_classification: 'PATHOGENIC' }
        ])
      }),
      await expectRejected(async () => {
        await ctx.call('annotations', 'upsertPerCase', [
          ctx.primaryCaseId,
          ctx.primaryVariant.id,
          { acmg_classification: 'PATHOGENIC' }
        ])
      })
    )

    return results
  }
}
