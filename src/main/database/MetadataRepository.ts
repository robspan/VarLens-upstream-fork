import { BaseRepository } from './BaseRepository'
import type {
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition
} from './types'
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

  // ============================================================
  // Case Comment Operations
  // ============================================================

  listCaseComments(caseId: number): CaseComment[] {
    return this.stmt(
      'SELECT * FROM case_comments WHERE case_id = ? ORDER BY created_at DESC, id DESC'
    ).all(caseId) as CaseComment[]
  }

  createCaseComment(caseId: number, category: CommentCategory, content: string): CaseComment {
    const now = Date.now()
    return this.stmt(
      'INSERT INTO case_comments (case_id, category, content, created_at) VALUES (?, ?, ?, ?) RETURNING *'
    ).get(caseId, category, content, now) as CaseComment
  }

  updateCaseComment(commentId: number, content: string): CaseComment {
    const now = Date.now()
    const result = this.stmt(
      'UPDATE case_comments SET content = ?, updated_at = ? WHERE id = ? RETURNING *'
    ).get(content, now, commentId) as CaseComment | undefined

    if (!result) {
      throw new NotFoundError('CaseComment', commentId)
    }
    return result
  }

  deleteCaseComment(commentId: number): void {
    const result = this.stmt('DELETE FROM case_comments WHERE id = ?').run(commentId)
    if (result.changes === 0) {
      throw new NotFoundError('CaseComment', commentId)
    }
  }

  // ============================================================
  // Metric Definition Operations
  // ============================================================

  listMetricDefinitions(): MetricDefinition[] {
    return this.stmt(
      'SELECT * FROM metric_definitions ORDER BY category, name'
    ).all() as MetricDefinition[]
  }

  createMetricDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): MetricDefinition {
    const now = Date.now()
    return this.stmt(
      'INSERT INTO metric_definitions (name, value_type, unit, category, is_predefined, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING *'
    ).get(name, valueType, unit, category, now) as MetricDefinition
  }

  // ============================================================
  // Case Metric Operations
  // ============================================================

  listCaseMetrics(caseId: number): CaseMetricWithDefinition[] {
    return this.stmt(
      `
      SELECT cm.*, md.name, md.value_type, md.unit, md.category AS metric_category
      FROM case_metrics cm
      JOIN metric_definitions md ON cm.metric_id = md.id
      WHERE cm.case_id = ?
      ORDER BY md.category, md.name
    `
    ).all(caseId) as CaseMetricWithDefinition[]
  }

  upsertCaseMetric(
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ): CaseMetric {
    const now = Date.now()
    return this.stmt(
      `
      INSERT INTO case_metrics (case_id, metric_id, numeric_value, text_value, date_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id, metric_id) DO UPDATE SET
        numeric_value = excluded.numeric_value,
        text_value = excluded.text_value,
        date_value = excluded.date_value,
        updated_at = excluded.updated_at
      RETURNING *
    `
    ).get(
      caseId,
      metricId,
      value.numeric_value ?? null,
      value.text_value ?? null,
      value.date_value ?? null,
      now,
      now
    ) as CaseMetric
  }

  deleteCaseMetric(caseId: number, metricId: number): void {
    this.stmt('DELETE FROM case_metrics WHERE case_id = ? AND metric_id = ?').run(caseId, metricId)
  }
}
