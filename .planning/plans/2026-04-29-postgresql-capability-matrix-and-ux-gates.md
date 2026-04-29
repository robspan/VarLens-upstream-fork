# PostgreSQL Capability Matrix and UX Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a granular backend capability contract and use it to prevent PostgreSQL users from hitting known SQLite-only workflows.

**Architecture:** Extend the storage capability model from a flat set of booleans to a typed nested capability object. Expose it through the existing storage/session path and add renderer-side helper utilities for feature gating before implementing deeper PostgreSQL parity.

**Tech Stack:** TypeScript, Electron IPC, Vue 3, Vitest, existing `StorageSession` and `wrapHandler` patterns.

---

## Files

- Modify: `src/main/storage/types.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `src/main/storage/session.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/shared/ipc/domains/database.ts`
- Modify: `src/preload/domains/database.ts`
- Modify: `src/renderer/src/stores/database.ts`
- Create: `src/renderer/src/utils/backend-capabilities.ts`
- Create: `tests/main/storage/backend-capabilities.test.ts`
- Create: `tests/main/handlers/database-capabilities.test.ts`
- Create: `tests/renderer/backend-capabilities.test.ts`
- Create: `.planning/artifacts/postgres-parity/capability-matrix.md`

## Task 1: Define granular capabilities

- [ ] **Step 1: Write the capability tests**

Create `tests/main/storage/backend-capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { SQLITE_CAPABILITIES } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('backend capabilities', () => {
  it('declares SQLite as the complete local backend', () => {
    expect(SQLITE_CAPABILITIES.backend).toBe('sqlite')
    expect(SQLITE_CAPABILITIES.workspace.localFileLifecycle).toBe(true)
    expect(SQLITE_CAPABILITIES.workspace.encryptionAtRest).toBe(true)
    expect(SQLITE_CAPABILITIES.variants.filterOptions).toBe(true)
    expect(SQLITE_CAPABILITIES.variants.columnMeta).toBe(true)
    expect(SQLITE_CAPABILITIES.export.variants).toBe(true)
  })

  it('declares current PostgreSQL support and known deferrals explicitly', () => {
    expect(POSTGRES_CAPABILITIES.backend).toBe('postgres')
    expect(POSTGRES_CAPABILITIES.workspace.hostedConnectionLifecycle).toBe(true)
    expect(POSTGRES_CAPABILITIES.workspace.migrations).toBe(false)
    expect(POSTGRES_CAPABILITIES.imports.vcf).toBe(true)
    expect(POSTGRES_CAPABILITIES.imports.multiFileVcf).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.query).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.searchQuery).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.legacySearch).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.filterOptions).toBe(false)
    expect(POSTGRES_CAPABILITIES.variants.panelFilters).toBe(false)
    expect(POSTGRES_CAPABILITIES.export.variants).toBe(false)
    expect(POSTGRES_CAPABILITIES.cases.deleteOne).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/main/storage/backend-capabilities.test.ts`

Expected: FAIL because `SQLITE_CAPABILITIES` and `POSTGRES_CAPABILITIES` are not exported and the nested fields do not exist.

- [ ] **Step 3: Replace flat capability type with nested shape**

Modify `src/main/storage/types.ts`:

```ts
export type StorageBackendKind = 'sqlite' | 'postgres'

export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly workspace: {
    readonly localFileLifecycle: boolean
    readonly hostedConnectionLifecycle: boolean
    readonly encryptionAtRest: boolean
    readonly migrations: boolean
    readonly healthDiagnostics: boolean
  }
  readonly cases: {
    readonly list: boolean
    readonly query: boolean
    readonly deleteOne: boolean
    readonly deleteMany: boolean
    readonly deleteAll: boolean
    readonly overview: boolean
  }
  readonly imports: {
    readonly json: boolean
    readonly vcf: boolean
    readonly multiFileVcf: boolean
    readonly bedFilters: boolean
    readonly cancellation: boolean
  }
  readonly variants: {
    readonly query: boolean
    readonly searchQuery: boolean
    readonly legacySearch: boolean
    readonly filterOptions: boolean
    readonly columnMeta: boolean
    readonly typeCounts: boolean
    readonly typesPresent: boolean
    readonly geneSymbols: boolean
    readonly panelFilters: boolean
    readonly tagFilters: boolean
    readonly commentFilters: boolean
    readonly acmgFilters: boolean
    readonly annotationFilters: boolean
    readonly inheritanceFilters: boolean
    readonly analysisGroupFilters: boolean
    readonly phasingFilters: boolean
  }
  readonly workflow: {
    readonly tags: boolean
    readonly annotations: boolean
    readonly caseComments: boolean
    readonly caseMetrics: boolean
    readonly filterPresets: boolean
    readonly panels: boolean
    readonly geneLists: boolean
    readonly regionFiles: boolean
    readonly analysisGroups: boolean
    readonly auditLog: boolean
  }
  readonly cohort: {
    readonly query: boolean
    readonly summary: boolean
    readonly rebuild: boolean
    readonly carriers: boolean
    readonly geneBurden: boolean
    readonly columnMeta: boolean
  }
  readonly export: {
    readonly variants: boolean
    readonly cohort: boolean
    readonly streaming: boolean
  }
}
```

Keep `WorkspaceRef` and `StorageHealth` unchanged.

- [ ] **Step 4: Export SQLite capabilities**

Modify `src/main/storage/sqlite/SqliteStorageSession.ts`:

```ts
export const SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  workspace: {
    localFileLifecycle: true,
    hostedConnectionLifecycle: false,
    encryptionAtRest: true,
    migrations: true,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: true,
    deleteMany: true,
    deleteAll: true,
    overview: true
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: true,
    filterOptions: true,
    columnMeta: true,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: true,
    tagFilters: true,
    commentFilters: true,
    acmgFilters: true,
    annotationFilters: true,
    inheritanceFilters: true,
    analysisGroupFilters: true,
    phasingFilters: true
  },
  workflow: {
    tags: true,
    annotations: true,
    caseComments: true,
    caseMetrics: true,
    filterPresets: true,
    panels: true,
    geneLists: true,
    regionFiles: true,
    analysisGroups: true,
    auditLog: true
  },
  cohort: {
    query: true,
    summary: true,
    rebuild: true,
    carriers: true,
    geneBurden: true,
    columnMeta: true
  },
  export: {
    variants: true,
    cohort: true,
    streaming: true
  }
}
```

- [ ] **Step 5: Export PostgreSQL capabilities**

Modify `src/main/storage/postgres/PostgresStorageSession.ts`:

```ts
export const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  workspace: {
    localFileLifecycle: false,
    hostedConnectionLifecycle: true,
    encryptionAtRest: false,
    migrations: false,
    healthDiagnostics: true
  },
  cases: {
    list: true,
    query: true,
    deleteOne: false,
    deleteMany: false,
    deleteAll: false,
    overview: false
  },
  imports: {
    json: true,
    vcf: true,
    multiFileVcf: true,
    bedFilters: true,
    cancellation: true
  },
  variants: {
    query: true,
    searchQuery: true,
    legacySearch: false,
    filterOptions: false,
    columnMeta: false,
    typeCounts: true,
    typesPresent: true,
    geneSymbols: true,
    panelFilters: false,
    tagFilters: false,
    commentFilters: false,
    acmgFilters: false,
    annotationFilters: false,
    inheritanceFilters: false,
    analysisGroupFilters: false,
    phasingFilters: false
  },
  workflow: {
    tags: false,
    annotations: false,
    caseComments: false,
    caseMetrics: false,
    filterPresets: false,
    panels: false,
    geneLists: false,
    regionFiles: false,
    analysisGroups: false,
    auditLog: false
  },
  cohort: {
    query: false,
    summary: false,
    rebuild: false,
    carriers: false,
    geneBurden: false,
    columnMeta: false
  },
  export: {
    variants: false,
    cohort: false,
    streaming: false
  }
}
```

- [ ] **Step 6: Update old capability references**

Search: `rg "supports[A-Z]|capabilities\.supports" src tests`

Replace old flat property checks with nested equivalents:

```ts
session.capabilities.workspace.localFileLifecycle
session.capabilities.workspace.hostedConnectionLifecycle
session.capabilities.workspace.encryptionAtRest
session.capabilities.cases.deleteOne
```

For `supportsFileBackedWorkerWrites`, use `session.capabilities.cases.deleteOne && session.capabilities.cases.deleteMany` in `src/main/ipc/handlers/cases.ts`.

- [ ] **Step 7: Run focused storage tests**

Run: `npx vitest run tests/main/storage/backend-capabilities.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts`

Expected: PASS.

## Task 2: Expose current capabilities through database IPC

- [ ] **Step 1: Write IPC handler test**

Create `tests/main/handlers/database-capabilities.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { getDatabaseCapabilities } from '../../../src/main/ipc/handlers/database-logic'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('database capabilities logic', () => {
  it('returns capabilities from the current storage session', () => {
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({ capabilities: POSTGRES_CAPABILITIES })
    }))

    expect(getDatabaseCapabilities(getDbManager as never)).toEqual(POSTGRES_CAPABILITIES)
  })
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npx vitest run tests/main/handlers/database-capabilities.test.ts`

Expected: FAIL because `getDatabaseCapabilities` does not exist.

- [ ] **Step 3: Add logic helper**

Modify `src/main/ipc/handlers/database-logic.ts`:

```ts
import type { StorageCapabilities } from '../../storage/types'

export function getDatabaseCapabilities(getDbManager: () => { getCurrentSession: () => { capabilities: StorageCapabilities } }): StorageCapabilities {
  return getDbManager().getCurrentSession().capabilities
}
```

If `database-logic.ts` already has imports, merge the type import and place the function near other read-only database info helpers.

- [ ] **Step 4: Add IPC channel**

Modify `src/main/ipc/handlers/database.ts`:

```ts
import { getDatabaseCapabilities } from './database-logic'

ipcMain.handle('database:capabilities', async () => {
  return wrapHandler(async () => getDatabaseCapabilities(getDbManager))
})
```

- [ ] **Step 5: Update shared domain contract**

Modify `src/shared/ipc/domains/database.ts`:

```ts
import type { StorageCapabilities } from '../../../main/storage/types'

export interface DatabaseDomainContract {
  capabilities: () => Promise<IpcResult<StorageCapabilities>>
}
```

If importing from `main` would violate shared-layer boundaries, move `StorageCapabilities` to `src/shared/types/storage-capabilities.ts` and import that type from main and shared. Prefer the shared type if this test fails.

- [ ] **Step 6: Update preload domain**

Modify `src/preload/domains/database.ts`:

```ts
capabilities: () => ipcRenderer.invoke('database:capabilities')
```

- [ ] **Step 7: Run focused IPC/preload contract tests**

Run: `npx vitest run tests/main/handlers/database-capabilities.test.ts tests/shared/types/preload-contract.test.ts`

Expected: PASS.

## Task 3: Add renderer capability helpers and gates

- [ ] **Step 1: Write renderer helper test**

Create `tests/renderer/backend-capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { getUnsupportedReason, canUseFeature } from '../../src/renderer/src/utils/backend-capabilities'
import { POSTGRES_CAPABILITIES } from '../../src/main/storage/postgres/PostgresStorageSession'

describe('renderer backend capability helpers', () => {
  it('allows supported features', () => {
    expect(canUseFeature(POSTGRES_CAPABILITIES, 'variants.query')).toBe(true)
  })

  it('blocks unsupported PostgreSQL features with a useful reason', () => {
    expect(canUseFeature(POSTGRES_CAPABILITIES, 'variants.filterOptions')).toBe(false)
    expect(getUnsupportedReason(POSTGRES_CAPABILITIES, 'variants.filterOptions')).toContain(
      'not available for PostgreSQL'
    )
  })
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npx vitest run tests/renderer/backend-capabilities.test.ts`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Create `src/renderer/src/utils/backend-capabilities.ts`:

```ts
import type { StorageCapabilities } from '../../../../main/storage/types'

export type CapabilityPath =
  | 'variants.query'
  | 'variants.filterOptions'
  | 'variants.columnMeta'
  | 'variants.panelFilters'
  | 'variants.tagFilters'
  | 'variants.commentFilters'
  | 'variants.acmgFilters'
  | 'cases.deleteOne'
  | 'cases.overview'
  | 'export.variants'
  | 'export.cohort'
  | 'cohort.query'
  | 'workflow.tags'
  | 'workflow.annotations'
  | 'workflow.panels'
  | 'workflow.filterPresets'

const LABELS: Record<CapabilityPath, string> = {
  'variants.query': 'variant browsing',
  'variants.filterOptions': 'variant filter options',
  'variants.columnMeta': 'variant column metadata',
  'variants.panelFilters': 'panel filters',
  'variants.tagFilters': 'tag filters',
  'variants.commentFilters': 'comment filters',
  'variants.acmgFilters': 'ACMG filters',
  'cases.deleteOne': 'case deletion',
  'cases.overview': 'database overview',
  'export.variants': 'variant export',
  'export.cohort': 'cohort export',
  'cohort.query': 'cohort queries',
  'workflow.tags': 'tags',
  'workflow.annotations': 'annotations',
  'workflow.panels': 'panels',
  'workflow.filterPresets': 'filter presets'
}

export function canUseFeature(capabilities: StorageCapabilities, path: CapabilityPath): boolean {
  const [group, key] = path.split('.') as [keyof StorageCapabilities, string]
  const value = capabilities[group]
  if (typeof value !== 'object' || value === null) return false
  return Boolean((value as Record<string, boolean>)[key])
}

export function getUnsupportedReason(
  capabilities: StorageCapabilities,
  path: CapabilityPath
): string | null {
  if (canUseFeature(capabilities, path)) return null
  const backendLabel = capabilities.backend === 'postgres' ? 'PostgreSQL' : 'this backend'
  return `${LABELS[path]} is not available for ${backendLabel} yet.`
}
```

- [ ] **Step 4: Store capabilities in database store**

Modify `src/renderer/src/stores/database.ts` to add state and action:

```ts
capabilities: null as StorageCapabilities | null,

async loadCapabilities() {
  const result = await window.api.database.capabilities()
  this.capabilities = unwrapIpcResult(result)
}
```

Import `StorageCapabilities` and `unwrapIpcResult` using existing renderer patterns.

- [ ] **Step 5: Gate known unsupported UI entry points**

In each relevant view/component, use `getUnsupportedReason` for PostgreSQL-only gaps before invoking IPC:

```ts
const reason = databaseStore.capabilities
  ? getUnsupportedReason(databaseStore.capabilities, 'export.variants')
  : null
if (reason !== null) {
  logService.warn(reason, 'backend-capabilities')
  return
}
```

Apply to export, delete, cohort, panel filters, tag filters, and filter metadata entry points that currently fail under PostgreSQL.

- [ ] **Step 6: Run renderer helper test**

Run: `npx vitest run tests/renderer/backend-capabilities.test.ts`

Expected: PASS.

## Task 4: Create parity matrix artifact

- [ ] **Step 1: Create artifact**

Create `.planning/artifacts/postgres-parity/capability-matrix.md`:

```md
# PostgreSQL Capability Matrix

| Domain | Action | SQLite | PostgreSQL | Gate Required | Priority |
| --- | --- | --- | --- | --- | --- |
| Cases | list | yes | yes | no | done |
| Cases | query | yes | yes | no | done |
| Cases | delete one | yes | no | yes | high |
| Cases | overview | yes | no | yes | high |
| Imports | JSON | yes | yes | no | done |
| Imports | VCF | yes | yes | no | done |
| Variants | query | yes | yes | no | done |
| Variants | filter options | yes | no | yes | high |
| Variants | column metadata | yes | no | yes | high |
| Variants | panel filters | yes | no | yes | high |
| Variants | tag/comment/ACMG filters | yes | no | yes | high |
| Export | variants | yes | no | yes | high |
| Cohort | query | yes | no | yes | medium |
| Workflow | tags | yes | no | yes | high |
| Workflow | annotations | yes | no | yes | high |
| Workflow | panels/gene lists/region files | yes | no | yes | high |
```

- [ ] **Step 2: Commit**

Run:

```bash
git add src/main/storage/types.ts src/main/storage/sqlite/SqliteStorageSession.ts src/main/storage/postgres/PostgresStorageSession.ts src/main/ipc/handlers/database.ts src/main/ipc/handlers/database-logic.ts src/shared/ipc/domains/database.ts src/preload/domains/database.ts src/renderer/src/stores/database.ts src/renderer/src/utils/backend-capabilities.ts tests/main/storage/backend-capabilities.test.ts tests/main/handlers/database-capabilities.test.ts tests/renderer/backend-capabilities.test.ts .planning/artifacts/postgres-parity/capability-matrix.md
git commit -m "feat(postgres): add backend capability matrix"
```
