# ADR 0002 — Parallel maintainability: single codebase, two transports

Status: Accepted (2026-05-04)
Related: [`../web/testing/desktop-to-web-parity.md`](../web/testing/desktop-to-web-parity.md), [`../web/phase1-execution-plan.md`](../web/phase1-execution-plan.md)

## Context

The web variant must reproduce desktop behavior on every observable surface. Maintaining two parallel implementations of domain logic would guarantee drift; a shared codebase requires a discipline mechanism the test suite can enforce.

## Decision

Domain logic lives in **one** module per domain (`src/main/ipc/handlers/<name>-logic.ts`). Both transports — Electron IPC handler and Fastify web route — import the **same function**. No re-implementation on either side.

The seam is enforced structurally:

- `tests/web-gate/handler-seam.test.ts` scans `src/web/routes/<name>.ts` and asserts each file imports from the corresponding `src/main/ipc/handlers/<name>-logic` (or `<name>`) module. A web route that re-implements logic fails the gate.
- `tests/web-gate/db-seam.test.ts` ensures domain logic accesses storage only through `StorageSession`, never via `getDatabaseService()` / `getDbPool()` shortcuts.

## Consequences

- A new IPC handler that ships on desktop is automatically usable from web (after a thin route wiring). The reverse holds.
- Refactors that change a `<name>-logic` function affect both transports identically. The `tests/web-gate/parity/` suite catches any divergence in observable behavior.
- Transport-specific concerns (event subscription on Electron IPC, SSE/WebSocket on web) are handled at the route/handler layer. Logic functions remain transport-agnostic.
- The discipline cost is one rule (`grep -rn "getDatabaseService\\|getDbPool" src/`) and one structural test, not constant code review for parallel-impl drift.
