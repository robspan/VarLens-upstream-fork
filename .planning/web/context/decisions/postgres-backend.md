# Decision: Postgres is the web-build backend

Status: decided (2026-05-04)
Branch target: `VarLens-Web`
Resolves: open question in `desktop-to-web-parity.md` §"Postgres in the gate"

## Decision

For the hosted web deployment, **Postgres is the only supported backend**. SQLite remains the desktop-only path.

## Rationale

- **`better-sqlite3` is synchronous.** It blocks the Node event loop. In Electron this is mitigated by the Piscina read-pool in `src/main/ipc/dbPoolManager.ts` (one DB handle per worker, `query_only=ON`). Under Fastify a single slow query stalls every other request on that process. Replicating the desktop pool trick on a server adds cost without buying anything Postgres doesn't already give us.
- **Postgres is async, network-native, and concurrency-safe by construction.** It matches what Node web frameworks expect, and gives multi-user, RLS, backups, and monitoring as standard infrastructure concerns.
- **The work is mostly done.** `StorageSession` (`src/main/storage/session.ts`) already abstracts both backends. Phase 16/16.1/16.2 closed the import perf gap to 1.85× SQLite via `COPY FROM STDIN` with STORED generated `search_document` columns. Schema parity is in place.
- **Encryption story is a desktop concern.** `better-sqlite3-multiple-ciphers` solves at-rest encryption for a single-user desktop file. On the server, disk/DB encryption is handled at the infrastructure layer (volume encryption, Postgres TDE, AWS KMS).

## Consequences for Phase 1 gate suite

- The import-and-filter scenario in `desktop-to-web-parity.md` §Layer 3 runs against **Postgres**, not SQLite. Update scenario #1 accordingly.
- `read-concurrency.parity.test.ts` (Layer 3, deferred) is **dropped from the web track**. The "better-sqlite3 sync API + Piscina pool under HTTP concurrency" risk it covers is moot — the web backend is Postgres. Keep the test only if it is useful for desktop regression.
- `migrations-idempotent.test.ts` boots against a Postgres tmp database for the web build (still SQLite for desktop).
- Postgres-readiness lints (AUTOINCREMENT, etc.) called out in §"Future" can move forward immediately as a Phase 1 input rather than a Stage 2 deferral.

## Non-goals

- This decision does **not** remove the SQLite backend. Desktop ships SQLite. Both backends remain behind `StorageSession`.
- This is **not** a commitment to a specific Postgres host (managed service vs self-managed). Hosting is decided separately by the deployment operator.

## Follow-ups

- Update `desktop-to-web-parity.md` §Layer 3 scenario #1 to specify Postgres.
- Decide whether `read-concurrency.parity.test.ts` is dropped or kept as desktop-only regression.
- Open a Phase 1 task to enable the Postgres-readiness lints early.
