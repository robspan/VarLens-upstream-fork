# PostgreSQL Hosted Verification And Dev Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give developers and reviewers a repeatable Dockerized PostgreSQL 18 workflow for monkey testing and hosted-backend smoke verification.

**Architecture:** Keep Docker PostgreSQL as the canonical local hosted profile. Add seed/reset tooling, profile bootstrap docs, and E2Es that run through the same UI connection path as users.

**Tech Stack:** Makefile, Docker Compose, PostgreSQL 18, Playwright Electron, Vitest, shell scripts.

---

## Task 1: Developer Profile Bootstrap Script

**Files:**

- Create: `scripts/postgres/bootstrap-dev-profile.mjs`
- Modify: `package.json` only if adding a script is useful
- Test: `tests/scripts/postgres-bootstrap-dev-profile.test.ts`

- [ ] **Step 1: Add script behavior**

The script must:

- read `.env.postgres.local`;
- derive host, port, database, username, schema, and SSL mode;
- write a redacted JSON preview to stdout;
- optionally write a renderer-test fixture profile file under `tests/.cache/postgres-profile/` when `--write-fixture` is passed;
- never print the password.

- [ ] **Step 2: Add tests**

Tests must use a temporary `.env` file and assert:

- password is not printed;
- host/port/database/schema are parsed;
- `--write-fixture` writes the expected JSON shape.

Run:

```bash
npx vitest run tests/scripts/postgres-bootstrap-dev-profile.test.ts
```

Expected: PASS.

## Task 2: Seeded Monkey-Test Target

**Files:**

- Modify: `Makefile`
- Create: `scripts/postgres/seed-dev-workspace.mjs`
- Test: `tests/scripts/postgres-seed-dev-workspace.test.ts`

- [ ] **Step 1: Add seed command**

Add a Makefile target:

```make
pg-seed-dev:
	node scripts/postgres/seed-dev-workspace.mjs
```

The script must populate the same deterministic small dataset used by PostgreSQL E2Es: at least 3 cases, 6 variants, and built-in shortlist/filter presets after migrations.

- [ ] **Step 2: Add target for monkey-test app launch**

Add a Makefile target:

```make
dev-postgres:
	VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres $(MAKE) dev
```

Keep env fallback because it remains useful for debugging even after UI connection exists.

- [ ] **Step 3: Add tests**

Tests must assert generated seed SQL or seed operations are deterministic and do not require network access.

Run:

```bash
npx vitest run tests/scripts/postgres-seed-dev-workspace.test.ts
```

Expected: PASS.

## Task 3: End-To-End Hosted Smoke Suite

**Files:**

- Create: `tests/e2e/postgres-hosted-workspace-smoke.e2e.ts`
- Modify: `tests/e2e/helpers/electron-app.ts` only if needed

- [ ] **Step 1: Add E2E coverage**

The smoke test must:

- launch without env backend forcing;
- connect through the PostgreSQL profile UI;
- assert schema migration version is visible through diagnostics;
- import or verify seeded cases;
- run variants query;
- run Shortlist;
- run cohort summary;
- export variants to a temp file;
- close and relaunch;
- reconnect from saved profile without reentering public fields.

- [ ] **Step 2: Run focused E2E**

Run:

```bash
make pg-reset
make pg-up
make pg-seed-dev
make build
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-hosted-workspace-smoke.e2e.ts --workers=1
```

Expected: PASS.

## Task 4: Planning Documentation For Manual Monkey Testing

**Files:**

- Create: `.planning/docs/postgresql-dev-monkey-testing.md`

- [ ] **Step 1: Document exact workflow**

The doc must include:

```bash
cp .env.postgres.example .env.postgres.local
make pg-reset
make pg-up
make pg-seed-dev
make rebuild
make dev-postgres
```

Also document the UI path:

- open database picker;
- add PostgreSQL workspace;
- test connection;
- save profile;
- connect;
- verify cases/variants/shortlist/cohort/export.

- [ ] **Step 2: Document cleanup**

Include:

```bash
make pg-down
```

and note that `.env.postgres.local` and `tests/.cache/` are local-only.

## Task 5: Final Hosted Gate Command

**Files:**

- Modify: `Makefile`
- Modify: `.planning/docs/postgresql-dev-monkey-testing.md`

- [ ] **Step 1: Add a focused gate**

Add:

```make
pg-hosted-smoke:
	VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-hosted-workspace-smoke.e2e.ts --workers=1
```

- [ ] **Step 2: Verify gate**

Run:

```bash
make build
make pg-hosted-smoke
```

Expected: PASS when PostgreSQL Docker is up and seeded.

## Plan Verification

After all tasks:

```bash
npx vitest run tests/scripts/postgres-bootstrap-dev-profile.test.ts tests/scripts/postgres-seed-dev-workspace.test.ts
make typecheck
make pg-reset
make pg-up
make pg-seed-dev
make build
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-hosted-workspace-smoke.e2e.ts --workers=1
```

Commit:

```bash
git add Makefile scripts tests .planning/docs
git commit -m "test(postgres): add hosted workspace smoke tooling"
```

