import { BaseRepository } from './BaseRepository'
import type {
  DatabaseOverview,
  OverviewCase,
  OverviewCohortGroup,
  OverviewTag,
  OverviewPhenotype
} from '../../shared/types/database-overview'
import { CohortService } from './cohort'

export class DatabaseOverviewService extends BaseRepository {
  getDatabaseOverview(): DatabaseOverview {
    const cohortService = new CohortService(this.db)
    const summary = cohortService.getCohortSummary()

    const cases = this.stmt(
      `
      SELECT c.id, c.name, c.variant_count, c.created_at, cm.affected_status
      FROM cases c
      LEFT JOIN case_metadata cm ON c.id = cm.case_id
      ORDER BY c.created_at DESC
    `
    ).all() as OverviewCase[]

    const cohortGroups = this.stmt(
      `
      SELECT cg.id, cg.name, cg.description, cg.created_at,
             COUNT(ccl.case_id) as member_count
      FROM cohort_groups cg
      LEFT JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
      GROUP BY cg.id
      ORDER BY cg.name
    `
    ).all() as OverviewCohortGroup[]

    const tags = this.stmt(
      `
      SELECT t.id, t.name, t.color,
             COUNT(vt.variant_id) as usage_count
      FROM tags t
      LEFT JOIN variant_tags vt ON t.id = vt.tag_id
      GROUP BY t.id
      ORDER BY t.name
    `
    ).all() as OverviewTag[]

    const topPhenotypes = this.stmt(
      `
      SELECT hpo_id, hpo_label, COUNT(DISTINCT case_id) as case_count
      FROM case_hpo_terms
      GROUP BY hpo_id, hpo_label
      ORDER BY case_count DESC
      LIMIT 25
    `
    ).all() as OverviewPhenotype[]

    return { summary, cases, cohortGroups, tags, topPhenotypes }
  }
}
