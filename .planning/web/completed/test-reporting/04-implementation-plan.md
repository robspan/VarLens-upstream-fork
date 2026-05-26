# Implementation Record

Status: implemented first reporting runner (2026-05-12).

## Phase 0: Preserve Current Behavior

- Default `make ci` does not run web reporting.
- `VARLENS_WEB=1 make ci` still only extends the web gate as currently designed.
- `web-test-report` is a separate explicit target.
- `VARLENS_WEB=1 make web-test-report` runs the full web reporting lane, including parity, and
  fails if required prerequisites such as `VARLENS_PG_URL` are missing.
- In local web mode, the runner loads `.env.postgres.local` when `VARLENS_PG_URL` is not already
  exported and creates a per-run `VARLENS_RECOVERY_KEY_DIR` under the report artifact directory.

Acceptance:

- `make web-test-report` is opt-in.
- No browser window opens during reporting.

## Phase 1: Raw Suite Outputs

Implemented:

```text
scripts/reports/run-web-test-report.mjs
```

Responsibilities:

- create a unique run directory and refresh `latest/`
- run each configured suite as a separate child process
- write Vitest JSON and JUnit output for each suite
- capture exit code, stdout/stderr log paths, start/stop time
- continue to later suites even after failure
- exit non-zero at the end if any required suite failed

Make target:

```make
web-test-report:
	node scripts/reports/run-web-test-report.mjs
```

Acceptance:

- `make web-test-report` attempts all configured non-Postgres suites.
- `VARLENS_PG_URL=... make web-test-report` includes Postgres-backed integration.
- `VARLENS_WEB_REPORT_PARITY_E2E=1 VARLENS_PG_URL=... make web-test-report` includes data parity.
- `VARLENS_WEB=1 VARLENS_PG_URL=... make web-test-report` includes all of the above by default.
- `VARLENS_WEB=1 make web-test-report` can use the checked-in local Postgres profile when
  `.env.postgres.local` exists.
- Later suites still run if an earlier suite fails.

## Phase 2: Normalize to CTRF

Implemented inside `scripts/reports/run-web-test-report.mjs`.

Responsibilities:

- parses Vitest JSON outputs
- parses VarLens parity evidence from `.planning/artifacts/web/parity/latest.json`
- compacts `.planning/artifacts/web/test-reporting/latest/` to summary, logs, and stakeholder PDF
- keeps VarLens-specific data in CTRF `extra`

Acceptance:

- Every attempted test maps to a CTRF test case.
- Every manifest-backed parity fixture maps to a CTRF test case or case attachment entry.
- Setup failures are represented as failed synthetic setup cases, not lost process errors.

## Phase 3: Human Summary

Implemented:

```text
.planning/artifacts/web/test-reporting/latest/summary.md
.planning/artifacts/web/test-reporting/latest/stakeholder-report.pdf
.planning/artifacts/web/test-reporting/latest/logs/
```

Acceptance:

- A developer can identify failed suites without opening JSON.
- A stakeholder can read a plain-language validation report without command-level implementation
  detail.
- A color-coded PDF handoff report is produced next to the technical summary and logs.
- Raw reporter outputs and temporary render files are removed from the handoff artifact after the
  summary and PDF are produced.
- A harness-green run with incomplete exact IPC parity is reported as `INCOMPLETE`, not `PASSED`,
  and exits non-zero until all 23 stakeholder-facing IPC areas have exact parity evidence.
- IPC parity evidence is listed as 23 stakeholder-facing IPC areas separately from domain data parity
  evidence.
- Parity results show expected/actual counts, query summaries, and per-scenario SHA-256 fingerprints
  over normalized desktop/web result payloads.
- Parity failures show expected/actual counts and mismatch summaries.
- Cleanup success/failure is visible per parity scenario.

## Phase 4: Rich HTML Report

Deferred. See `../../backlog/test-reporting-rich-html-and-ci.md`.

## Phase 5: CI and PR Usage

Deferred. See `../../backlog/test-reporting-rich-html-and-ci.md`.

## Initial Suite Policy

Required when no `VARLENS_PG_URL` is present:

- `web-gate-static`
- `web-gate-parity` only if the built Electron output is available or the runner is allowed to build

Required when `VARLENS_PG_URL` is present:

- `web-gate-static`
- `web-gate-postgres`
- `web-gate-parity`
- `web-parity-e2e`

Optional:

- Allure HTML generation
- historical trend comparison across previous local run directories
