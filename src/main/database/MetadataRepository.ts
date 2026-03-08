import { BaseRepository } from './BaseRepository'
import type { CaseMetadata, CohortGroup, CaseHpoTerm } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

export class MetadataRepository extends BaseRepository {
  getCaseMetadata(caseId: number): CaseMetadata | null {
    const result = this.stmt('SELECT * FROM case_metadata WHERE case_id = ?').get(caseId) as
      | CaseMetadata
      | undefined
    return result ?? null
  }

  upsertCaseMetadata(
    caseId: number,
    updates: { affected_status?: string | null; sex?: string | null; notes?: string | null }
  ): CaseMetadata {
    return this.runTransaction(() => {
      const now = Date.now()
      const result = this.stmt(
        `
        INSERT INTO case_metadata (case_id, affected_status, sex, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_id) DO UPDATE SET
          affected_status = COALESCE(excluded.affected_status, affected_status),
          sex = COALESCE(excluded.sex, sex),
          notes = COALESCE(excluded.notes, notes),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        caseId,
        updates.affected_status ?? null,
        updates.sex ?? null,
        updates.notes ?? null,
        now,
        now
      ) as CaseMetadata
      return result
    })
  }

  listCohortGroups(): CohortGroup[] {
    return this.stmt('SELECT * FROM cohort_groups ORDER BY name').all() as CohortGroup[]
  }

  createCohortGroup(name: string, description?: string | null): CohortGroup {
    const now = Date.now()
    const result = this.stmt(
      'INSERT INTO cohort_groups (name, description, created_at) VALUES (?, ?, ?) RETURNING *'
    ).get(name, description ?? null, now) as CohortGroup
    return result
  }

  updateCohortGroup(
    id: number,
    updates: { name?: string; description?: string | null }
  ): CohortGroup {
    try {
      const existing = this.stmt('SELECT * FROM cohort_groups WHERE id = ?').get(id) as
        | CohortGroup
        | undefined
      if (!existing) throw new NotFoundError('CohortGroup', id)

      const setClauses: string[] = []
      const params: (string | number | null)[] = []

      if (updates.name !== undefined) {
        setClauses.push('name = ?')
        params.push(updates.name)
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?')
        params.push(updates.description)
      }

      if (setClauses.length === 0) return existing

      params.push(id)
      const sql = `UPDATE cohort_groups SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`
      const result = this.db.prepare(sql).get(...params) as CohortGroup
      return result
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update cohort group: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  deleteCohortGroup(cohortId: number): void {
    this.stmt('DELETE FROM cohort_groups WHERE id = ?').run(cohortId)
  }

  getCohortGroupByName(name: string): CohortGroup | null {
    const result = this.stmt('SELECT * FROM cohort_groups WHERE name = ?').get(name) as
      | CohortGroup
      | undefined
    return result ?? null
  }

  getCaseCohorts(caseId: number): CohortGroup[] {
    return this.stmt(
      `
      SELECT cg.* FROM cohort_groups cg
      JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
      WHERE ccl.case_id = ?
      ORDER BY cg.name
    `
    ).all(caseId) as CohortGroup[]
  }

  assignCaseCohort(caseId: number, cohortId: number): void {
    this.stmt(
      'INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(caseId, cohortId)
  }

  removeCaseCohort(caseId: number, cohortId: number): void {
    this.stmt('DELETE FROM case_cohort_links WHERE case_id = ? AND cohort_id = ?').run(
      caseId,
      cohortId
    )
  }

  setCaseCohorts(caseId: number, cohortIds: number[]): void {
    this.runTransaction(() => {
      this.stmt('DELETE FROM case_cohort_links WHERE case_id = ?').run(caseId)
      const insert = this.stmt('INSERT INTO case_cohort_links (case_id, cohort_id) VALUES (?, ?)')
      for (const cohortId of cohortIds) {
        insert.run(caseId, cohortId)
      }
    })
  }

  getCaseHpoTerms(caseId: number): CaseHpoTerm[] {
    return this.stmt('SELECT * FROM case_hpo_terms WHERE case_id = ? ORDER BY hpo_id').all(
      caseId
    ) as CaseHpoTerm[]
  }

  assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): CaseHpoTerm {
    const now = Date.now()
    const result = this.stmt(
      `
      INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id, hpo_id) DO UPDATE SET hpo_label = excluded.hpo_label
      RETURNING *
    `
    ).get(caseId, hpoId, hpoLabel, now) as CaseHpoTerm
    return result
  }

  removeCaseHpoTerm(caseId: number, hpoId: string): void {
    this.stmt('DELETE FROM case_hpo_terms WHERE case_id = ? AND hpo_id = ?').run(caseId, hpoId)
  }
}
