import type { Pool, QueryResult, QueryResultRow } from 'pg'

import type {
  AffectedStatusValue,
  AnalysisGroup,
  AnalysisGroupMember,
  AnalysisGroupRole,
  AnalysisGroupWithMembers
} from '../../database/types'
import { quoteIdentifier } from './identifiers'

interface AnalysisGroupRow extends QueryResultRow {
  id: unknown
  name: unknown
  group_type: unknown
  description: unknown
  created_at: unknown
  updated_at: unknown
}

interface AnalysisGroupMemberRow extends QueryResultRow {
  id: unknown
  group_id: unknown
  case_id: unknown
  role: unknown
  affected_status: unknown
  individual_id: unknown
}

interface GroupIdRow extends QueryResultRow {
  group_id: unknown
}

function rowToGroup(row: AnalysisGroupRow): AnalysisGroup {
  return {
    id: Number(row.id),
    name: String(row.name),
    group_type: row.group_type as AnalysisGroup['group_type'],
    description:
      row.description === null || row.description === undefined ? null : String(row.description),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  }
}

function rowToMember(row: AnalysisGroupMemberRow): AnalysisGroupMember {
  return {
    id: Number(row.id),
    group_id: Number(row.group_id),
    case_id: Number(row.case_id),
    role: row.role as AnalysisGroupRole,
    affected_status: row.affected_status as AffectedStatusValue,
    individual_id:
      row.individual_id === null || row.individual_id === undefined
        ? null
        : String(row.individual_id)
  }
}

export class PostgresAnalysisGroupsRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async listGroups(): Promise<AnalysisGroup[]> {
    const result = await this.pool.query<AnalysisGroupRow>(
      `SELECT * FROM ${this.groupsTable()} ORDER BY created_at DESC`
    )

    return result.rows.map(rowToGroup)
  }

  async createGroup(
    name: string,
    groupType: 'family' | 'tumor_normal' = 'family',
    description?: string
  ): Promise<AnalysisGroup> {
    const now = Date.now()
    const result = await this.pool.query<AnalysisGroupRow>(
      `
        INSERT INTO ${this.groupsTable()} (name, group_type, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [name, groupType, description ?? null, now, now]
    )

    return rowToGroup(firstRow(result, 'Analysis group insert returned no rows'))
  }

  async getGroup(id: number): Promise<AnalysisGroup> {
    const result = await this.pool.query<AnalysisGroupRow>(
      `SELECT * FROM ${this.groupsTable()} WHERE id = $1`,
      [id]
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error(`Analysis group ${id} not found`)
    return rowToGroup(row)
  }

  async getGroupWithMembers(id: number): Promise<AnalysisGroupWithMembers> {
    const group = await this.getGroup(id)
    const members = await this.getMembers(id)
    return { ...group, members }
  }

  async getGroupForCase(caseId: number): Promise<AnalysisGroup | null> {
    const result = await this.pool.query<GroupIdRow>(
      `SELECT group_id FROM ${this.membersTable()} WHERE case_id = $1 LIMIT 1`,
      [caseId]
    )
    const row = result.rows[0]
    if (row === undefined) return null
    return await this.getGroup(Number(row.group_id))
  }

  async updateGroup(
    id: number,
    updates: { name?: string; description?: string | null }
  ): Promise<AnalysisGroup> {
    const group = await this.getGroup(id)
    const description = updates.description === undefined ? group.description : updates.description
    const result = await this.pool.query<AnalysisGroupRow>(
      `
        UPDATE ${this.groupsTable()}
        SET name = $1, description = $2, updated_at = $3
        WHERE id = $4
        RETURNING *
      `,
      [updates.name ?? group.name, description, Date.now(), id]
    )

    return rowToGroup(firstRow(result, `Analysis group ${id} not found`))
  }

  async deleteGroup(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.groupsTable()} WHERE id = $1`, [id])
  }

  async addMember(
    groupId: number,
    caseId: number,
    role: AnalysisGroupRole,
    affectedStatus: AffectedStatusValue = 'unknown',
    individualId?: string
  ): Promise<AnalysisGroupMember> {
    const result = await this.pool.query<AnalysisGroupMemberRow>(
      `
        INSERT INTO ${this.membersTable()}
          (group_id, case_id, role, affected_status, individual_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [groupId, caseId, role, affectedStatus, individualId ?? null]
    )

    return rowToMember(firstRow(result, 'Analysis group member insert returned no rows'))
  }

  async removeMember(groupId: number, caseId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.membersTable()} WHERE group_id = $1 AND case_id = $2`,
      [groupId, caseId]
    )
  }

  async getMembers(groupId: number): Promise<AnalysisGroupMember[]> {
    const result = await this.pool.query<AnalysisGroupMemberRow>(
      `SELECT * FROM ${this.membersTable()} WHERE group_id = $1 ORDER BY role`,
      [groupId]
    )

    return result.rows.map(rowToMember)
  }

  private groupsTable(): string {
    return `${this.schemaName}."analysis_groups"`
  }

  private membersTable(): string {
    return `${this.schemaName}."analysis_group_members"`
  }
}

function firstRow<T extends QueryResultRow>(result: QueryResult<T>, message: string): T {
  const row = result.rows[0]
  if (row === undefined) throw new Error(message)
  return row
}
