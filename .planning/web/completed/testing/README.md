# Web Testing Plan

Status: implemented test strategy (2026-05-12).

Two test tracks for the web build:

- [`desktop-to-web-parity.md`](desktop-to-web-parity.md) — web behaves like desktop. Tests at `tests/web-gate/`. Opt-in via `VARLENS_WEB=1 make test` (or direct: `make web-gate-*`).
- [`desktop-preservation.md`](desktop-preservation.md) — refactor preserves desktop. Tests at `tests/refactor-checkpoint/`. Always runs in default `make test`.

Mode toggle: see `AGENTS.md` "Mode toggle". Companion: [`../../context/decisions/postgres-backend.md`](../../context/decisions/postgres-backend.md). Source: web readiness planning.

Deferred expansions live in `../../backlog/testing-followups.md`.
