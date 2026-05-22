# Acceptance Criteria

Use this as the bar before claiming either desktop-to-web behavioral equality or web release readiness.

Status note, 2026-05-12: the cleanup pass satisfied the current web equality mechanics for the first import/filter/auth lane. Full browser import/export support and built-image pre-push smoke remain backlog items, so this file must not be read as a web release-readiness claim.

## Always Required

- Desktop default workflow still works as before.
- Default `make ci`, `make test`, and `npm run test` remain desktop/researcher focused.
- Web prerequisites are only required under `VARLENS_WEB=1`, explicit `make web-*` targets, or web release/deploy workflows.
- Unsupported desktop APIs in web mode are explicitly listed as accepted divergence, gated in the UI, or implemented.

## Web Equality Claim

Do not claim desktop-to-web equality until these are true:

- `npm run build:web` passes.
- `make typecheck` passes.
- `make web-gate-static` passes with only intentional, documented skips/fails.
- An explicit opt-in Postgres-backed web gate target passes all web integration tests.
- Import/filter parity runs both Electron and web paths and compares equivalent normalized outputs.
- Auth behavioral parity runs both backends or both transports and compares observable outcomes.
- Web RPC errors cannot flow into renderer state as successful data.
- Web adapter tests cover the first adapted domains: variants, cohort, database startup, and auth.
- Event no-ops are either implemented or documented as accepted divergence.

## Web Release/Deploy Readiness

Do not publish/deploy a web image as validated until these are true:

- Root web CI runs for web-relevant paths.
- Web CI builds the web server and renderer.
- Web CI provisions or requires Postgres explicitly.
- Built image boots with Postgres and passes `/healthz`.
- Login wall and JSON logs are smoke-tested.
- `VARLENS_ADMIN_PASSWORD_HASH` is passed through compose/deploy wiring.
- Release/publish workflow depends on web CI success before building a new web image.
- Deploy docs describe Postgres-only web mode unless SQLite web mode is deliberately reintroduced.
