# Suite Inventory

This inventory maps the existing web command surface to reporting responsibilities.

## Current Commands

| Command | Layer | Preconditions | Reporting expectation |
| --- | --- | --- | --- |
| `make web-gate-static` | Static and fast integration | Node ABI native module | Vitest JSON + JUnit + CTRF cases. |
| `make web-gate-integration` | Integration subset | Built web output for fail-loud server tests | Same as static, with skipped tests clearly marked. |
| `make web-gate-postgres` | Postgres-backed integration | `VARLENS_PG_URL`, `build-web` | Required in full web report when Postgres is available. |
| `make web-gate-parity` | Desktop-to-web parity sentinels | Built Electron main, Electron ABI | Separate suite boundary because it switches native ABI. |
| `make web-parity-e2e` | Real-data manifest parity | `VARLENS_PG_URL`, data fixtures, built app | Emits VarLens parity evidence plus standard test results. |
| `make web-data-verify` | Fixture/source contract | Network/cache only during gather; generated fixture files | Included as a preparation stage in full parity reports. |

## Current Test Files

| Area | Files | Report grouping |
| --- | --- | --- |
| Static architecture gates | `tests/web-gate/*.test.ts` | `web-gate/static` |
| Web server integration | `tests/web-gate/integration/**/*.test.ts` | `web-gate/integration` |
| Auth/session parity | `tests/web-gate/parity/auth-scenarios.parity.test.ts` | `web-gate/parity-auth` |
| Import/filter parity | `tests/web-gate/parity/import-and-filter.test.ts` | `web-gate/parity-import-filter` |
| Manifest data parity | `tests/web-gate/parity/data-manifest-parity.test.ts` | `web-gate/data-manifest-parity` |
| Fixture contracts | `tests/web-gate/data-fixtures.test.ts` plus `scripts/data-fixtures/*` | `web-gate/data-fixtures` |

## Reporting Rules Per Area

### Static Architecture Gates

Static gates should report as normal test cases. Their failures are often refactor guidance rather
than runtime parity failures, so the report should label them as `static`.

### Integration Tests

Integration tests that skip because `out/web/` or `VARLENS_PG_URL` is absent must be reported as
skipped, not hidden. In a full Postgres-backed report, missing Postgres is a setup failure.

### Parity Tests

Parity suites must include the backend pair under comparison:

- desktop backend: Electron app + SQLite
- web backend: Fastify web server + PostgreSQL

For each parity case, the report records the input fixture, normalized comparison fields, mismatch
count, and cleanup status.

### Data Preparation

Data gathering and preparation are not tests in the Vitest sense, but the report must include their
outcome. Treat each fixture as a reportable preparation case with:

- source URL or local cache path
- checksum when available
- generated fixture path
- transform script version or git SHA
- verification outcome

