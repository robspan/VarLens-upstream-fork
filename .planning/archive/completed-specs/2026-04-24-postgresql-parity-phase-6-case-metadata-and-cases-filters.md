# PostgreSQL Parity Phase 6: Case Metadata and Cases Filters

**Date:** 2026-04-24  
**Status:** Completed  
**Depends on:** [Storage Session Boundary Design](./2026-04-23-storage-adapter-boundary-design.md)  
**Previous phase:** [Storage Session Boundary Phase 5: Cases Available Builds](../archive/completed-specs/2026-04-24-storage-session-phase-5-cases-available-builds.md)  
**Goal:** Move the next high-leverage backend slice toward honest PostgreSQL parity, make Docker PostgreSQL validation runnable early, and keep renderer PostgreSQL settings hidden until runtime support is honest.

**Completion note — 2026-04-24:** Implemented and merged via PR #176 (`refactor/postgres-parity-phase-6-case-metadata`). Fresh reconciliation check ran `make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/handlers/case-metadata-routing.test.ts` with 7 files and 38 tests passing.

## Summary

Phase 5 left VarLens with real but narrow PostgreSQL support:

- `cases:list`
- `cases:query`
- `cases:availableBuilds`
- startup via `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`
- PostgreSQL config, health, and capability scaffolding

The code inventory shows that `cases:query` is still partial: PostgreSQL rejects `cohort_ids` and `hpo_ids` filters, and the Docker bootstrap schema only seeds the cases-era table. The next smallest high-leverage Phase 6 slice should therefore complete the case metadata surface and the remaining cases-query filters. However, speed to a usable running backend matters more than a tidy sequential plan, so Phase 6 should be executed as a Docker-first, parallel-lane phase:

- bring up Docker PostgreSQL and run a gated smoke test immediately,
- land the backend executor contract once,
- split independent implementation lanes across PostgreSQL schema/repository work, SQLite executor compatibility, IPC routing, and Docker E2E,
- keep each lane small enough to merge or abandon independently,
- start WGS-scale variant-read design and fixture preparation in parallel only where it does not share write sets with the case metadata slice.

Phase 6 should implement:

1. PostgreSQL schema and repositories for case metadata, cohort groups, case-cohort links, HPO terms, data info, and external IDs.
2. Backend-aware read and write executor coverage for the `case-metadata:*` domain.
3. PostgreSQL support for `cases:query` `cohort_ids` and `hpo_ids` filters.
4. Docker-backed PostgreSQL integration coverage for the new slice, gated outside default CI but runnable as soon as the first Phase 6 checkpoint lands.
5. A parallel WGS-readiness inventory for variants/import scale so Phase 7 can start immediately after Phase 6 without another discovery-only phase.

Renderer storage settings remain out of scope. The fast path is an environment-gated running backend first, then UI exposure after import/export/delete/rebuild and variant/cohort reads are real.

## Fast Iteration Strategy

Phase 6 should optimize for frequent runnable checkpoints:

1. **Checkpoint A: Docker backend boots.** `make pg-reset && make pg-up` initializes the schema and the existing PostgreSQL E2E still passes.
2. **Checkpoint B: Metadata schema is visible in Docker.** The dev container includes metadata/cohort/HPO/data-info/external-ID tables and deterministic seed data.
3. **Checkpoint C: Unit parity is green.** Mocked `pg.Pool` tests cover SQL shape and executor dispatch.
4. **Checkpoint D: IPC works against Docker.** A gated Electron E2E reads and writes metadata through `window.api` while running with `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`.
5. **Checkpoint E: Next WGS work is unblocked.** Variant schema/read-spine and import-scale findings are captured as immediate Phase 7 inputs.

Default CI should not require Docker in Phase 6, but every implementation branch should run the gated Docker path locally when Docker is available. If Docker is unavailable, the implementer must say so explicitly.

## Parallel Work Lanes

After the executor contract lands, implementation can split into independent write sets:

| Lane | Ownership | Write set | Output |
|---|---|---|---|
| A | Docker/schema | `scripts/postgres/init-db/`, `tests/e2e/postgres-*.e2e.ts` | running Docker backend with seeded metadata |
| B | PostgreSQL repositories | `src/main/storage/postgres/PostgresCaseMetadataRepository.ts`, PostgreSQL repository tests | backend SQL and row normalization |
| C | SQLite compatibility executors | `src/main/storage/sqlite/`, SQLite executor tests | unchanged SQLite behavior through new contracts |
| D | IPC/domain routing | `src/main/ipc/handlers/case-metadata*`, handler tests | renderer API reaches active session, not `getDb()` |
| E | Cases filter parity | `PostgresCasesQueryRepository.ts`, cases query tests | `cohort_ids` and `hpo_ids` no longer throw |
| F | WGS-readiness prep | `.planning/artifacts/` notes only, later Phase 7 plan inputs | variant schema/import scale blockers identified without touching runtime code |

Lane F is deliberately planning/artifact-only in Phase 6. It may inspect code and write notes, but it must not start broad variants/import implementation in the same files as the case metadata slice.

## Inventory Method

Inventory was taken from:

- `src/shared/types/db-task.ts`
- `src/main/workers/db-worker-dispatch.ts`
- `src/main/storage/read-executor.ts`
- `src/main/storage/postgres/`
- `src/main/storage/sqlite/`
- `src/main/ipc/handlers/`
- `src/main/ipc/dbPoolManager.ts`
- `src/main/services/DatabaseManager.ts`
- `src/main/database/startup.ts`
- `src/main/workers/import-worker.ts`
- `src/main/workers/export-worker.ts`
- `src/main/workers/delete-worker.ts`
- `src/main/workers/rebuild-summary-worker.ts`

## Current PostgreSQL Status

Implemented:

- `PostgresStorageSession`
- `PostgresReadExecutor`
- `PostgresCaseListRepository`
- `PostgresCasesQueryRepository`
- `PostgresAvailableBuildsRepository`
- environment-gated PostgreSQL startup
- gated Docker dev workflow through `make pg-up`, `make pg-down`, `make pg-reset`, `make pg-psql`
- gated PostgreSQL E2E path through `VARLENS_RUN_POSTGRES_E2E=1`

Important current gaps:

- `PostgresCasesQueryRepository` rejects `cohort_ids` and `hpo_ids`.
- `StorageReadTask` only covers `cases:query` and `cases:availableBuilds`.
- There is no `StorageWriteExecutor`.
- PostgreSQL sessions intentionally throw for `getDatabaseService()`, `getDbPool()`, `getEncryptionKey()`, `needsStartupRebuild()`, and `rekey()`.
- `database:info` returns `null` for PostgreSQL sessions because `DatabaseManager.getCurrentInfo()` is still SQLite file-shaped.
- Docker PostgreSQL bootstrap only creates/seeds the cases table.

## Parity Matrix

| IPC channel or storage operation | Current SQLite implementation | Current worker/pool path | PostgreSQL status | Required repository/service/executor work | Required tests | Blocks user-facing PostgreSQL mode |
|---|---|---|---|---|---|---|
| `cases:list` | `CaseRepository.getAllCases()` | `DbTask` `cases:list`; also `SqliteStorageSession.listCases()` | Implemented through `PostgresCaseListRepository` | Keep as-is; verify against expanded schema | Existing unit and gated Docker E2E | No |
| `cases:query` basic search/sort/page | `CaseRepository.queryCases()` | `DbTask` `cases:query`; `StorageReadTask` `cases:query` | Partially implemented | Keep existing basic PostgreSQL implementation | Existing unit tests | No for basic browsing |
| `cases:query` `cohort_ids` filter | `CaseRepository.queryCases()` joins metadata/cohort tables | `DbTask` `cases:query` | Explicitly unsupported | Extend `PostgresCasesQueryRepository` with cohort filter SQL | Mocked repository tests plus gated Docker E2E | Yes |
| `cases:query` `hpo_ids` filter | `CaseRepository.queryCases()` joins HPO tables | `DbTask` `cases:query` | Explicitly unsupported | Extend `PostgresCasesQueryRepository` with HPO filter SQL | Mocked repository tests plus gated Docker E2E | Yes |
| `cases:availableBuilds` | `CaseRepository.getAvailableGenomeBuilds()` | `DbTask` `cases:availableBuilds`; `StorageReadTask` `cases:availableBuilds` | Implemented through `PostgresAvailableBuildsRepository` | Keep as-is | Existing tests | No |
| `cases:delete` | `deleteSingleCase()` plus `delete-worker.ts` and frequency updates | File-backed worker write with `dbPath` and key | Guarded as SQLite-only | Later backend-aware delete executor with frequency and summary semantics | Delete unit tests, PostgreSQL integration tests | Yes |
| `cases:deleteAll` | `deleteAllCases()` plus `delete-worker.ts` | File-backed worker write | Guarded as SQLite-only | Later backend-aware bulk delete executor | Delete worker parity tests | Yes |
| `cases:deleteBatch` | `deleteBatchCases()` plus `delete-worker.ts` | File-backed worker write | Guarded as SQLite-only | Later backend-aware bulk delete executor | Delete worker parity tests | Yes |
| `case-metadata:get` | `MetadataRepository.getCaseMetadata()` | `DbTask` `case-metadata:get` | Not implemented | Add PostgreSQL case metadata read repository and `StorageReadTask` | Repository, executor, handler tests | Yes |
| `case-metadata:upsert` | `MetadataRepository.upsertCaseMetadata()` | Direct `DatabaseService` | Not implemented | Add `StorageWriteExecutor` and PostgreSQL write method | Write executor and handler tests | Yes |
| `case-metadata:listCohorts` | `MetadataRepository.listCohortGroups()` | `DbTask` `case-metadata:listCohorts` | Not implemented | PostgreSQL cohort group reads | Repository, executor, handler tests | Yes |
| `case-metadata:createCohort` | `MetadataRepository.createCohortGroup()` | Direct `DatabaseService` | Not implemented | PostgreSQL cohort group insert | Write repository and handler tests | Yes |
| `case-metadata:updateCohort` | `MetadataRepository.updateCohortGroup()` | Direct `DatabaseService` | Not implemented | PostgreSQL cohort group update | Write repository and handler tests | Yes |
| `case-metadata:deleteCohort` | `MetadataRepository.deleteCohortGroup()` | Direct `DatabaseService` | Not implemented | PostgreSQL cohort group delete | Write repository and handler tests | Yes |
| `case-metadata:getCohortByName` | `MetadataRepository.getCohortGroupByName()` | `DbTask` `case-metadata:getCohortByName` | Not implemented | PostgreSQL query by name | Repository and executor tests | Yes |
| `case-metadata:getCaseCohorts` | `MetadataRepository.getCaseCohorts()` | `DbTask` `case-metadata:getCaseCohorts` | Not implemented | PostgreSQL case cohort reads | Repository and handler tests | Yes |
| `case-metadata:assignCohort` | `MetadataRepository.assignCaseCohort()` | Direct `DatabaseService` | Not implemented | PostgreSQL insert link | Write repository and handler tests | Yes |
| `case-metadata:removeCohort` | `MetadataRepository.removeCaseCohort()` | Direct `DatabaseService` | Not implemented | PostgreSQL delete link | Write repository and handler tests | Yes |
| `case-metadata:setCohorts` | `MetadataRepository.setCaseCohorts()` | Direct `DatabaseService` | Not implemented | PostgreSQL transactional replace | Write repository and handler tests | Yes |
| `case-metadata:getHpoTerms` | `MetadataRepository.getCaseHpoTerms()` | `DbTask` `case-metadata:getHpoTerms` | Not implemented | PostgreSQL HPO reads | Repository and handler tests | Yes |
| `case-metadata:assignHpoTerm` | `MetadataRepository.assignCaseHpoTerm()` | Direct `DatabaseService` | Not implemented | PostgreSQL HPO insert | Write repository and handler tests | Yes |
| `case-metadata:removeHpoTerm` | `MetadataRepository.removeCaseHpoTerm()` | Direct `DatabaseService` | Not implemented | PostgreSQL HPO delete | Write repository and handler tests | Yes |
| `case-metadata:getDataInfo` | `MetadataRepository.getCaseDataInfo()` | `DbTask` `case-metadata:getDataInfo` | Not implemented | PostgreSQL data info reads | Repository and handler tests | Yes |
| `case-metadata:upsertDataInfo` | `MetadataRepository.upsertCaseDataInfo()` | Direct `DatabaseService` | Not implemented | PostgreSQL upsert | Write repository and handler tests | Yes |
| `case-metadata:listExternalIds` | `MetadataRepository.listCaseExternalIds()` | `DbTask` `case-metadata:listExternalIds` | Not implemented | PostgreSQL external ID reads | Repository and handler tests | Yes |
| `case-metadata:upsertExternalId` | `MetadataRepository.upsertCaseExternalId()` | Direct `DatabaseService` | Not implemented | PostgreSQL upsert | Write repository and handler tests | Yes |
| `case-metadata:deleteExternalId` | `MetadataRepository.deleteCaseExternalId()` | Direct `DatabaseService` | Not implemented | PostgreSQL delete | Write repository and handler tests | Yes |
| `case-metadata:distinctHpoTerms` | `MetadataRepository.getDistinctHpoTerms()` | `DbTask` `case-metadata:distinctHpoTerms` | Not implemented | PostgreSQL distinct HPO query | Repository and handler tests | Yes |
| `case-metadata:distinctPlatforms` | `MetadataRepository.getDistinctPlatforms()` | `DbTask` `case-metadata:distinctPlatforms` | Not implemented | PostgreSQL distinct platform query | Repository and handler tests | Yes |
| `case-metadata:distinctExternalIdTypes` | `MetadataRepository.getDistinctExternalIdTypes()` | `DbTask` `case-metadata:distinctExternalIdTypes` | Not implemented | PostgreSQL distinct external ID query | Repository and handler tests | Yes |
| `case-metadata:getFullMetadata` | `MetadataRepository.getFullCaseMetadata()` returns metadata, cohorts, HPO terms, comments, metrics, data info, and external IDs | `DbTask` `case-metadata:getFullMetadata` | Not implemented | PostgreSQL aggregate metadata method with comments and metrics included | Repository and handler tests | Yes |
| `variants:query` | `VariantRepository.getVariants()` and `VariantFilterBuilder` | `DbTask` `variants:query` | Not implemented | PostgreSQL variant query repository, filter builder, panel interval strategy | Unit, Docker integration, renderer workflow tests | Yes |
| `variants:filterOptions` | `VariantRepository.getFilterOptions()` | `DbTask` `variants:filterOptions` | Not implemented | PostgreSQL column metadata/filter options | Unit and integration tests | Yes |
| `variants:search` | `VariantSearchService` with SQLite FTS5 | `DbTask` `variants:search` | Not implemented; PostgreSQL capability says no FTS | PostgreSQL full-text design or explicit degraded-mode contract | Search parity tests | Yes |
| `variants:geneSymbols` | `VariantSearchService.getGeneSymbols()` | `DbTask` `variants:geneSymbols` | Not implemented | PostgreSQL prefix query | Repository and handler tests | Yes |
| `variants:typeCounts` | `VariantRepository.getVariantTypeCounts()` | `DbTask` `variants:typeCounts` | Not implemented | PostgreSQL count query | Repository and handler tests | Yes |
| `variants:columnMeta` | `VariantRepository.getColumnMeta()` | `DbTask` `variants:columnMeta` | Not implemented | PostgreSQL column metadata repository | Unit and integration tests | Yes |
| `variants:typesPresent` | `VariantRepository.getVariantTypesPresent()` | `DbTask` `variants:typesPresent` | Not implemented | PostgreSQL distinct type query | Unit and handler tests | Yes |
| `variants:shortlist` | `ShortlistService.query()` | Direct `DatabaseService` | Not implemented | PostgreSQL shortlist query or defer until variant query parity | Repository and handler tests | Yes |
| `cohort:variants` | `CohortService.getCohortVariants()` | `DbTask` `cohort:variants` | Not implemented | PostgreSQL cohort summary/variant query path | Unit, integration, perf checks | Yes |
| `cohort:columnMeta` | `CohortService.getColumnMeta()` | `DbTask` `cohort:columnMeta` | Not implemented | PostgreSQL cohort metadata query | Unit and integration tests | Yes |
| `cohort:summary` | `CohortService.getCohortSummary()` | `DbTask` `cohort:summary` | Not implemented | PostgreSQL cohort summary service | Unit and integration tests | Yes |
| `cohort:carriers` | `CohortService.getCarriers()` | `DbTask` `cohort:carriers` | Not implemented | PostgreSQL carrier query | Unit and integration tests | Yes |
| `cohort:geneBurden` | `CohortService.getGeneBurden()` | `DbTask` `cohort:geneBurden` | Not implemented | PostgreSQL gene burden query | Unit and integration tests | Yes |
| `cohort:geneBurdenCompare` | `AssociationEngine` with `AssociationDataBuilder` | `DbTask` `association:build` for off-thread build | Not implemented | PostgreSQL association data builder or backend-neutral export of data build | Statistics parity tests | Yes |
| `cohort:summaryStatus` | `CohortSummaryService.getStatus()` | `DbTask` `cohort:summaryStatus` | Not implemented | PostgreSQL summary metadata status | Unit and integration tests | Yes |
| `cohort:rebuildSummary` | `rebuild-summary-worker.ts` | File-backed SQLite worker | Not implemented | PostgreSQL summary rebuild executor | Worker/executor integration tests | Yes |
| `annotations:getGlobal` | `AnnotationRepository.getGlobalAnnotation()` | `DbTask` `annotations:getGlobal` | Not implemented | PostgreSQL annotation read repository | Unit and handler tests | Yes |
| `annotations:upsertGlobal` | `AnnotationRepository.upsertGlobalAnnotation()` plus audit log | Direct `DatabaseService` | Not implemented | PostgreSQL annotation write plus audit write | Unit and handler tests | Yes |
| `annotations:deleteGlobal` | `AnnotationRepository.deleteGlobalAnnotation()` | Direct `DatabaseService` | Not implemented | PostgreSQL delete | Unit and handler tests | Yes |
| `annotations:getPerCase` | `AnnotationRepository.getPerCaseAnnotation()` | `DbTask` `annotations:getPerCase` | Not implemented | PostgreSQL per-case annotation reads | Unit and handler tests | Yes |
| `annotations:upsertPerCase` | `AnnotationRepository.upsertPerCaseAnnotation()` plus audit log | Direct `DatabaseService` | Not implemented | PostgreSQL write plus audit write | Unit and handler tests | Yes |
| `annotations:deletePerCase` | `AnnotationRepository.deletePerCaseAnnotation()` | Direct `DatabaseService` | Not implemented | PostgreSQL delete | Unit and handler tests | Yes |
| `annotations:getForVariant` | `AnnotationRepository.getAnnotationsForVariant()` | `DbTask` `annotations:getForVariant` | Not implemented | PostgreSQL combined read | Unit and handler tests | Yes |
| `annotations:batchGet` | `AnnotationRepository.getBatch()` | `DbTask` `annotations:batchGet` | Not implemented | PostgreSQL batch read | Unit and handler tests | Yes |
| `tags:list` | `TagRepository.listTags()` | `DbTask` `tags:list` | Not implemented | PostgreSQL tag reads | Unit and handler tests | Yes |
| `tags:create`, `tags:update`, `tags:delete` | `TagRepository` writes | Direct `DatabaseService` | Not implemented | PostgreSQL tag writes | Unit and handler tests | Yes |
| `tags:getUsageCount` | `TagRepository.getTagUsageCount()` | `DbTask` `tags:getUsageCount` | Not implemented | PostgreSQL usage count | Unit and handler tests | Yes |
| `tags:getVariantTags` | `TagRepository.getVariantTags()` | `DbTask` `tags:getVariantTags` | Not implemented | PostgreSQL variant tag reads | Unit and handler tests | Yes |
| `tags:assignVariantTag`, `tags:removeVariantTag`, `tags:setVariantTags` | `TagRepository` writes | Direct `DatabaseService` | Not implemented | PostgreSQL variant tag writes | Unit and handler tests | Yes |
| `transcripts:list` | `TranscriptRepository.getVariantTranscripts()` | `DbTask` `transcripts:list` | Not implemented | PostgreSQL transcript read repository | Unit and handler tests | Yes |
| `transcripts:switch`, `transcripts:insertAndSwitch` | `TranscriptRepository` writes | Direct `DatabaseService` | Not implemented | PostgreSQL transcript writes | Unit and handler tests | Yes |
| `gene-lists:list`, `gene-lists:getGenes` | `GeneListRepository` reads | `DbTask` `gene-lists:list`, `gene-lists:getGenes` | Not implemented | PostgreSQL gene list reads | Unit and handler tests | Yes |
| `gene-lists:create`, `gene-lists:delete`, `gene-lists:setGenes` | `GeneListRepository` writes | Direct `DatabaseService` | Not implemented | PostgreSQL gene list writes | Unit and handler tests | Yes |
| `region-files:list` | `GeneListRepository.listRegionFiles()` | `DbTask` `region-files:list` | Not implemented | PostgreSQL region file reads | Unit and handler tests | Yes |
| `region-files:create`, `region-files:delete`, `region-files:importBed` | `GeneListRepository` writes plus BED file parse | Direct `DatabaseService` | Not implemented | PostgreSQL region file writes and import | Unit and handler tests | Yes |
| `panels:*` | `PanelRepository` reads/writes and gene reference computations | Direct `DatabaseService`; panel interval helper can run in db-worker for variants/cohort | Not implemented | PostgreSQL panel repository or deliberate local-only reference split | Unit, handler, interval tests | Yes for panel filters |
| `analysisGroups:*` | `AnalysisGroupRepository` reads/writes | Direct `DatabaseService` | Not implemented | PostgreSQL analysis group repository | Unit and handler tests | No for basic browsing, yes for analysis group feature |
| `auth:*` | `AuthService` | Direct `DatabaseService` | Not implemented | PostgreSQL auth repository or keep account mode disabled for PG | Unit and handler tests | No if accounts disabled |
| `case-comments:*` | Case comments repository methods on `DatabaseService`; `getFullCaseMetadata()` includes comment reads | Direct `DatabaseService` | Phase 6 includes read support only for `getFullMetadata`; standalone comment CRUD remains not implemented | PostgreSQL comment tables and read methods needed for full metadata shape; standalone CRUD deferred | Repository full-metadata tests | No for basic browsing; yes for honest full metadata |
| `case-metrics:*` | Clinical metrics repository methods on `DatabaseService`; `getFullCaseMetadata()` includes metric reads | Direct `DatabaseService` | Phase 6 includes read support only for `getFullMetadata`; standalone metric CRUD remains not implemented | PostgreSQL metric tables and read methods needed for full metadata shape; standalone CRUD deferred | Repository full-metadata tests | No for basic browsing; yes for honest full metadata |
| `audit:*` | `AuditLogRepository` | Direct `DatabaseService` | Not implemented | PostgreSQL audit log repository | Unit and handler tests | Yes once writes are enabled |
| `presets:*` | `FilterPresetRepository` and `ShortlistService` | Direct `DatabaseService` | Not implemented | PostgreSQL preset repository or local-settings decision | Unit and handler tests | Yes for full filter UX |
| `database:overview` | `DatabaseOverviewService.getDatabaseOverview()` | `DbTask` `database:overview` | Not implemented | Defer until cases metadata, tags, cohort summary, phenotypes are PostgreSQL-backed | Overview service tests after components exist | Yes, but not next |
| `database:open`, `database:create`, `database:selectFile`, `database:selectSaveLocation`, `database:deleteFile`, `database:showInFolder` | SQLite file lifecycle | Mostly direct `DatabaseManager` and file system | SQLite file-only | Keep SQLite-only; PostgreSQL lifecycle is env-gated until UI support is honest | Existing database lifecycle tests plus later storage lifecycle tests | Yes for renderer settings |
| `database:info`, `database:recentList`, `database:removeRecent`, `database:rekey` | SQLite workspace/recent DB/encryption | Direct `DatabaseManager` | PostgreSQL info returns `null`; rekey unsupported | Later backend-neutral workspace info and capability-aware UI | Database handler tests | Yes for renderer settings |
| startup open/close/health/config | SQLite default open plus env-gated PostgreSQL startup | `DatabaseManager`, `openConfiguredDatabase`, `PostgresStorageSession.health()` | Partial; no renderer-facing PG lifecycle | Later storage lifecycle domain and `database:info` shape update | Startup, config, health tests | Yes for renderer settings |
| import single-file JSON/VCF | `ImportWorkerClient` plus `import-worker.ts` | File-backed worker write | Not implemented | Backend-aware import executor; PostgreSQL bulk insert path | Worker and integration tests | Yes |
| import multi-file append | First file worker, later appends on main thread with `VariantRepository` | Mixed worker and direct SQLite write | Not implemented | Backend-aware append and finalization path | Import integration tests | Yes |
| export variants | `prepareVariantExport()` plus `export-worker.ts` | File-backed read worker with compiled SQLite SQL | Not implemented | Backend-aware export executor that does not ship SQLite SQL to PostgreSQL | Export worker tests | Yes |
| export cohort | `CohortService` and XLSX write in main process | Direct SQLite read | Not implemented | PostgreSQL cohort export query path | Export tests | Yes |
| delete all/batch/single | `delete-worker.ts`, `delete-operations.ts`, frequency rebuilds | File-backed worker write | Not implemented | Backend-aware delete executor | Delete tests | Yes |
| summary rebuild | `CohortSummaryService` and `rebuild-summary-worker.ts` | File-backed worker | Not implemented | PostgreSQL summary rebuild SQL and executor | Rebuild tests | Yes |
| external API caches (`vep`, `gnomad`, `myvariant`, `spliceai`, `protein`, `hpo`) | `ApiCache` on `getDb().database` | Direct SQLite cache | Not implemented | Decide local cache vs PostgreSQL cache storage | Cache tests | No for variant data parity, yes for full feature parity |
| local reference data (`gene-ref:*`) | Gene reference DB/resource | No case DB worker | Backend-independent local resource | Keep out of PostgreSQL storage parity | Existing tests | No |
| non-storage domains (`shell:*`, `system:*`, `updater:*`) | OS/Electron services | No database path | Not applicable | None | Existing tests | No |

## Phase 6 Slice Decision

Use Phase 6 for **case metadata and cases-query filter parity**.

Reasons:

- It closes a known gap in the current `cases:query` PostgreSQL implementation.
- It creates PostgreSQL schema for tables that current `PostgresCasesQueryRepository` already joins.
- It introduces backend-aware write execution on a contained domain before larger write paths such as import/delete/rebuild.
- It is smaller than variants or cohort parity but still materially improves user-facing PostgreSQL honesty.
- It supports later `database:overview`, because overview depends on cases, cohort groups, tags, and top phenotypes.

Do not use Phase 6 for variants yet. The variants domain is the largest read surface and includes SQLite FTS5, extension tables, panel interval resolution, internal allele frequency, type tabs, column metadata, and export query compilation. It should be Phase 7 or later after Phase 6 proves write executor shape on a smaller domain.

## `database:overview` Decision

Defer `database:overview`.

`database:overview` should not be next because its component data sources are not yet PostgreSQL-backed:

- cases list is backed
- case metadata and HPO terms are not backed yet
- cohort groups are not backed yet
- tags are not backed yet
- cohort summary is not backed yet
- BigInt conversion behavior must remain stable

After Phase 6, `database:overview` can be reconsidered only if it is implemented as a thin aggregator over PostgreSQL-backed component services. It should not become a one-off monolithic PostgreSQL summary query while its components remain unsupported elsewhere.

## Docker-backed PostgreSQL Integration Strategy

The Docker workflow exists and should remain gated outside default CI:

- `make pg-up`
- `make pg-down`
- `make pg-reset`
- `make pg-psql`
- `VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-*.e2e.ts`

Phase 6 should add Docker-backed integration coverage early, not at the end, for:

- seeded case metadata
- `cases:query` with `cohort_ids`
- `cases:query` with `hpo_ids`
- `case-metadata:getFullMetadata`
- at least one metadata write round trip, such as `case-metadata:assignHpoTerm`

Do not require Docker in default CI in Phase 6. The current default CI should stay fast and deterministic through mocked `pg.Pool` unit tests. Docker-backed PostgreSQL should be a local required verification when Docker is available and can become a scheduled or manual GitHub Actions job once schema coverage is broad enough to justify service-container maintenance.

Recommended local Docker loop:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
make pg-down
```

For WGS-scale work, Phase 6 should not import WGS data into PostgreSQL yet. It should prepare the next phase by identifying:

- tables required for SNV/indel/SV/CNV/STR variant rows,
- indexes needed for case-scoped pagination, gene lookup, type counts, and cohort filtering,
- PostgreSQL full-text strategy to replace SQLite FTS5,
- bulk insert path requirements for JSON and VCF,
- query-plan capture commands to use once variant data is loaded.

## Renderer Storage Settings

Renderer storage settings remain out of scope.

PostgreSQL runtime support is still not honest enough for a user-facing settings UI because:

- import is SQLite-file-backed
- export is SQLite-file-backed or direct SQLite service-backed
- delete is SQLite-file-backed
- summary rebuild is SQLite-file-backed
- variants and cohort views are not PostgreSQL-backed
- `database:info` is still SQLite-shaped
- `database:open`, `database:create`, `database:rekey`, and recent database UX are local-file concepts

Phase 6 may improve backend capability reporting in tests, but it must not expose renderer PostgreSQL settings.

## Acceptance Criteria

Phase 6 is complete when:

- Docker PostgreSQL can be reset, started, and used by the gated PostgreSQL E2E path when Docker is available.
- PostgreSQL dev schema includes case metadata, cohort group, case-cohort link, HPO term, data info, external ID, case comment, metric definition, and case metric tables required by full metadata parity.
- `case-metadata:*` reads and writes route through active `StorageSession` executors instead of `DatabaseService` for migrated paths.
- SQLite behavior for `case-metadata:*` remains unchanged.
- PostgreSQL `case-metadata:*` behavior has mocked unit coverage.
- `cases:query` supports `cohort_ids` and `hpo_ids` for PostgreSQL sessions.
- Handler tests prove PostgreSQL case metadata paths do not call `getDb()` or `getDbPool()`.
- PostgreSQL handlers resolve through `getCurrentSession()`; SQLite read paths may continue using the session-owned worker pool through `SqliteReadExecutor`.
- Gated Docker PostgreSQL tests cover the new slice, stay skipped unless `VARLENS_RUN_POSTGRES_E2E=1`, and are required local verification when Docker is available.
- A Phase 7 WGS-readiness artifact exists under `.planning/artifacts/` or `.planning/docs/` with concrete variant/import scale blockers and recommended first variant-read slice.
- `database:overview` remains deferred and documented as dependent on component parity.
- No renderer storage settings are added.

## Follow-up Ordering

Recommended order after Phase 6:

1. Phase 7: variants read parity, including variant query, type counts, gene symbols, basic filter options, and explicit FTS strategy.
2. Phase 8: cohort read parity and summary status.
3. Phase 9: tags, annotations, transcripts, and audit-backed writes.
4. Phase 10: import/delete/summary rebuild write executors.
5. Phase 11: export parity.
6. Phase 12: `database:overview` once component services are backed.
7. Phase 13: renderer storage settings and backend lifecycle UX.
