import { describe, expect, it, vi } from 'vitest'

import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

function repoWithQueryCapture() {
  const calls: string[] = []
  const paramsByCall: unknown[][] = []
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push(sql)
    paramsByCall.push(params)
    return { rows: sql.includes('COUNT') ? [{ count: 0 }] : [] }
  })
  return {
    repo: new PostgresVariantReadRepository({ query } as never, 'public'),
    calls,
    paramsByCall
  }
}

describe('PostgreSQL clinical variant filters', () => {
  it('supports precomputed panel interval filters', async () => {
    const { repo, calls, paramsByCall } = repoWithQueryCapture()

    await repo.queryVariants(
      {
        case_id: 1,
        panel_intervals: [
          { chr: '1', start: 100, end: 200 },
          { chr: '2', start: 300, end: 400 }
        ]
      },
      25
    )

    const sql = calls.join('\n')
    expect(sql).toContain('COALESCE(v.end_pos, v.pos)')
    expect(sql).toContain('v.pos <=')
    expect(sql).toContain('v.chr =')
    expect(paramsByCall[0]).toStrictEqual([1, '1', 100, 200, '2', 300, 400])
  })

  it.skip('supports tag filters after PostgreSQL workflow tables are migrated', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, tag_ids: [7] }, 25)
    expect(calls.join('\n')).toContain('variant_tags')
  })

  it.skip('supports comment filters after PostgreSQL annotation tables are migrated', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, has_comment: true }, 25)
    expect(calls.join('\n')).toContain('case_variant_annotations')
  })

  it.skip('supports ACMG filters after PostgreSQL annotation tables are migrated', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, acmg_classifications: ['Pathogenic'] }, 25)
    expect(calls.join('\n')).toContain('case_variant_annotations')
  })
})
