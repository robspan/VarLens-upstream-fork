# PostgreSQL Hosted Workspaces

VarLens can connect to a PostgreSQL workspace for teams that need shared hosted storage. This mode is separate from the default encrypted local SQLite database: the database server is operated by your organization, and VarLens remains a desktop application that connects to that server.

Use this page as an operations checklist before putting a PostgreSQL workspace into routine research or clinical use.

## Security Model

Run VarLens with a dedicated PostgreSQL role that has only the permissions required for application use. Do not use a superuser, database owner, or personal administrator account for day-to-day access.

Recommended role split:

| Role | Purpose | Suggested access |
|------|---------|------------------|
| Application role | Normal VarLens connections | Connect to the database and read/write only the VarLens workspace schema |
| Migration role | Schema upgrades | Own or alter the VarLens schema during controlled upgrades |
| Backup role | Scheduled dumps | Read-only access needed for `pg_dump` |

Keep each team or project in its own database or schema unless your governance model explicitly allows shared schemas. For schema-separated deployments, ensure `search_path` is controlled and that the application role cannot create objects outside the assigned workspace schema.

Store credentials in the operating system credential store where available. Do not put passwords, connection strings with embedded secrets, private keys, or certificate material in shared tickets, screenshots, exported diagnostics, or project notes.

## SSL and Certificates

Hosted deployments should use SSL with certificate verification. In VarLens profile terms, prefer `require-verify` for any networked PostgreSQL service. Use `disable` only for trusted local development environments or isolated test containers.

For certificate-verified connections:

- Use the provider's root CA certificate or your organization's internal CA certificate.
- Rotate certificates before expiry and test a VarLens connection after rotation.
- Keep hostnames stable; certificate verification depends on the hostname matching the certificate.
- Avoid IP-address connections unless the certificate is issued for that address.

If a managed PostgreSQL provider offers multiple SSL modes, choose the mode that validates the server certificate rather than only encrypting the connection.

## Backups

Backups are the operator's responsibility for hosted PostgreSQL workspaces. At minimum, keep automated database or schema dumps and test restores on a schedule.

For a schema-scoped workspace, a typical logical backup is:

```bash
pg_dump --format=custom --schema=workspace_a --file=varlens-workspace-a.dump postgresql://backup_user@db.example.org/varlens
```

For a database-scoped workspace, dump the full database:

```bash
pg_dump --format=custom --file=varlens.dump postgresql://backup_user@db.example.org/varlens
```

Operational guidance:

- Encrypt backups at rest and restrict restore permissions.
- Keep retention long enough to cover accidental deletions discovered after case review.
- Monitor backup job failures and storage exhaustion.
- Test restore into a non-production database before relying on backups for recovery.
- Record the VarLens application version and PostgreSQL server version alongside backup artifacts.

## Restore

Always restore into a new database or schema first. Do not overwrite a production workspace until the restored copy has been validated.

Example schema restore:

```bash
createdb varlens_restore
pg_restore --dbname=varlens_restore --schema=workspace_a varlens-workspace-a.dump
```

After restoring:

1. Connect VarLens to the restored database or schema with a non-production profile.
2. Confirm the expected cases, variants, annotations, and cohort views are present.
3. Run PostgreSQL diagnostics and check the schema and migration status.
4. Only promote the restored workspace after users have stopped writing to the damaged or stale workspace.

For point-in-time recovery on managed PostgreSQL, follow the provider's recovery process, then validate with VarLens before switching users to the recovered instance.

## Connection Pooling

Start with a small VarLens pool size. Hosted PostgreSQL services often enforce low connection limits, and each desktop client can open multiple connections.

Suggested starting points:

| Deployment | Starting pool size |
|------------|--------------------|
| Single analyst desktop | 2-4 |
| Small shared lab database | 2 per active user |
| Managed PostgreSQL with strict limits | Coordinate pool size with the service connection cap |

If PgBouncer or another pooler is used, prefer session pooling unless VarLens has been verified in your environment with transaction pooling. Transaction pooling can break workflows that depend on session state, temporary settings, prepared statements, advisory locks, or per-session timeouts.

Set conservative timeouts so stuck queries fail predictably:

- `connectionTimeoutMillis`: fail quickly when the server is unavailable.
- `statementTimeoutMs`: cap long-running interactive operations.
- `lockTimeoutMs`: avoid waiting indefinitely on schema or write locks.
- `idleInTransactionSessionTimeoutMs`: close abandoned transactions.

## Diagnostics

Use the PostgreSQL diagnostics export when reporting hosted workspace issues. Diagnostic bundles are intended to include operational state such as backend, schema, migration status, health checks, and storage capabilities while redacting credentials.

Before sharing diagnostics:

- Check that hostnames, schema names, usernames, and project labels are acceptable to share with the recipient.
- Do not add screenshots or notes that include passwords, full connection URLs, private keys, or certificate private material.
- Include the symptom, approximate time, VarLens version, PostgreSQL provider, and whether the issue affects one user or all users.

Useful operator checks outside VarLens include:

```sql
SELECT version();
SELECT current_user;
SHOW search_path;
SELECT now() - query_start AS runtime, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start NULLS LAST;
```

For import or query performance reports, include whether the database uses local storage, managed network storage, a connection pooler, or cross-region access. Network latency and provider connection limits can dominate desktop-to-hosted PostgreSQL performance.
