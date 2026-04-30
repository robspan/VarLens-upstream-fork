# PostgreSQL Dev Monkey Testing

Use this workflow to start a populated local PostgreSQL 18 workspace and exercise it through the Electron app.

## Start The Workspace

From the repository root:

```bash
cp .env.postgres.example .env.postgres.local
make pg-reset
make pg-up
make pg-seed-dev
make rebuild
make dev-postgres
```

`make pg-seed-dev` loads the same development data used by the PostgreSQL E2E flow. `make dev-postgres` starts the app with the PostgreSQL profile or environment fallback expected by the dev workflow.
The `dev-postgres` target loads `.env.postgres.local` before launching the app.

## Hosted Smoke Gate

After the workspace is up and seeded, run the focused hosted smoke gate:

```bash
make build
make pg-hosted-smoke
```

The smoke test reads `.env.postgres.local` by default and connects through the PostgreSQL profile UI.

## UI Monkey Test Path

In the app:

1. Open the database picker.
2. Add a PostgreSQL workspace.
3. Test the connection.
4. Save the profile.
5. Connect to the saved PostgreSQL workspace.
6. Verify the seeded cases are visible.
7. Open variants and confirm filtering/searching works on the seeded data.
8. Add and remove shortlist entries.
9. Open cohort views and confirm cohort data loads.
10. Export data and confirm the export completes.

Cover the main navigation paths while connected to PostgreSQL: cases, variants, shortlist, cohort, and export.

## Cleanup

Stop the local PostgreSQL stack when finished:

```bash
make pg-down
```

`.env.postgres.local` and `tests/.cache/` are local-only development files and must not be committed.
