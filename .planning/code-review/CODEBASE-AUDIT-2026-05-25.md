# VarLens Codebase Audit — 2026-05-25

Repo state: `aaa088f7` (main, 1 commit ahead of `origin/main`) · Version: `0.59.4` · Node `24.14.1` · Electron `40.10.1`

Method: parallel multi-agent audit across five concerns (performance, security, scalability, release readiness, 2026 best-practices). Static analysis + targeted `npm audit`/`npm outdated`; no `make` targets run. Five specialist reports under `.planning/artifacts/audit-2026-05-25/` are cited inline.

This report supersedes the priority sections of `CODEBASE-REVIEW-2026-05-06.md` (still authoritative on findings that landed since). The 2026-05-06 review noted **derived-data freshness** and **PostgreSQL import consistency** as #1 and #2; both remain open and are folded into the roadmap below.

---

## 1. Executive Summary

VarLens is a **structurally sound clinical-genetics desktop app** with mature security defaults, dual storage backends, and a clean storage facade. The codebase has absorbed most of the obvious renderer-perf work. **No critical security vulnerabilities** were found; `npm audit --omit=dev` reports 0 critical / 0 high / 1 moderate / 5 low. The Electron fuse baseline, SQL parameterisation, CSP, encryption posture, and worker boundary discipline are all in good shape.

That said, **the next release is gated by four user-visible/operational issues that compound to break user trust** if shipped today:

1. **PHI leaks into main-process logs.** Raw HGVS / chr:pos / patient identifiers land in `~/.config/varlens/logs/main.log` — the renderer-side `LogService` sanitises, `MainLogger` does not. A clinical-genetics user attaching a log to a bug report exports patient data. **(Release blocker.)**
2. **CHANGELOG.md is seven releases stale**, the docs-site changelog is 37 releases stale, and the current `package.json` 0.59.4 is unreleased. The "Keep a Changelog" contract is broken.
3. **The tag→`package.json` version check is still missing.** A mistagged release would publish mismatched binaries. (May 6 finding, still open.)
4. **Import IPC handlers (`import:start`, `import:startMultiFile`, `import:vcfPreview`) accept `filePath` without runtime validation**, and `BedFilter.fromFile` reads it without an allow-list. Defence-in-depth failure: a renderer compromise becomes arbitrary local-file read. (May 6 finding, still open.)

Beyond release-hygiene, the **strategic story is scaling to 1000+ whole genomes** (the user's stated horizon). At that scale, six architectural assumptions become release-blockers — most importantly: the PostgreSQL `variants` table is unpartitioned, cohort aggregation runs live `GROUP BY` over the whole heap on every page-load, imports are strictly serialised, and there is no background-job framework.

The scaling work is real and not trivial — a **10-13 week, five-sprint roadmap** is outlined in §5. The good news: the existing storage facade is the right boundary, so most of the work lands behind `StorageSession` / `PostgresCohortRepository` without renderer churn.

### Scorecard (vs. 2026-05-06)

| Area | May 06 | May 25 | Δ | Comment |
|---|---:|---:|---:|---|
| Security / Electron boundary | 8.5 | **8.6** | +0.1 | Most May 6 IPC drift closed; F-01 import-handler validation still open |
| Architecture | 8.2 | **8.2** | 0 | Strong; large refactors not warranted |
| Maintainability | 7.4 | **7.5** | +0.1 | Agent-health baseline reduced (25→22 files); cohort-parity rule embedded |
| Renderer performance | 7.5 | **7.4** | -0.1 | More findings surfaced (N+1 in annotations, JSON-clone hot path, hidden FilterToolbar) |
| Derived-data freshness | 6.2 | **6.2** | 0 | Still unfixed; May 6 #1 priority |
| PostgreSQL/backend readiness | 8.0 | **7.8** | -0.2 | Imports unblocked; cohort-aggregation parity is now the visible gap |
| WGS-scale readiness | 7.7 | **6.8** | -0.9 | Audit re-scored against 1000-genome target rather than today's hundreds of cases |
| Testability / CI trust | 7.2 | **7.4** | +0.2 | 328 test files (memory said 32 — stale by 10×); contract coverage near-complete |
| Release / supply-chain | 8.0 | **7.6** | -0.4 | PHI-leak, stale CHANGELOG, missing version-guard, unsigned macOS DMG drag the score |
| LLM-assisted dev | 6.7 | **7.2** | +0.5 | Knowledge graph in place; agent-health guardrails landed; baseline shrinking |
| Observability | — | **5.5** | new | No crash reporter; PHI in logs; log rotation 1-deep |

**Composite: 7.5/10** (was 7.7/10 — moved down on observability and WGS-scale re-scoping; up on dev affordances).

---

## 2. Specialist Reports — Where to Read Detail

| # | Report | Headline finding |
|---|---|---|
| 01 | [Performance](../artifacts/audit-2026-05-25/01-performance.md) | `AnnotationRepository.getBatch` issues 3 SQLite calls per row in a JS loop (150/page); 189 PG `pool.query` sites with no named/prepared statements |
| 02 | [Security](../artifacts/audit-2026-05-25/02-security.md) | One HIGH (import IPC Zod gap → arbitrary file read primitive); 0 release-blocking CVEs |
| 03 | [Scalability](../artifacts/audit-2026-05-25/03-scalability.md) | Six 1000-genome architecture gaps; ~10-13 week phased roadmap |
| 04 | [Release readiness](../artifacts/audit-2026-05-25/04-release-readiness.md) | PHI in main logs, CHANGELOG stale, tag-vs-package guard missing |
| 05 | [Best-practices research](../artifacts/audit-2026-05-25/05-best-practices.md) | Flip `GrantFileProtocolExtraPrivileges` → `false`; shallowRef before virtualization; BRIN+GIN+pg_trgm |

---

## 3. Cross-Cutting Top 10 Findings (severity-prioritised)

Each item shows: severity · evidence · fix · effort · source report.

### 3.1 HIGH — PHI in main-process logs (release blocker)
- **Evidence:** `src/main/services/MainLogger.ts:107-132` passes raw messages to electron-log; `sanitizeLogMessage` lives only on the renderer side (`src/renderer/src/utils/sanitizers.ts:30-49`). Logs land in `~/.config/varlens/logs/main.log` (5 MB rotation, one old file kept).
- **Fix:** Hoist `sanitizeLogMessage` to `src/shared/utils/sanitizers.ts`; call from `MainLogger` *and* from the IPC emit path before broadcasting. Add `tests/main/services/main-logger-redaction.test.ts`.
- **Effort:** ~half-day. Critical before 0.59.4 ships.
- **Source:** Release-04 Obs-1.

### 3.2 HIGH — Import IPC handlers accept arbitrary `filePath` without runtime validation
- **Evidence:** `src/main/ipc/handlers/import.ts:117-175` (`import:start`, `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`) accept `string`/`MultiFileImportSpec[]` typed args only — no `safeParse`. `BedFilter.fromFile` (`src/main/import/vcf/bed-filter.ts:28-31`) then `readFileSync`s the path with no allow-list. A renderer compromise can read `~/.ssh/id_ed25519`, the SQLite DB, or `varlens-postgres-secrets.insecure-local.json`.
- **Fix:** Add Zod schemas to `src/shared/types/ipc-schemas.ts`; resolve `BedFilter` paths against `app.getPath('home')` (or a session-allow-list emitted by Electron file dialogs). May 6 finding #5 — still open.
- **Effort:** 1 day.
- **Source:** Security-02 F-01.

### 3.3 HIGH — PostgreSQL cohort aggregation is live, not materialised
- **Evidence:** `src/main/storage/postgres/PostgresCohortRepository.ts:697-738` runs `GROUP BY chr,pos,ref,alt` over `variants` on every cohort page-load. SQLite uses `cohort_variant_summary` with incremental add/remove; PG has no equivalent. Phase 16.2 cohort-carrier query was already 3.0 s at *4 cases*; linearly that's hours at 1000.
- **Fix:** Build `cohort_variant_summary` materialised table in PG, partitioned by `chr`, fed by an incremental `add/remove` path mirroring `CohortSummaryService`. Materialised view + `REFRESH CONCURRENTLY` as fallback. Same for `gene_burden_summary`.
- **Effort:** 1 sprint (foundation for 1000-genome scaling).
- **Source:** Scalability-03 F4.

### 3.4 HIGH — `AnnotationRepository.getBatch` does 3 SQLite calls per variant in a JS loop
- **Evidence:** `src/main/database/AnnotationRepository.ts:181-215` — 150 sequential prepared executions per 50-row page; 3000 per 1000-row export. Called on every page change and case switch (`useVariantData.ts:189-204, :212`).
- **Fix:** Replace the loop with two batched IN-list queries (`variant_annotations` global, `case_variant_annotations` per-case). Caller already holds `variant.id`; passing it eliminates the redundant SELECT #2 entirely.
- **Effort:** ~1 day. Biggest single perf win in the case-switch flow.
- **Source:** Performance-01 #1.

### 3.5 HIGH — `variants` table is unpartitioned; no BRIN; `info_json` is TEXT not JSONB
- **Evidence:** `src/main/storage/postgres/migrations/sql/0003_create_variants.sql:4-48,136-143`. At 5 B rows × ~250 B = 3-4 TB heap + 6-9 TB indexes — un-VACUUMable. Every index is btree on `(case_id, …)`; range scans on `(chr, pos)` can't use them.
- **Fix:** List-partition by `chr DEFAULT` (24 partitions, almost-equal per chromosome, automatic pruning); per-partition BRIN on `(pos)` (tiny, fits in cache); convert `info_json` → JSONB with `GIN(jsonb_path_ops)`; add `pg_trgm` GIN on `gene_symbol`. The partition rewrite is destructive — pair with JSONB conversion to avoid two rewrites.
- **Effort:** 1 sprint (partitioning + JSONB); BRIN+GIN+pg_trgm alone are pure `CREATE INDEX` migrations (~half-day).
- **Source:** Scalability-03 F1/F2/F3 + Best-practices-05 §5.

### 3.6 HIGH — 189 PostgreSQL `pool.query` sites with no named/prepared statements
- **Evidence:** `grep -rn 'pool.query' src/main/storage/postgres/` returns 189 hits; zero with `name:`. Every read pays full parse+analyze+plan server-side.
- **Fix:** Wrap repeated query shapes in a helper that supplies `name: 'variant_type_counts:v1'`. Bump version suffix on SQL change. Start with high-frequency reads: `variants:typeCounts/typesPresent/geneSymbols`, `variants:columnMeta`, the COUNT/data pair in `queryVariants`, `annotations:*`, `cohort:carriers`.
- **Effort:** ~2 days. Highest-leverage PG read-side change for WGS budgets without touching SQL.
- **Source:** Performance-01 #5.

### 3.7 HIGH — Imports are strictly serialised; no concurrent COPY workers
- **Evidence:** `src/main/storage/postgres/PostgresImportExecutor.ts:30-80` single `inProgress` flag; `src/main/import/BatchImportService.ts:79-93` sequential `for` loop. Phase 16.2 = 97 s/HG002 PG import × 1000 = 27 h single-threaded. `DEFAULT_PG_POOL_MAX=4` is sized for concurrency that never happens.
- **Fix:** Lift `inProgress` to a queue served by N=`min(poolMax-1, cpuCount)` workers; each owns its own COPY stream + dedicated connection. Reserve one pool slot for read traffic so the UI doesn't stall during bulk import.
- **Effort:** 1 sprint, paired with the JobRunner from §3.10.
- **Source:** Scalability-03 F5.

### 3.8 HIGH — `cloneForIpc` is `JSON.parse(JSON.stringify(...))` on every variants:query
- **Evidence:** `src/shared/utils/cloneForIpc.ts:1-6` (entire file). Called on every page-flip, prefetch, sort change, filter tweak. Renderer already on Chromium with native `structuredClone`.
- **Fix:** One-line swap to `structuredClone(value)`. Optionally memoise on the existing `filterKey` so prefetches reuse the cloned filter object.
- **Effort:** ~2 hours.
- **Source:** Performance-01 #2.

### 3.9 HIGH — Hidden FilterToolbar runs `loadFilterOptions` (heavy COUNT-DISTINCT) when Shortlist is the default tab
- **Evidence:** `src/renderer/src/views/CaseView.vue:360` keeps the per-type region under `v-show`; `useFilterLifecycle.ts:80-94` unconditionally fires `getFilterOptions` per case-id change; `VariantRepository.getAllColumnMetas` runs `COUNT(DISTINCT)` over 21 columns per case. 100 % of cost is paid for users on the documented default (`defaultCaseTab='shortlist'`). May 6 finding — still open.
- **Fix:** Gate `loadFilterOptions` on a `visible` ref pushed down from CaseView; use `onActivated`/visibility watcher rather than the case-switch watcher. Best-practices recommends the **`v-show` + first-mount-deferred** pattern (render `<v-if mounted>` inside `<v-show>`; flip `mounted` on first tab activation).
- **Effort:** 1 day.
- **Source:** Performance-01 #3 + Best-practices-05 §6.

### 3.10 HIGH — No background-job framework
- **Evidence:** Each long-running task (import, rebuild, export, enrichment back-fill, delete) reinvents `inProgress` + bespoke progress callbacks. No persistent log; app restart loses everything in flight. `BatchImportService.processBatch` already has the structure to retry just-failed files — no UI uses it.
- **Fix:** Introduce a `Job` primitive `{id, kind, params, status, progress, error, timestamps}` in a `jobs` table (SQLite *and* PG). Build a thin `JobRunner` in `src/main/services/jobs/` wrapping worker dispatch with enqueue/claim/progress/heartbeat/cancel/retry. Render a global jobs drawer subscribed once via `jobs:progress`. Sequence: (a) abstract over existing workers no-op, (b) persistence + resume, (c) concurrency control (unblocks #3.7).
- **Effort:** 1 sprint (foundation work that compounds).
- **Source:** Scalability-03 F11.

---

## 4. Quick-Win Cluster (≤ 1 sprint, mostly half-day each)

These are low-effort, high-ROI items that should land *together* before any larger work begins.

| # | Item | Effort | Source |
|---|---|---|---|
| QW-1 | Hoist `sanitizeLogMessage` to shared; call from `MainLogger`. **Release-blocker.** | 0.5 d | Rel-04 Obs-1 |
| QW-2 | Backfill `CHANGELOG.md` for 0.57.0 → 0.59.4 from `git log v0.56.7..HEAD --no-merges`. **Release-blocker.** | 0.5 d | Rel-04 Doc-1 |
| QW-3 | Add `tag-vs-package.json` version-equality step in `release.yml:create-release`. **Release-blocker.** | 0.25 d | Rel-04 CR-2 |
| QW-4 | `npm audit fix` for `qs` moderate (transitive under `pg`). Add `overrides` for `js-cookie` once 3.0.6 ships. | 0.25 d | Sec-02 F-08, Rel-04 deps |
| QW-5 | Swap `cloneForIpc` → `structuredClone`. | 0.25 d | Perf-01 #2 |
| QW-6 | Add `webContents.on('will-navigate')` guard on `mainWindow`. | 0.25 d | Sec-02 F-10 |
| QW-7 | Add Zod schemas for `import:*` channels + path allow-list in `BedFilter.fromFile`. | 1 d | Sec-02 F-01 |
| QW-8 | Add `safeParse(z.number().int().min(0).max(64))` for `system:setWorkerThreads`. | 0.25 d | Sec-02 F-02 |
| QW-9 | Cap `UserDomainsSchema` array length to 100; reject `^x'` prefix in PRAGMA key path. | 0.5 d | Sec-02 F-04/F-05 |
| QW-10 | Fix `idx_variants_type_case` direction → `(case_id, variant_type)`. | 0.25 d | Perf-01 #4/#10 |
| QW-11 | Stop rebuilding SQLite FTS per file in multi-file imports (`import-pipeline.ts:247-266`); rebuild once at session end. | 0.5 d | Perf-01 #8 |
| QW-12 | Migrate CI aggregator (`build.yml:266-281`) to treat `cancelled`/`skipped (after failure)` as failure. | 0.5 d | Rel-04 CR-1 |
| QW-13 | Add `'.github/workflows/**'` to `build.yml` `code:` path filter. | 0.1 d | Rel-04 CR-3 |
| QW-14 | `process.exit(1)` in `compare-wgs-import.mjs` on budget breach; `set -e` in Makefile perf chain. | 0.25 d | Rel-04 CR-6 / Perf-2 |
| QW-15 | Add `mainLogger.warn` at startup when `VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local` is active. | 0.1 d | Sec-02 F-06 |
| QW-16 | Add BRIN `(chr, pos)` + GIN `(info_json jsonb_path_ops)` + pg_trgm `(gene_symbol)` indexes (assumes JSONB conversion happens in §3.5; else GIN waits). | 0.5 d (indexes only) | Sch-03 F3, BP-05 §5 |

**Total: ~6-7 days of focused work delivers ~16 items.** Worth doing as a single "Pre-0.60 hardening" milestone before the strategic work below.

---

## 5. Strategic Roadmap — Toward 1000-Genome Scale

Sequencing matters: foundations unblock storage shape, which unblocks throughput, which unblocks UX. The scalability report's sprint breakdown is the spine; security and perf items slot into the same sprints.

### Sprint 0 — Pre-0.60 Hardening (1 week)
- All Quick Wins (§4 above).
- **Exit criterion:** CHANGELOG current, tag-guard live, PHI-redaction shipped, npm audit moderate cleared, IPC import validation closed, `make ci-full` green, 0.59.5 (or 0.60.0) tagged and signed.

### Sprint A — Foundations (2-3 weeks)
- **JobRunner skeleton** (no behaviour change; abstract over existing workers). [§3.10]
- **PG `cohort_variant_summary`** materialised + incremental add/remove. [§3.3]
- **`cohort_column_meta`** materialised alongside. [Sch-03 F6]
- **Multi-project model design doc** + `projects` registry (no UI change yet). [Sch-03 F10]
- **Annotation batch JOIN** [§3.4] + **PG named statements** for top-frequency reads [§3.6].
- **`shallowRef`/`markRaw` audit** across stores/composables holding row data. [BP-05 §6]
- **Exit criterion:** PG cohort page-load < 500 ms warm at 100 cases; case-switch perf improves on `renderer-perf-phase1` artifact.

### Sprint B — Storage Shape (3-4 weeks)
- **Partition `variants`, `variant_transcripts`, `variant_sv/cnv/str`** by `LIST(chr) DEFAULT`. [§3.5 / Sch-03 F1]
- **`info_json` → JSONB** + GIN. [§3.5 / Sch-03 F2]
- **BRIN(chr, pos) per partition**. [§3.5 / Sch-03 F3]
- **PG `gene_burden_summary`** mirroring SQLite; convert `GeneBurdenTable.vue` to `v-data-table-server`. [Sch-03 F8]
- **Custom-protocol migration** + flip `GrantFileProtocolExtraPrivileges` fuse to `false`. [BP-05 §4]
- **Exit criterion:** WGS query-perf harness on 8-case fixture passes all 5 budgets with 25% margin; new artifact under `.planning/artifacts/perf/postgres-query/`. Fuse baseline tightened.

### Sprint C — Throughput (2 weeks)
- **Concurrent PG imports** (N=4 workers feeding 4 COPY streams from one queue). [§3.7]
- **Cancel/resume** built on Sprint A's JobRunner.
- **Per-file FTS-rebuild dedup** [QW-11 already in Sprint 0; verify in concurrent path].
- Optional: hash-swap (`sha256 → xxhash3`) if `VARLENS_PG_IMPORT_PROFILE=1` shows `digest` > 10 % of import wall-time. [Sch-03 F12]
- **Exit criterion:** 1000 GIAB HG002 imports complete in < 8 h on dev workstation; WGS perf artifact shows ≥ 2.5× speedup at N=4.

### Sprint D — Renderer / UX at Scale (2 weeks)
- **CaseList virtualisation** (`v-virtual-scroll` inside the existing `v-infinite-scroll`). [Sch-03 F7]
- **Cohort matrix virtualisation** with headless `@tanstack/vue-virtual` inside Vuetify-styled rows (only after §3.3 ships — virtualisation without backend pagination is pointless). [BP-05 §2]
- **Global jobs drawer** (renderer half of §3.10).
- **"Apply to all 1000 cases"** → server-side filter spec instead of id-set enumeration.
- **MessagePort streaming channel** for large IPC payloads (cohort matrix, variant export). [BP-05 §1]
- **Search-budget validation** on annotated WGS fixture. [Sch-03 F9]
- **Exit criterion:** Playwright E2E on 1000-case fixture: FPS > 30 on scroll, cohort page-load < 1 s end-to-end.

### Sprint E — Multi-Tenancy Polish (1-2 weeks)
- Hot session pool, project picker UI, optional cross-project read-only queries. [Sch-03 F10]
- DuckDB SQLite-scanner spike (1 day) — benchmark a cohort-wide allele-frequency query against current path; decide whether to add a third "analytics" backend. [BP-05 §3]
- **Exit criterion:** Switching projects keeps pools warm; spike result documented.

**Total: ~10-13 weeks** for Sprint A → E. Sprint 0 is independent and should ship first regardless.

---

## 6. Items to Defer (with rationale)

The audit explicitly recommends *not* doing these now:

| Item | Why not |
|---|---|
| Replace SQLite primary storage with DuckDB / chDB | DuckDB encryption is new (2025), single-writer remains; SQLCipher / multi-ciphers is more mature. Re-evaluate after DuckDB 1.5 stabilises (BP-05 §3). |
| Pay for EV cert vs OV | Microsoft's 2026 docs explicitly remove the SmartScreen benefit (BP-05 §8). Keep SSL.com eSigner. |
| Migrate Linux build to Flatpak | No user signal; AppImage + zsync is actively maintained. |
| Migrate workers from `utilityProcess` to anything else | `utilityProcess` is exactly the supported pattern for native-addon work; Electron #43513 documents the alternatives are broken. |
| Add Redis / BullMQ for the job queue | SQLite-backed queue inside the existing connection is the right shape for single-user. |
| Bump `vite` 7 → 8 | Blocked on `vitepress` 2.x stabilising — GH #154 in memory; current decision stands. |
| Default-virtualise tables | May 6 review's "don't virtualise without trace evidence" stands; do it only where shown to matter (Sprint D). |
| Chromosome partitioning *without* JSONB conversion in the same migration | Don't pay the heap-rewrite cost twice; bundle both into Sprint B. |

---

## 7. Open Validation Gaps (audit limits)

These were flagged by specialist agents as things this audit could not confirm:

- **No live `make ci-full`** run during the audit (constraint). Recommend rerunning before tagging 0.59.5/0.60.0.
- **No 1000-case fixture exists** — Sprint D should start with a fixture builder so Playwright E2E can actually measure 1000-case behaviour.
- **PG VACUUM/bloat at TB scale** unmeasured — run a delete-50-cases-then-vacuum experiment before Sprint B partitioning ships, to calibrate the F1 estimate.
- **Actual 100-case PG import wall-time** unknown — Phase 16.2 measurement was single-fixture; Sprint C's 8 h target needs a 100-case calibration first.
- **`info_json` query-pattern survey** — if users almost never custom-filter on INFO fields, JSONB+GIN is overkill and STORED generated columns per documented field would be enough.
- **Multi-user / network-PG threat model** — AGENTS.md says "no backend service"; some 1000-genome customers will want shared PG on a NAS or VM. Changes auth, RLS, pool sizing. Product decision needed before Sprint E.
- **Renderer XSS in third-party Vuetify components** — focused pass on comment/markdown surfaces not done in this audit.
- **Autoupdater signature verification / downgrade-attack hardness** not tested; `electron-updater` defaults are believed-correct.

---

## 8. Next Steps (concrete this-week / this-sprint actions)

### This week
1. Open one PR with QW-1 (PHI redaction) + QW-3 (tag guard) + QW-2 (CHANGELOG backfill). Call it `chore(release): pre-0.60 hardening`.
2. Open one PR with QW-7 (import IPC schemas) + QW-8 (worker-threads count). Call it `fix(ipc): validate import handler payloads at runtime`.
3. Open one PR with QW-4 (`npm audit fix` for `qs`).
4. Open one PR with QW-5 (structuredClone) + QW-11 (per-file FTS dedup).

### Next 1-2 sprints (Sprint 0 + planning for Sprint A)
- Land remaining Quick Wins (QW-6, QW-9, QW-10, QW-12 → QW-16).
- Tag and ship 0.59.5 (or 0.60.0) with the hardening done.
- Open `.planning/specs/2026-XX-pg-cohort-summary.md` for Sprint A's #3.3 (PG cohort_variant_summary materialisation).
- Open `.planning/specs/2026-XX-job-runner-skeleton.md` for Sprint A's #3.10.
- Build the 1000-case fixture builder script under `scripts/perf/build-1000-case-fixture.mjs` — needed for Sprint D and good to have early.
- Decide multi-user / network-PG scope (product decision) before Sprint E planning.

### Decisions needing the lead-engineer's call
- **Apple Developer ID + notarytool** acquisition (CR-5). Either acquire and notarise, or document a clear first-launch override path. Today's "damaged dmg" dialog is an adoption barrier.
- **Multi-project hot session pool** vs. current switch-and-reopen model (Sprint E).
- **DuckDB sidecar** for analytics — spike yes/no after Sprint A's PG cohort summary is shipped.

---

## 9. Appendix — Where the Knowledge Graph Helped

The `.understand-anything/knowledge-graph.json` built earlier in this session (2117 nodes, 4299 edges, 13 architectural tour steps) materially accelerated this audit:

- Fan-in / fan-out queries informed the agent-health split priority list (Rel-04). `src/shared/types/api.ts` shows 68 fan-in edges — confirms it as the load-bearing context bottleneck for any IPC-touching agent.
- The 13-step tour gave each specialist agent a stable navigation map (storage facade → SQLite/Postgres backends → VCF pipeline → cohort burden), avoiding ad-hoc directory crawling.
- The merged graph is git-ignored and regenerable via `/understand-anything:understand`; rebuild after large refactors (especially after the api.ts split in Rel-04's #1 priority).

---

*Five specialist reports under `.planning/artifacts/audit-2026-05-25/` are the authoritative evidence base for the findings above. This master file is the synthesis and the actionable roadmap.*
