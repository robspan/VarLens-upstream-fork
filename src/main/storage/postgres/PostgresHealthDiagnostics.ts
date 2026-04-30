import type { Pool } from 'pg'

import type { PostgresHealthDiagnosticResult } from '../../../shared/types/postgres-profile'
import { quoteIdentifier } from './identifiers'

export type { PostgresHealthDiagnosticResult }

export class PostgresHealthDiagnostics {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async collect(): Promise<PostgresHealthDiagnosticResult> {
    try {
      const [version, user, migrationRelation, readProbe, writeProbe] = await Promise.all([
        this.pool.query('SELECT version() AS version'),
        this.pool.query('SELECT current_user'),
        this.pool.query(
          `SELECT to_regclass(${literalString(`${this.schemaName}."schema_migrations"`)}) AS relation`
        ),
        this.pool.query(
          `SELECT has_schema_privilege(current_user, $1, 'USAGE') AS can_read_schema`,
          [this.schema]
        ),
        this.pool.query(
          `SELECT has_schema_privilege(current_user, $1, 'CREATE') AS can_write_schema`,
          [this.schema]
        )
      ])
      const migration =
        migrationRelation.rows[0]?.relation === null
          ? { rows: [] }
          : await this.pool.query(
              `SELECT version FROM ${this.schemaName}."schema_migrations" ORDER BY version DESC LIMIT 1`
            )

      return {
        ok: true,
        serverVersion: String(version.rows[0]?.version ?? ''),
        currentUser: String(user.rows[0]?.current_user ?? ''),
        schema: this.schema,
        currentMigration: (migration.rows[0]?.version as string | undefined) ?? null,
        canReadSchema: Boolean(readProbe.rows[0]?.can_read_schema),
        canWriteSchema: Boolean(writeProbe.rows[0]?.can_write_schema)
      }
    } catch (error) {
      return {
        ok: false,
        schema: this.schema,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

function literalString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
