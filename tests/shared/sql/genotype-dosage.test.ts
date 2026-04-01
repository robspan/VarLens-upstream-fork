import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { GT_DOSAGE_SQL } from '../../../src/shared/sql/genotype-dosage'
import { gtToDosage } from '../../../src/shared/utils/genotype'

describe('GT_DOSAGE_SQL cross-check with gtToDosage', () => {
  let db: InstanceType<typeof Database>

  beforeAll(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE test_gt (gt_num TEXT)')
  })

  afterAll(() => {
    db.close()
  })

  const testCases: Array<[string | null, number | null]> = [
    ['0/0', 0],
    ['0|0', 0],
    ['0/1', 1],
    ['1/0', 1],
    ['0|1', 1],
    ['1|0', 1],
    ['1/1', 2],
    ['1|1', 2],
    ['0', 0],
    ['1', 1],
    ['./.', null],
    ['.|.', null],
    ['.', null],
    [null, null],
  ]

  for (const [gt, expected] of testCases) {
    it(`GT "${gt}" produces dosage ${expected} in both SQL and TS`, () => {
      // TS utility
      const tsResult = gtToDosage(gt)
      expect(tsResult).toBe(expected)

      // SQL CASE
      db.exec('DELETE FROM test_gt')
      db.prepare('INSERT INTO test_gt (gt_num) VALUES (?)').run(gt)
      const row = db.prepare(`SELECT ${GT_DOSAGE_SQL} AS dosage FROM test_gt`).get() as {
        dosage: number | null
      }
      expect(row.dosage).toBe(expected)
    })
  }
})
