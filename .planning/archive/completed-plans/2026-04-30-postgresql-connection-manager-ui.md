# PostgreSQL Connection Manager UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save, test, and open PostgreSQL workspaces from the normal database picker without environment variables.

**Architecture:** Extend the existing `database` IPC domain and Pinia database store. Reuse `PostgresProfileStore`, `buildPostgresStorageConfigFromProfile`, and `DatabaseManager.openPostgresSession`; keep SQLite file lifecycle unchanged.

**Tech Stack:** Electron IPC, TypeScript, Zod runtime validation, Pinia, Vue 3/Vuetify, `pg`, Vitest, Playwright Electron.

---

## Scope

This plan only covers connection profile lifecycle and UI. It may call the existing migration runner during connection if the current storage session path already does so, but deeper migration/security changes belong to `2026-04-30-postgresql-migration-lifecycle-hardening.md`.

## Task 1: Shared Types And IPC Contract

**Files:**

- Modify: `src/shared/types/postgres-profile.ts`
- Modify: `src/shared/ipc/domains/database.ts`
- Modify: `src/preload/domains/database.ts`
- Modify: `tests/shared/types/preload-contract.test.ts`

- [ ] **Step 1: Add a public connection-test result type**

Add this type to `src/shared/types/postgres-profile.ts`:

```ts
export interface PostgresConnectionTestResult {
  ok: boolean
  serverVersion?: string
  currentUser?: string
  database?: string
  schema: string
  currentMigration?: string | null
  message?: string
}
```

- [ ] **Step 2: Extend `DatabaseDomainContract`**

Add these methods to `src/shared/ipc/domains/database.ts`:

```ts
postgresProfilesList: () => Promise<IpcResult<PostgresConnectionProfilePublic[]>>
postgresProfileSave: (
  input: PostgresConnectionProfileInput
) => Promise<IpcResult<PostgresConnectionProfilePublic>>
postgresProfileRemove: (profileId: string) => Promise<IpcResult<DatabaseActionResult>>
postgresProfileTest: (
  input: PostgresConnectionProfileInput
) => Promise<IpcResult<PostgresConnectionTestResult>>
postgresProfileOpen: (profileId: string) => Promise<IpcResult<DatabaseOpenResult>>
```

Import `PostgresConnectionProfileInput`, `PostgresConnectionProfilePublic`, and `PostgresConnectionTestResult` from `../../types/postgres-profile`.

- [ ] **Step 3: Bind methods in preload**

Mirror the contract in `src/preload/domains/database.ts` using existing `ipcRenderer.invoke(...)` patterns. Channel names must be:

```ts
'database:postgresProfilesList'
'database:postgresProfileSave'
'database:postgresProfileRemove'
'database:postgresProfileTest'
'database:postgresProfileOpen'
```

- [ ] **Step 4: Run the contract test**

Run:

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected: PASS.

## Task 2: Profile Validation And Store Operations

**Files:**

- Modify: `src/main/storage/postgres/PostgresProfileStore.ts`
- Create: `src/main/storage/postgres/postgres-profile-validation.ts`
- Test: `tests/main/storage/postgres-profile-store.test.ts`
- Test: `tests/main/storage/postgres-profile-validation.test.ts`

- [ ] **Step 1: Add Zod validation for profile input**

Create `src/main/storage/postgres/postgres-profile-validation.ts` with a `PostgresConnectionProfileInputSchema` that enforces:

- nonblank `name`, `host`, `database`, `username`, and `schema`;
- `port` integer between 1 and 65535;
- `sslMode` is `disable` or `require-verify`;
- `poolMax` integer between 1 and 32;
- timeout fields are non-negative integers;
- password is nonblank;
- CA certificate is optional but nonblank when supplied.

- [ ] **Step 2: Add tests for invalid inputs**

Create `tests/main/storage/postgres-profile-validation.test.ts` with cases for blank password, invalid port, blank schema, invalid SSL mode, and valid input.

Run:

```bash
npx vitest run tests/main/storage/postgres-profile-validation.test.ts
```

Expected: FAIL before the schema exists, then PASS after implementation.

- [ ] **Step 3: Add profile removal and deterministic update support**

Extend `PostgresProfileStore` with:

```ts
async removeProfile(profileId: string): Promise<void>
async saveProfile(input: PostgresConnectionProfileInput & { id?: string }): Promise<PostgresConnectionProfilePublic>
```

When `id` is provided, update the existing public profile and replace its secrets. When removing, remove the public profile from settings. If the secret store has no delete API, leave secret deletion as best-effort future work and document it in a code comment.

- [ ] **Step 4: Extend store tests**

In `tests/main/storage/postgres-profile-store.test.ts`, add tests that:

- updating a profile keeps one public entry;
- updating replaces password/CA secrets;
- removing a profile deletes it from settings;
- settings JSON never contains password or CA body.

Run:

```bash
npx vitest run tests/main/storage/postgres-profile-store.test.ts tests/main/storage/postgres-profile-validation.test.ts
```

Expected: PASS.

## Task 3: Main IPC Handler Logic

**Files:**

- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/main/ipc/handlers/database-logic.ts`
- Modify: `src/main/ipc/domains/database.ts` if dependencies need wiring
- Modify: `src/main/services/DatabaseManager.ts`
- Test: `tests/main/handlers/database-logic.test.ts`
- Test: `tests/main/handlers/database-handlers.test.ts`

- [ ] **Step 1: Add pure logic helpers**

Add pure functions in `database-logic.ts`:

```ts
listPostgresProfiles(profileStore)
savePostgresProfile(input, profileStore)
removePostgresProfile(profileId, profileStore)
testPostgresProfile(input, dependencies)
openPostgresProfile(profileId, dependencies)
```

Dependencies must be explicit. Do not reach into global state from pure logic.

- [ ] **Step 2: Implement test connection**

`testPostgresProfile` must:

- validate input;
- build config via `buildPostgresStorageConfigFromProfile`;
- create a temporary `pg.Pool`;
- run a lightweight diagnostic query;
- close the pool in `finally`;
- return redacted, user-safe failure messages.

Do not switch the active database.

- [ ] **Step 3: Implement open profile**

`openPostgresProfile` must:

- load public profile and secrets;
- build config;
- create a PostgreSQL pool/session;
- verify health or collect diagnostics;
- open it through `DatabaseManager.openPostgresSession`;
- return `DatabaseOpenResult` with PostgreSQL display info.

- [ ] **Step 4: Register IPC channels**

Add handlers in `src/main/ipc/handlers/database.ts` for all new channels. Validate all untrusted params before calling logic. Return through `wrapHandler`.

- [ ] **Step 5: Add handler tests**

Extend `tests/main/handlers/database-logic.test.ts` and `tests/main/handlers/database-handlers.test.ts` to prove:

- list/save/remove use `PostgresProfileStore`;
- test connection does not call `openPostgresSession`;
- open profile calls `openPostgresSession`;
- validation errors are rejected at the IPC boundary;
- passwords are not logged or returned.

Run:

```bash
npx vitest run tests/main/handlers/database-logic.test.ts tests/main/handlers/database-handlers.test.ts
```

Expected: PASS.

## Task 4: Renderer Store

**Files:**

- Modify: `src/renderer/src/stores/databaseStore.ts`
- Test: `tests/renderer/stores/databaseStore.test.ts`

- [ ] **Step 1: Add PostgreSQL profile state**

Add:

```ts
const postgresProfiles = ref<PostgresConnectionProfilePublic[]>([])
const isTestingPostgres = ref(false)
```

- [ ] **Step 2: Add store actions**

Add actions:

```ts
fetchPostgresProfiles()
savePostgresProfile(input)
removePostgresProfile(profileId)
testPostgresProfile(input)
openPostgresProfile(profileId)
```

`openPostgresProfile` must mirror `openDatabase`: set loading, update current info, load capabilities, refresh recents/profile list.

- [ ] **Step 3: Add tests**

Extend `tests/renderer/stores/databaseStore.test.ts` to assert:

- profiles list loads through `window.api.database.postgresProfilesList`;
- test does not mutate current database state;
- open profile updates `currentName`, `currentPath`, capabilities, and profiles.

Run:

```bash
npx vitest run tests/renderer/stores/databaseStore.test.ts
```

Expected: PASS.

## Task 5: Connection Dialog And Picker UI

**Files:**

- Create: `src/renderer/src/components/PostgresConnectionDialog.vue`
- Modify: `src/renderer/src/components/DatabasePicker.vue`
- Test: `tests/renderer/components/PostgresConnectionDialog.test.ts`
- Test: `tests/renderer/components/DatabasePicker.test.ts`

- [ ] **Step 1: Build the dialog**

Create a Vuetify dialog with fields for the required profile data. Use existing compact form patterns from `CreateDatabaseDialog.vue`. Use icon buttons and tooltips for test/save/connect actions where practical.

Validation rules:

- required fields cannot be blank;
- port and pool size are numeric;
- password is required for new profiles;
- CA certificate is visible only when SSL mode is `require-verify`.

- [ ] **Step 2: Add picker section**

In `DatabasePicker.vue`, add a `PostgreSQL Workspaces` section:

- saved profiles list;
- connect action;
- edit action;
- remove action;
- add PostgreSQL action.

Keep SQLite recent files and file actions unchanged.

- [ ] **Step 3: Add renderer tests**

Tests must verify:

- profile list renders separately from recent SQLite files;
- add opens the dialog;
- test connection calls store test action and shows success/error;
- connect emits `database-switched`;
- remove does not call file delete.

Run:

```bash
npx vitest run tests/renderer/components/PostgresConnectionDialog.test.ts tests/renderer/components/DatabasePicker.test.ts
```

Expected: PASS.

## Task 6: Dockerized Connection E2E

**Files:**

- Create: `tests/e2e/postgres-connection-ui-dev-mode.e2e.ts`
- Modify: `tests/e2e/helpers/electron-app.ts` only if a helper is needed

- [ ] **Step 1: Add E2E seed precondition**

Use the same PostgreSQL Docker env as existing PG E2Es. The test must skip unless `VARLENS_RUN_POSTGRES_E2E=1`.

- [ ] **Step 2: Exercise the UI**

The E2E must:

- launch without `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`;
- open the database picker;
- open PostgreSQL connection dialog;
- enter Docker profile values;
- test connection;
- save profile;
- connect;
- assert the toolbar shows `PostgreSQL:`;
- query `window.api.cases.list()` or equivalent and assert seed cases are visible.

- [ ] **Step 3: Run focused E2E**

Run:

```bash
make build
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-connection-ui-dev-mode.e2e.ts --workers=1
```

Expected: PASS.

## Plan Verification

After all tasks:

```bash
make typecheck
npx vitest run tests/main/storage/postgres-profile-store.test.ts tests/main/storage/postgres-profile-validation.test.ts tests/main/handlers/database-logic.test.ts tests/main/handlers/database-handlers.test.ts tests/renderer/stores/databaseStore.test.ts tests/renderer/components/PostgresConnectionDialog.test.ts tests/renderer/components/DatabasePicker.test.ts
make build
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-connection-ui-dev-mode.e2e.ts --workers=1
```

Commit:

```bash
git add src tests
git commit -m "feat(postgres): add connection manager UI"
```
