# Spec: Real-engine regression test for transcript-switch denormalization (issue #207)

- **Date:** 2026-06-15
- **Issue:** [#207](https://github.com/berntpopp/VarLens/issues/207) — "Postgres backend: switching selected transcript does not update parent variants row"
- **Status:** Approved (autonomous goal directive) → executing
- **Type:** Test hardening (no production code change)

## Background

Issue #207 reported that on the Postgres backend, switching the selected transcript
flipped `variant_transcripts.is_selected` but failed to update the denormalized
transcript columns on the parent `variants` row (`transcript`, `gene_symbol`,
`consequence`, `cdna`, `aa_change`, `hpo_sim_score`, `moi`). SQLite did this correctly.

**The bug itself is already fixed.** PR #214 ("web 01: add shared contracts and storage
seams", merged 2026-05-25 — five days after the issue was filed) moved the Postgres
transcript writes into a single shared module, `PostgresTranscriptsRepository`, whose
`switchSelectedTranscript` and `insertTranscriptAndSwitch` both call
`updateVariantFromSelectedTranscript` inside the transaction. Both desktop IPC
(`PostgresWriteExecutor`) and the web routes (`src/web/server/routes/transcripts.ts`)
dispatch through the same `StorageWriteExecutor` seam, so the two surfaces cannot drift —
exactly the architecture the issue's "Suggested fix" recommended.

## The gap this spec closes

The issue's "Regression test" section asked for a Vitest case that runs **against the
real Postgres test container** (gated by `VARLENS_RUN_POSTGRES_E2E=1`). What exists today:

| Existing coverage | What it proves | What it does NOT prove |
|---|---|---|
| `tests/main/storage/postgres-transcripts-repository.test.ts` | The exact `UPDATE <schema>.variants` SQL + params are issued (mocked `pg` client) | That a real Postgres engine applies it to the row |
| `tests/main/database/transcripts.test.ts` | SQLite repository updates the denormalized columns | Nothing about Postgres; bypasses the write-executor seam |
| `tests/main/storage/storage-session-contract.test.ts` | The two backends expose the same **interface** | Explicitly **defers** cross-backend **behavioral** parity (see its lines 141-159) |

So no test exercises the issue #207 scenario against a real database engine through the
production dispatch path. A Postgres migration that renamed a column, a generated-column
conflict, a type-coercion bug, or a transaction-visibility problem would pass every
existing test while breaking the feature. That is the regression class this spec covers.

## Goal

Add a behavioral regression test, parameterized over both backends, that:

1. Seeds a `case` + `variant` + two `variant_transcripts` (A selected, B not), with the
   `variants` row initially carrying transcript A's denormalized values.
2. Exercises the **production write-executor seam**
   (`session.getWriteExecutor().execute({ type: 'transcripts:switch', ... })`) to switch
   A → B.
3. Reads the `variants` row back from the real engine and asserts every denormalized
   column now equals transcript B's value.
4. Repeats for `transcripts:insertAndSwitch` with a VEP-only transcript C.

A and B differ in **every** denormalized field, so a no-op update (the original bug)
fails every assertion — the test has inherent teeth.

## Scope

- **In:** one new parameterized test file in `tests/main/storage/`. SQLite half always
  runs; Postgres half gated by `VARLENS_RUN_POSTGRES_E2E=1` + a running dev container,
  matching `storage-session-contract.test.ts`.
- **Out:** any production code change (the fix is already correct and shipped); changes to
  the existing mock/SQLite tests; the web HTTP route layer (covered separately by the
  web-gate parity scenario).

## Design

New file: `tests/main/storage/transcript-switch-denormalization.test.ts`.

Reuse the `setupSqlite` / `setupPostgres` fixture pattern from
`storage-session-contract.test.ts` (unique throwaway schema per Postgres run, dropped on
cleanup; `VARLENS_PG_URL` env override; default left as-is). Each fixture additionally
exposes:

- `seedVariantWithTranscripts(): Promise<number>` — inserts case + variant + transcripts
  A/B via the backend's native client (better-sqlite3 for SQLite via
  `DatabaseService.database`; a dedicated `pg.Client` for Postgres, schema-qualified,
  never touching the STORED generated `search_document` columns). Returns the variant id.
- `readVariantDenorm(variantId): Promise<DenormFields>` — reads the seven denormalized
  columns back from the same engine.

Shared test body operates only on `session.getWriteExecutor()` and the two fixture
helpers, so the assertions are identical across backends.

### Fixture data

| Transcript | id | gene_symbol | consequence | cdna | aa_change | hpo_sim_score | moi | is_selected |
|---|---|---|---|---|---|---|---|---|
| A (initial) | `NM_AAA.1` | `GENEA` | `missense_variant` | `c.1A>G` | `p.Met1Val` | 0.10 | `AD` | 1 |
| B (switch to) | `NM_BBB.2` | `GENEB` | `stop_gained` | `c.2C>T` | `p.Gln2Ter` | 0.90 | `AR` | 0 |
| C (insertAndSwitch, VEP-only) | `ENST_CCC.1` | `GENEC` | `splice_acceptor_variant` | `c.3-1G>A` | `null` | 0.55 | `XL` | n/a |

## Verification

- `make rebuild-node` then run the SQLite half (always runs): must pass.
- `make pg-up`, then
  `VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55434/varlens_dev npx vitest run --project main tests/main/storage/transcript-switch-denormalization.test.ts`:
  both backends must pass.
- `make typecheck` and `make lint-check` clean.
- The default `make test` (no env var) runs only the SQLite half, so CI is unaffected and
  no Postgres container is required for the default suite.

## Out-of-scope follow-ups (not done here)

- Generalizing the deferred cross-backend behavioral-parity harness in
  `storage-session-contract.test.ts` (rule-of-three; only the second scenario exists after
  this).
