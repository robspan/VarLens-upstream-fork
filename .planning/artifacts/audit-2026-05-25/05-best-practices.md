# 2026 Best-Practices Research — VarLens Audit

**Date:** 2026-05-25
**Scope:** External research (web only) on 8 questions feeding the 2026 VarLens audit. No source code changes proposed here — recommendations are for the architecture-and-roadmap track.

Citation convention: each finding links the primary source(s). Where a recommendation would change VarLens's near-term roadmap, it is marked **[ROADMAP IMPACT]**.

---

## 1. Electron + Large Local Datasets (multi-GB SQLite / billions of Postgres rows)

### What teams are shipping in 2025-2026

- **Notion (Electron + SQLite)** evolved SQLite from a cache to a guaranteed-persistence store for offline. Their sync engine is *push-based* (server emits messages on per-page channels; the client tracks `lastDownloadedTimestamp` per page) and offline pages are migrated to a **CRDT model** at the data layer. State is split across an `offline_page` table and an `offline_action` table that lets multiple independent "reasons" hold a page offline ([Notion engineering blog](https://www.notion.com/blog/how-we-made-notion-available-offline)).
- Notion's desktop client is a thin Electron wrapper; the heavy lifting is the SQLite cache + the sync engine, not the renderer.
- Linear's own Electron app does not publish a sync architecture, but its public engineering posts have long described an in-memory authoritative store, optimistic local writes, and a delta sync — the same pattern Notion converged to.
- DuckDB-based desktop tools (e.g. Hex desktop preview, Tad, Rill) typically embed DuckDB in the main process and stream Arrow record batches to the renderer rather than serializing rows.

### Where Electron IPC becomes the bottleneck

- The default `ipcMain`/`ipcRenderer` path uses **structured clone**. Sending tens-of-MB JSON or large nested objects forces a copy and a serialization pass on both sides — this is the classic IPC stall.
- Electron supports **`ArrayBuffer`/`SharedArrayBuffer` over IPC**: `SharedArrayBuffer` is shared (same memory, mutations visible across processes), `ArrayBuffer` is *transferred* (zero-copy move when sent as a transferable) ([Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc), [issue #9509 discussion](https://github.com/electron/electron/issues/9509)).
- **`MessagePort` / `MessageChannel`** lets the main process broker a direct renderer-to-renderer (or main-to-renderer worker) channel, after which messages bypass main ([MessagePorts in Electron](https://www.electronjs.org/docs/latest/tutorial/message-ports)).
- Synchronous IPC and `@electron/remote` are explicitly called out as anti-patterns (block the UI thread) ([Performance tutorial](https://www.electronjs.org/docs/latest/tutorial/performance)).

### Standard mitigations

1. **Transfer, don't copy.** For >5 MB payloads use `ArrayBuffer` with `postMessage(buf, [buf])` so the buffer is moved, not cloned.
2. **MessagePort streaming.** For long result sets, set up a `MessageChannel`, push batches of Arrow/Parquet/binary rows down the port, terminate with a close message. This is the "response stream" pattern.
3. **SharedArrayBuffer for read-mostly indices** (e.g. cohort matrix bitmap, gene-symbol intern table). One copy, all processes read it.
4. **Arrow IPC format** for tabular result sets — most BI/analytics desktop tools have converged on this for Electron-to-renderer transport.

### Why this fits VarLens

VarLens already routes everything through `wrapHandler` + `unwrapIpcResult`. That contract is sound for *control-plane* IPC, but cohort matrices and WGS variant lists hit the structured-clone wall. The investment is a one-time `MessagePort`-based "dataset stream" channel; everything else stays on the existing typed contract.

### Trade-off / migration cost

- Trade-off: adds a second IPC mechanism (transferable + port-based) alongside the typed `invoke` channels. Type safety must be redesigned for the port channel.
- **Migration cost: Medium.** Touches preload, main IPC, and a small number of "large-payload" handlers (cohort fetch, variant export, WGS import progress).

**[ROADMAP IMPACT]** Adopt MessagePort streaming for cohort matrix and variant list payloads before chasing renderer-side virtualization. Without it, even a perfect virtual table will block on the serialization step.

---

## 2. Vue 3 + Vuetify 4 High-Density Tables — Virtualization Options

### Vuetify's own offerings

- **`v-data-table-virtual`** is Vuetify's built-in virtual table. It's the right primitive for client-side virtualization but is itself slow at scale: a community bug report measured **12-20 seconds and >2 GB memory** to render 43 columns × 2,550 rows ([Vuetify issue #20335](https://github.com/vuetifyjs/vuetify/issues/20335)). Checkbox-select-all over thousands of rendered virtual rows is also slow on Vuetify 3.7.x ([Vuetify issue #20601](https://github.com/vuetifyjs/vuetify/issues/20601)).
- **`v-data-table-server`** *does not virtualize* — it server-paginates. The same bug report shows it at >40 s and >3 GB for the same workload when pagination is disabled.
- Vuetify currently **does not ship a server-paginated + virtualized hybrid** out of the box ([Vuetify virtual tables docs](https://vuetifyjs.com/en/components/data-tables/virtual-tables/)).

### External libraries

- **`@tanstack/vue-virtual`** is a *headless* virtualization adapter — no DOM/styles, you provide markup. Best when you need full control of row composition and want to wrap an existing Vuetify-styled row component. Pairs well with custom column logic ([TanStack Virtual docs](https://tanstack.com/virtual/latest/docs/introduction), [Vue adapter docs](https://tanstack.com/virtual/v3/docs/framework/vue/vue-virtual)).
- **`vue-virtual-scroller`** is a *components* library — drop-in `RecycleScroller`/`DynamicScroller` for list/table. Faster to integrate, less control, mature ([DigitalOcean tutorial](https://www.digitalocean.com/community/tutorials/vuejs-vue-virtual-scroller)).

### Recommended pattern for VarLens

For a 1000-case cohort matrix or 100k-row variant list the practical pattern is:

1. **Server-paginate at a high page size** (say, 1000-row windows) via Kysely / existing IPC.
2. **Within the window, render through `@tanstack/vue-virtual`** to keep the DOM at ~50 visible rows.
3. **Treat the row data as `shallowRef`** — Vue's reactivity must not deep-walk every annotation column. With shallowRef + virtualization, rendering "millions of items without dropping a frame" is achievable ([Vue 3 reactivity trap article](https://dev.to/ameer-pk/the-vue-3-reactivity-trap-why-large-datasets-crash-your-browser-1ikb)).
4. **Pre-fetch the next window** when the user scrolls past 70 % of the current one.

### Why this fits VarLens

The May 6 review correctly said "don't virtualize without trace evidence" — most renderer hot paths in VarLens today are not row-rendering, they are reactivity overhead on large objects. Once you do hit the row-rendering wall (1000-case cohort matrix, 100k+ variant list), Vuetify's built-in `v-data-table-virtual` is the wrong primitive at high column counts. Headless TanStack inside a Vuetify-styled row template is the lower-risk path.

### Trade-off / migration cost

- Trade-off: you give up some Vuetify table sugar (built-in sort header, expand row API) when you go headless. Most of that is already custom in VarLens.
- **Migration cost: Medium**, but only for the views that actually need it. Keep `v-data-table-server` for the case list and other low-row-count views.

---

## 3. SQLite vs PostgreSQL vs DuckDB for WGS-Scale Local Analytics

### DuckDB 1.4 LTS (Sep 2025) is now a real candidate

- **Encryption at rest** (AES-GCM-256 default, AES-CTR-256 option) shipped in 1.4.0. Encrypts main file + WAL + temp files. Key derivation via KDF, secure in-memory key cache, never swapped to disk. Attach syntax: `ATTACH 'enc.db' AS x (ENCRYPTION_KEY 'k')` ([DuckDB encryption announcement](https://duckdb.org/2025/11/19/encryption-in-duckdb), [DuckDB 1.4.0 release notes](https://duckdb.org/2025/09/16/announcing-duckdb-140)).
- **Caveat:** DuckDB encryption "does not yet meet official NIST requirements" (canary-tag verification tracked under issue 20162). It is *less mature* than SQLCipher / `better-sqlite3-multiple-ciphers`, and the Mbed TLS write path was disabled in 1.4.1+ due to RNG concerns — production paths must use the OpenSSL-backed httpfs extension.
- **Performance overhead** of encryption is negligible for read-heavy SUMMARIZE-style queries on OpenSSL; meaningful on memory-constrained mixed workloads ([encryption announcement](https://duckdb.org/2025/11/19/encryption-in-duckdb)).
- **Concurrency model:** single writer, many readers. **1.4 LTS** = readers do not block. **1.5.0 (March 2026)** introduces concurrent reads/writes/inserts/deletes during checkpoints ([DuckDB 1.5.0 announcement](https://duckdb.org/2026/03/09/announcing-duckdb-150), [DuckDB 1.4.2 LTS announcement](https://duckdb.org/2025/11/12/announcing-duckdb-142)).
- LTS is supported through **September 16, 2026**.

### Where DuckDB beats Postgres / SQLite for VarLens-style workloads

| Operation | DuckDB | SQLite | Postgres |
|---|---|---|---|
| Filter-by-region (`chrom='1' AND pos BETWEEN x AND y`) on billions of rows | Columnar + zone maps — very fast | OK with B-tree on `(chrom,pos)` | OK with BRIN on `(chrom,pos)` or B-tree |
| Joins on case + variant | Vectorized hash joins | Nested loop / merge | Hash joins, parallel |
| Multi-billion-row GROUP BY aggregates | DuckDB's wheelhouse — vectorized OLAP | Slow (row store) | Reasonable, parallel workers help |
| Concurrent multi-writer | Single writer | Single writer | Many writers |
| Encryption maturity | New (1.4, 2025) | Mature (SQLCipher, multi-ciphers) | TDE via extensions (e.g. cybertec) |

### chDB / clickhouse-local positioning

- **chDB** embeds ClickHouse inside the process (originally Python, now multi-language). 70+ input/output formats, extreme aggregate speed, but no first-class Node binding and the same single-machine RAM ceiling. For 1 TB+ workloads ClickHouse-on-cluster pulls away from DuckDB; for the desktop scale VarLens targets it is overkill ([Tinybird ClickHouse vs chDB](https://www.tinybird.co/blog/clickhouse-vs-chdb-embedded-clickhouse), [Welcome chDB](https://clickhouse.com/blog/welcome-chdb-to-clickhouse), [Kestra 2026 embedded DB survey](https://kestra.io/blogs/embedded-databases)).

### Recommendation for VarLens

Do **not** replace SQLite — it remains the right primary store for clinical case-level work (single-user, encrypted, mature, transactional).

Treat Postgres as the **multi-user / shared-server** backend (already in flight, ratio 1.85× per the AGENTS context).

**Consider DuckDB as a third "analytics" backend** specifically for:
- Multi-case aggregate queries across all cases (cohort allele-frequency, regional burden tests).
- Read-only WGS-scale exploration on a workstation.

It should *not* replace SQLite as the transactional source-of-truth in 2026 because of (a) encryption maturity gap and (b) single-writer limitation. Re-evaluate after DuckDB 1.5 stabilizes its concurrent-checkpoint story.

### Trade-off / migration cost

- Trade-off: a third storage abstraction in the codebase. Need a `DuckdbStorage` adapter alongside `SqliteStorage` and `PostgresStorage`. Need to materialize / refresh DuckDB views from SQLite.
- **Migration cost: Medium-High** if used as an alternative analytics path; **Low** as a side-car for ad-hoc cohort queries that read SQLite directly via DuckDB's SQLite scanner extension (the cheap experiment).

**[ROADMAP IMPACT]** Worth a spike: install the DuckDB SQLite scanner extension and benchmark a cohort-wide allele-frequency query against the SQLite path. That spike is ~1 day and tells you whether the larger investment is worth it. **Don't replace SQLite primary storage in 2026.**

---

## 4. Electron 40 Fuse Baseline & 2026 Security Defaults

### Current fuse inventory (Electron 40)

| Fuse | Current safe value | Notes |
|---|---|---|
| `runAsNode` | `false` | Already in VarLens baseline. Disabling breaks `child_process.fork`; use `utilityProcess` instead. |
| `cookieEncryption` | `true` | One-way; can't safely toggle back. VarLens baseline correct. |
| `nodeOptions` | `false` | Blocks `NODE_OPTIONS` injection. VarLens correct. |
| `nodeCliInspect` | `false` | Blocks `--inspect`. VarLens correct. |
| `embeddedAsarIntegrityValidation` | `true` | Pairs with `onlyLoadAppFromAsar`. VarLens correct. |
| `onlyLoadAppFromAsar` | `true` | Refuses to launch from non-asar paths. VarLens correct. |
| `loadBrowserProcessSpecificV8Snapshot` | `false` (default) — `true` is more secure | Isolates renderer V8 heap from main. Worth re-evaluating. |
| `grantFileProtocolExtraPrivileges` | **`false` is the current recommendation** | VarLens currently has `true` — see below. |
| `wasmTrapHandlers` | `true` (where supported) | Not configurable via Electron 40 fuse wire yet, per VarLens baseline note — still accurate. |

Source: [Electron Fuses tutorial](https://www.electronjs.org/docs/latest/tutorial/fuses), [@electron/fuses README](https://github.com/electron/fuses/blob/main/README.md).

### `GrantFileProtocolExtraPrivileges` — is `true` still defensible in 2026?

**No, the official guidance is to disable it.** The fuse exists *only* for apps still serving pages from `file://` and that need fetch / service workers / "universal frame access" on those pages. Modern Electron apps should serve renderer assets from a **custom protocol** (e.g. `app://`) instead, at which point this fuse should be `false`. The doc explicitly says "if you aren't serving pages from file:// you should disable this fuse" ([Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)).

Security history: a 2024 fix (PR #40801) tightened the fuse so that disabling it also blocks `file://` CORS fetches from non-file origins — a previously unintended privilege escalation surface ([electron/electron#40801](https://github.com/electron/electron/pull/40801)).

For VarLens specifically: electron-vite already builds the renderer as static assets that are loaded from disk. Switching to a custom protocol (e.g. registering `app://` in main) is the standard Electron 40 pattern and would let you flip this fuse to `false`. **Forge/Webpack-based projects have hit problems with this fuse** (it broke their dev-mode entry points) but electron-vite users don't share that pain — VarLens uses electron-vite.

### New fuses

The `@electron/fuses` 1.8.x line introduced the **`strictlyRequireAllFuses` option** (already enabled in the VarLens baseline). It hard-fails the build if the Electron binary you're targeting has a fuse the build script does not configure — that's the right guard ([@electron/fuses npm](https://www.npmjs.com/package/@electron/fuses), [electron/fuses README](https://github.com/electron/fuses/blob/main/README.md)).

`WasmTrapHandlers` is exposed by `@electron/fuses` 2.x but not yet flippable on Electron 40's fuse wire — VarLens's note on this is still current. Re-check on Electron 41.

### asar integrity validation

Combined `embeddedAsarIntegrityValidation: true` + `onlyLoadAppFromAsar: true` is the documented modern baseline and is "the only way to ensure that the code in the asar is what was shipped" — VarLens already has this.

### `utilityProcess` API for native-addon isolation

The `utilityProcess` API (Electron-specific, sibling of `child_process.fork`) is now the recommended way to host native addons that you do not want in the main or renderer process. Unlike Node `worker_threads`, `utilityProcess` runs a *real OS process*, so native modules that aren't context-aware (or aren't thread-safe) work correctly. It supports MessagePorts for direct main↔utility and renderer↔utility communication ([Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). See Topic 7 for the worker-vs-utility decision.

### Recommendation for VarLens

1. **Switch the renderer to a custom protocol** (e.g. `app://`) and **flip `GrantFileProtocolExtraPrivileges` to `false`**.
2. **Evaluate `loadBrowserProcessSpecificV8Snapshot: true`** at the next Electron upgrade — there is no documented breakage in Electron 40 and it strengthens process isolation.
3. **Keep watching `WasmTrapHandlers`** — flip to `true` the moment Electron's fuse wire exposes it.

### Trade-off / migration cost

- Custom protocol migration is **Low-Medium**: register the protocol in main, update the index.html base path, audit any `file://` paths used by libraries (pdbe-molstar already does this correctly per AGENTS.md).
- **Migration cost overall: Low-Medium.**

**[ROADMAP IMPACT]** Flip `GrantFileProtocolExtraPrivileges` to `false` this milestone; document the custom-protocol migration as a small phase.

---

## 5. PostgreSQL Partitioning + Indexing for Genomic Variant Tables

### What the academic and platform literature does

- **LifeOmic's PostgreSQL variant search** uses two-level partitioning: primary by `project_id`, secondary shard by composite variant ID. They replaced "27 B-tree indexes across 29 columns" with **GIN over most columns + B-tree on a small set of fixed query patterns**, dropping query time to sub-second. Their bulk-load pattern is: drop indexes, COPY, then rebuild indexes — exactly what VarLens already does for SQLite ([Scaling Genetic Variant Search Part I](https://medium.com/lifeomic/scaling-genetic-variant-search-part-i-postgres-804be2076a9e)).
- **gnomAD v4 (955k samples)** does not use Postgres at scale — they store everything in Hail's VariantDataset (VDS) on object storage, 18 TB vs. 897 TB project VCF. ClinVar / VRS are increasingly aligned via GA4GH's Variation Representation Specification ([gnomAD v4 release notes](https://gnomad.broadinstitute.org/news/2023-11-gnomad-v4-0/), [GA4GH on VCF scaling](https://www.ga4gh.org/news_item/scaling-vcf-for-a-genomic-revolution/)).
- **htsget** (GA4GH) is a *retrieval* protocol, not a storage layer; it sits in front of BAM/CRAM/VCF and offers region-restricted streaming. Not directly applicable to VarLens's storage model but worth knowing for future "export to htsget" features.

### BRIN vs B-tree on `(chrom, pos)`

- **B-tree** wins on point lookups, equality, and exact range queries on unsorted data. Memory and disk footprint is proportional to row count.
- **BRIN** stores summaries per *block range* (8-page default). Tiny indexes (often <1 % of B-tree size). Effective *only* when data is physically clustered by the index column. For genomic data inserted in genome order (which is the natural VCF import order!), BRIN on `(chrom, pos)` is nearly free and almost as fast as B-tree for range scans ([PostgreSQL BRIN docs](https://www.postgresql.org/docs/current/brin.html), [Percona BRIN article](https://www.percona.com/blog/brin-index-for-postgresql-dont-forget-the-benefits/), [Cybertec btree vs BRIN](https://www.cybertec-postgresql.com/en/btree-vs-brin-2-options-for-indexing-in-postgresql-data-warehouses/)).
- The standard recommendation for chromosome-position lookups in well-clustered tables is: **BRIN on `(chrom, pos)`** as the primary range index + targeted B-trees for ID lookups + GIN on the JSONB blob.

### Native partitioning by chromosome — pros/cons

- **Pros:** trivial query pruning (filter by `chrom='1'` skips 23 other partitions), parallel index builds per partition, simpler maintenance (drop/rebuild a single chromosome).
- **Cons:** very uneven partition sizes (chr1 vs chrY), 24-30 child tables to manage, partition-key constraint propagation through foreign keys is awkward, every index becomes a partitioned index.
- Best practice in 2026 is to combine **list partitioning by chromosome** with **BRIN on `(pos)` within each partition** — gives you both pruning and minimal index footprint ([PostgreSQL partitioning docs](https://www.postgresql.org/docs/current/ddl-partitioning.html), [Crunchy Data on native partitioning](https://www.crunchydata.com/blog/native-partitioning-with-postgres)).
- The LifeOmic case suggests partitioning by **tenant / project** is often more impactful than by chromosome, because cross-chromosome queries are common in clinical work but cross-project queries are rare.

### GIN on JSONB for VEP annotations

- `CREATE INDEX ON variants USING GIN (info_json jsonb_path_ops)` accelerates `@>` containment and `?` key-exists queries.
- For per-key indexes (e.g. on `info_json->>'gene_symbol'`), an **expression B-tree** is usually faster than a generic GIN if the access pattern is known ([How to Index JSONB Columns](https://www.tigerdata.com/learn/how-to-index-json-columns-in-postgresql), [Postgres GIN guide](https://pganalyze.com/blog/gin-index)).

### `pg_trgm` for gene-symbol search

- `pg_trgm` GIN/GiST index unlocks **fast `ILIKE '%foo%'` and similarity search**. Standard for gene-symbol auto-complete and free-text search on annotation columns ([pg_trgm docs](https://www.postgresql.org/docs/current/pgtrgm.html)).
- Trigram indexes have false positives (recheck phase filters them), but speedup on substring search is usually 10-100×.

### Recommendation for VarLens (Postgres path)

1. **List-partition by chromosome** for `variants`. Default partition for non-canonical contigs.
2. **BRIN on `(pos)`** inside each partition; B-tree on `id` and any join keys.
3. **GIN with `jsonb_path_ops`** on `info_json` (single global index works fine with partitioning).
4. **`pg_trgm` GIN** on `gene_symbol` (and any text columns used for substring/similarity search).
5. **Keep the LifeOmic bulk-load pattern** (drop indexes, COPY, rebuild). Already in VarLens for the SQLite path; mirror it for Postgres COPY.

### Trade-off / migration cost

- Trade-off: partitioned tables add maintenance overhead (foreign-key changes, schema migrations apply per partition).
- **Migration cost: Medium** for the partitioning, **Low** for the BRIN/GIN/pg_trgm additions (pure CREATE INDEX migrations).

**[ROADMAP IMPACT]** BRIN + GIN + pg_trgm is "free wins" — pure index additions, no schema change. Worth landing in the next Postgres phase. Chromosome partitioning is a larger commitment and should be its own phase tied to a query benchmark that shows partition pruning matters.

---

## 6. Vue 3 Performance in 2026

### Vue 3.5 reactivity changes that matter for VarLens

- **`shallowRef` for large arrays** is *the* primary lever. Vue tracks only `.value`, not nested mutations. For a 100k variant list, `shallowRef([…])` vs `ref([…])` is the difference between dropped frames and 60fps ([Vue 3 reactivity trap](https://dev.to/ameer-pk/the-vue-3-reactivity-trap-why-large-datasets-crash-your-browser-1ikb), [Using shallowRef](https://dev.to/jacobandrewsky/using-shallowref-in-vue-to-improve-performance-559f)).
- **`markRaw`** for embedded *non-reactive* massive datasets — adds `__v_skip` and prevents Vue from ever proxying the object ([Reactivity API: Advanced](https://vuejs.org/api/reactivity-advanced)). Use for: reference data (HPO term cache, dbSNP lookup tables), molstar viewer instances, anything you store but never mutate.
- **Vue 3.5 reactivity overhaul:** "56 % less memory, up to 10× faster on large deeply nested arrays" ([Announcing Vue 3.5](https://blog.vuejs.org/posts/vue-3-5)). The codepath VarLens already exercises is faster on 3.5 than 3.4 — keep dependency current.
- **Reactive Props Destructure** stabilized in 3.5. Destructured props are now compiler-tracked; legacy `toRefs` workarounds can be removed.
- **`useTemplateRef()`** is the new idiomatic ref API — clearer than `ref(null)` for DOM refs and works inside composables.
- **`onWatcherCleanup()`** simplifies abort-old-fetch-on-rewatch — replaces manual `AbortController` plumbing in many composables.

### `defineAsyncComponent` and code-splitting

- `defineAsyncComponent(() => import('./Heavy.vue'))` is the standard pattern. Combine with `<Suspense>` for clean loading states. Lazy-loading large components is documented to cut initial bundle 30-50 % in real-world Vue projects ([LearnVue on lazy components](https://learnvue.co/articles/lazy-load-components)).
- Vuetify-specific addition: **`<v-lazy>`** intersects with the viewport and defers child rendering ([Vuetify Lazy component](https://vuetifyjs.com/en/components/lazy/)).

### `v-show` vs `v-if` for hidden tabs (CaseView use case)

- **`v-show`**: keeps the DOM, just toggles `display: none`. High initial cost, near-zero toggle cost. Best for tabs that toggle often and need state preservation.
- **`v-if`**: removes/recreates the DOM. Low initial cost, higher toggle cost. Best for rarely-shown content (error panels, admin views).
- Chrome profiler benchmarks reported up to **40 % lower CPU on `v-show`** for modal/dropdown toggles ([Vue conditional rendering docs](https://vuejs.org/guide/essentials/conditional.html), [Moldstud Vuetify performance](https://moldstud.com/articles/p-maximize-performance-with-vuetifyjs-best-practices-and-tips)).
- For CaseView tabs that fetch data and have user-modified state, **`v-show` + lazy mount on first activation** is the pattern: render `<v-if mounted>` inside a `<v-show>` wrapper, where `mounted` flips to `true` the first time the tab is shown. Don't put `v-if` directly on tab content — you'll lose user scroll/selection state.

### Recommendation for VarLens

1. **Convert any `ref([…])` that holds variant/case/cohort rows to `shallowRef`.** This is the highest-ROI single change available.
2. **Wrap large reference caches in `markRaw`** (HPO cache, gene catalog, ACMG rule tables — anything you read but don't mutate).
3. **Adopt the `v-show + first-mount-deferred` tab pattern** for CaseView. Keep state, defer initial cost.
4. **Stay current on Vue 3.5+** — performance gains are real and free.

### Trade-off / migration cost

- Trade-off: `shallowRef` requires explicit replacement when items inside the array change reference; you can't mutate in place and expect reactivity. Most VarLens row data is already immutable replacement, so this isn't a constraint.
- **Migration cost: Low.** Targeted edits in stores/composables.

**[ROADMAP IMPACT]** The `shallowRef` audit is a low-cost, high-impact win to land before any virtualization work. Spend one focused phase on a "reactivity hygiene" pass.

---

## 7. Background Jobs in Electron Desktop Apps

### worker_threads vs utilityProcess for VarLens

- **`worker_threads` + native modules is broken / dangerous** in Electron specifically: `process.dlopen` is not thread-safe, so loading `better-sqlite3-multiple-ciphers` in a worker thread is documented to crash production builds ([electron#43513](https://github.com/electron/electron/issues/43513), [better-sqlite3#237](https://github.com/JoshuaWise/better-sqlite3/issues/237)).
- **`utilityProcess` is the supported Electron way** to run native modules off the main thread: real OS process, full Node API, MessagePort to main/renderer, no thread-safety risk ([Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). VarLens's import/export workers already use this pattern (per AGENTS.md), which is correct.

### In-process worker pools

When the work is *CPU-bound JavaScript* (not native-addon) you don't need a separate process — a worker-thread pool is right.

- **`piscina`** (≥3k stars, maintained by NearForm) — clean promise-based API, configurable min/max workers and queue size, official Electron guide. The recommended modern worker pool ([piscina GitHub](https://github.com/piscinajs/piscina), [piscina Electron docs](https://piscinajs.dev/examples/Electron/), [Nearform's Piscina deep-dive](https://nearform.com/insights/learning-to-swim-with-piscina-the-node-js-worker-pool/)).
- **`workerpool`** — older, supports both worker_threads and child_process. Useful if you need that flexibility.
- Pick **piscina** for the in-process JS-CPU case.

### Redis-free job queues

- BullMQ requires Redis. Not appropriate for a single-user desktop app.
- **`bunqueue`** (Jan 2026) is a BullMQ-API-compatible queue backed by SQLite. Bun-targeted, but useful as a design reference ([Judoscale node task queue overview](https://judoscale.com/blog/node-task-queues), [bunqueue announcement](https://dev.to/egeominotti/i-built-a-job-queue-thats-32x-faster-than-bullmq-no-redis-required-1n5g)).
- For VarLens's needs (import, export, "fetch VEP annotations", scheduled cache refresh) the right pattern is much simpler than BullMQ: a **table in the existing SQLite** with `(id, type, payload, status, attempts, run_after, created_at)` and a tiny scheduler in the main process or a dedicated `utilityProcess`. Reuse the existing `better-sqlite3` connection; no new dependency. SQLite atomicity + a single-writer constraint handle concurrency.

### `--asar-unpack` for spawned tools

- Use `asarUnpack` (electron-builder config) for any binary you need to `spawn()` — Node's `child_process.spawn` cannot exec files inside an asar archive. Standard pattern; no recent changes.

### Recommendation for VarLens

1. **Keep `utilityProcess`** for any worker that touches `better-sqlite3-multiple-ciphers`. Do not migrate those to `worker_threads`.
2. **Add `piscina`** for CPU-bound *JS-only* tasks (VCF parse fan-out, JSON validation, large filter evaluation) — these don't need native modules and a pool gives you parallelism without per-task process startup cost.
3. **Build the job queue on SQLite + the existing scheduler pattern.** Do not add Redis. Do not adopt BullMQ. `bunqueue` is interesting but Bun-targeted.

### Trade-off / migration cost

- Trade-off: two parallelism mechanisms (`utilityProcess` for native-addon work, `piscina` for pure-JS CPU work). Document the split.
- **Migration cost: Low.** Additive.

---

## 8. Code Signing & Notarization in 2026

### Windows — SmartScreen reality check

- **EV certificates no longer bypass SmartScreen.** Microsoft's official docs explicitly state: *"Years ago, signing files with an Extended Validation (EV) code signing certificate would result in positive SmartScreen reputation by default, but this behavior no longer exists … Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified"* ([Microsoft SmartScreen reputation doc, updated 2026-05](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
- Both EV and OV certificates **build reputation through download volume**, same mechanism since the 2024 policy change.
- VarLens currently uses SSL.com eSigner (per project memory). That remains supported and is the right delivery mechanism (cloud HSM, no physical YubiKey on build agents).
- **Microsoft Artifact Signing** (formerly Trusted Signing) — Microsoft's own ~$10/month cloud signing service — is now the most cost-effective alternative for new projects. Identity-validated, CI-friendly, no hardware token. Worth knowing about; *not* a reason to migrate from SSL.com if everything works.
- **CA/Browser Forum rule: 458-day max validity** for code-signing certificates, enforced from March 1, 2026 ([SSL.com on EV vs OV](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)). VarLens's certificate rotation cadence must accommodate this.
- **Smart App Control (Windows 11)** may supersede SmartScreen for newer machines — it blocks unsigned files outright until they have positive reputation. Reinforces the "sign every release" rule.

### macOS — notarization in 2026

- **`notarytool` is mandatory; `altool` decommissioned** ([electron/notarize#189](https://github.com/electron/notarize/issues/189)).
- Auth: app-specific password, App Store Connect API key, or keychain profile. **Xcode 26+ now supports an individual API key — omit `appleApiIssuer` when using one** ([@electron/notarize](https://github.com/electron/notarize)).
- Hardened runtime is mandatory. Required entitlements for Electron: `com.apple.security.cs.allow-jit` (essential for V8), `com.apple.security.cs.allow-unsigned-executable-memory` (often needed). Without `allow-jit`, arm64 builds with Electron 20+ crash at launch.
- **March 2026 Apple notary outage** — multiple developers reported submissions stuck "In Progress" indefinitely. Bake retry logic into CI; don't gate `make release` on notarization completing in the same job.

### Linux — AppImage, Flatpak, AppImageUpdate

- **zsync is not deprecated**; AppImageUpdate releases continued shipping zsync delta updates through October 2025 ([AppImageUpdate releases](https://github.com/AppImageCommunity/AppImageUpdate/releases)).
- Delta-update flow remains: build produces `MyApp.AppImage` + `MyApp.AppImage.zsync`, host both, AppImageUpdate fetches only changed blocks.
- **Flatpak vs AppImage** for a clinical app: Flatpak gives sandboxing, runtimes, and a real update channel (Flathub or self-hosted), but commits you to its portal-mediated I/O model — meaningful friction for an app that needs arbitrary filesystem access (VCF/JSON import from anywhere). AppImage gives portability but weaker sandbox and a clunkier integration story. There is no consensus winner; clinical / medical apps with regulated update channels usually pick AppImage for its drag-and-drop install + signed payload, and ignore Flatpak for now ([AppImage vs Snap vs Flatpak](https://itsfoss.gitlab.io/post/appimage-vs-snap-vs-flatpak-linux-package-formats-compared/), [Pedro Innecco on AppImage integration](https://pedroinnecco.com/2025/09/linux-deserves-better-the-future-of-appimage-integration/)).

### Recommendation for VarLens

1. **Stay on SSL.com eSigner for Windows.** Do not pay extra for EV based on SmartScreen claims. Consider Microsoft Artifact Signing as a secondary signing option if SSL.com renewal becomes painful.
2. **Build certificate-rotation calendar reminders** around the 458-day cap.
3. **Add retry-on-failure for `notarytool`** in the release workflow; treat notarization as eventually-consistent.
4. **Keep AppImage + zsync** for Linux; revisit Flatpak only if user demand emerges from clinical IT.

### Trade-off / migration cost

- Trade-off: none for status quo. Just operational hardening.
- **Migration cost: Low** for the recommended changes (rotation calendar, notarize retry).

---

## Cross-cutting summary — what should change the near-term roadmap

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | **`shallowRef` audit** across stores/composables holding row data | Low | High — frees up CPU before any virtualization |
| 2 | **Flip `GrantFileProtocolExtraPrivileges` to `false`** via custom protocol migration | Low-Medium | High — closes a publicly-known privilege surface |
| 3 | **MessagePort streaming channel** for large IPC payloads | Medium | High — necessary precondition for any "thousands of cases" UI |
| 4 | **BRIN + GIN + pg_trgm** index additions on Postgres variant tables | Low | High — pure CREATE INDEX, big query speedup |
| 5 | **DuckDB SQLite-scanner spike** for cohort aggregates | Low | Medium — informs whether a third backend pays off |
| 6 | **Headless TanStack virtual inside Vuetify rows** for cohort matrix only | Medium | Medium — only after #1 and #3 ship |
| 7 | **Notary retry + cert rotation calendar** | Low | Medium — release reliability |

Things VarLens can **defer**:

- Replacing SQLite primary storage with DuckDB or chDB — not warranted in 2026.
- Chromosome-based Postgres partitioning — wait for a benchmark that shows pruning would matter for actual queries.
- Migrating from `utilityProcess` to anything else — the current pattern is the supported one.
- Moving Linux to Flatpak — no signal that users care.
- Paying for EV instead of OV code signing — Microsoft has explicitly removed the SmartScreen benefit.

---

## Source index

### Electron / IPC / fuses / signing
- [Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)
- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [@electron/fuses](https://github.com/electron/fuses)
- [PR: GrantFileProtocolExtraPrivileges blocks CORS](https://github.com/electron/electron/pull/40801)
- [Electron ArrayBuffer over IPC discussion](https://github.com/electron/electron/issues/9509)
- [Electron utilityProcess + better-sqlite3 issue](https://github.com/electron/electron/issues/43513)
- [Microsoft SmartScreen reputation 2026 doc](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [SSL.com EV vs OV](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)
- [@electron/notarize](https://github.com/electron/notarize)
- [AppImageUpdate](https://github.com/AppImageCommunity/AppImageUpdate)
- [AppImage vs Snap vs Flatpak](https://itsfoss.gitlab.io/post/appimage-vs-snap-vs-flatpak-linux-package-formats-compared/)

### Vue / Vuetify / virtualization
- [Vue 3.5 announcement](https://blog.vuejs.org/posts/vue-3-5)
- [Vue Reactivity API: Advanced](https://vuejs.org/api/reactivity-advanced)
- [Vue conditional rendering](https://vuejs.org/guide/essentials/conditional.html)
- [Vue 3 reactivity trap (DEV)](https://dev.to/ameer-pk/the-vue-3-reactivity-trap-why-large-datasets-crash-your-browser-1ikb)
- [Using shallowRef in Vue (DEV)](https://dev.to/jacobandrewsky/using-shallowref-in-vue-to-improve-performance-559f)
- [Vuetify virtual tables](https://vuetifyjs.com/en/components/data-tables/virtual-tables/)
- [Vuetify v-lazy](https://vuetifyjs.com/en/components/lazy/)
- [v-data-table-virtual performance bug](https://github.com/vuetifyjs/vuetify/issues/20335)
- [TanStack Virtual docs](https://tanstack.com/virtual/latest/docs/introduction)
- [TanStack vue-virtual adapter](https://tanstack.com/virtual/v3/docs/framework/vue/vue-virtual)
- [vue-virtual-scroller tutorial](https://www.digitalocean.com/community/tutorials/vuejs-vue-virtual-scroller)
- [LearnVue lazy components](https://learnvue.co/articles/lazy-load-components)

### Databases — DuckDB / SQLite / Postgres / variants
- [DuckDB 1.4.0 LTS announcement](https://duckdb.org/2025/09/16/announcing-duckdb-140)
- [DuckDB 1.4.2 LTS announcement](https://duckdb.org/2025/11/12/announcing-duckdb-142)
- [DuckDB 1.5.0 announcement](https://duckdb.org/2026/03/09/announcing-duckdb-150)
- [DuckDB data-at-rest encryption](https://duckdb.org/2025/11/19/encryption-in-duckdb)
- [DuckDB securing overview](https://duckdb.org/docs/stable/operations_manual/securing_duckdb/overview)
- [chDB introduction](https://clickhouse.com/blog/welcome-chdb-to-clickhouse)
- [ClickHouse vs chDB embedded](https://www.tinybird.co/blog/clickhouse-vs-chdb-embedded-clickhouse)
- [Kestra embedded DBs 2026](https://kestra.io/blogs/embedded-databases)
- [LifeOmic scaling genetic variant search](https://medium.com/lifeomic/scaling-genetic-variant-search-part-i-postgres-804be2076a9e)
- [PostgreSQL BRIN docs](https://www.postgresql.org/docs/current/brin.html)
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Cybertec btree vs BRIN](https://www.cybertec-postgresql.com/en/btree-vs-brin-2-options-for-indexing-in-postgresql-data-warehouses/)
- [Percona BRIN benefits](https://www.percona.com/blog/brin-index-for-postgresql-dont-forget-the-benefits/)
- [Crunchy Data native partitioning](https://www.crunchydata.com/blog/native-partitioning-with-postgres)
- [TigerData JSONB indexing](https://www.tigerdata.com/learn/how-to-index-json-columns-in-postgresql)
- [pganalyze GIN guide](https://pganalyze.com/blog/gin-index)
- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [GA4GH on VCF scaling](https://www.ga4gh.org/news_item/scaling-vcf-for-a-genomic-revolution/)
- [gnomAD v4 release](https://gnomad.broadinstitute.org/news/2023-11-gnomad-v4-0/)

### Background jobs / worker pools
- [piscina GitHub](https://github.com/piscinajs/piscina)
- [piscina Electron guide](https://piscinajs.dev/examples/Electron/)
- [Nearform Piscina deep-dive](https://nearform.com/insights/learning-to-swim-with-piscina-the-node-js-worker-pool/)
- [Judoscale Node task queues](https://judoscale.com/blog/node-task-queues)
- [bunqueue / SQLite-backed BullMQ alt](https://dev.to/egeominotti/i-built-a-job-queue-thats-32x-faster-than-bullmq-no-redis-required-1n5g)

### Offline sync architecture
- [Notion: How we made Notion available offline](https://www.notion.com/blog/how-we-made-notion-available-offline)
