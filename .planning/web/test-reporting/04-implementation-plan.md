# Implementation Plan

## Phase 0: Preserve Current Behavior

- Confirm default `make ci` does not run web reporting.
- Confirm `VARLENS_WEB=1 make ci` still only extends the web gate as currently designed.
- Keep report targets separate from existing test targets until the report path is stable.

Acceptance:

- Desktop-only commands produce no `.planning/artifacts/web/test-reporting/` output.
- No browser window opens during reporting.

## Phase 1: Raw Suite Outputs

Add a report runner script, tentatively:

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

Planned Make target:

```make
web-test-report:
	node scripts/reports/run-web-test-report.mjs
```

Acceptance:

- `make web-test-report` attempts all configured non-Postgres suites.
- `VARLENS_PG_URL=... make web-test-report` includes Postgres-backed integration and data parity.
- Later suites still run if an earlier suite fails.

## Phase 2: Normalize to CTRF

Add a converter, tentatively:

```text
scripts/reports/web-test-report/ctrf.mjs
```

Responsibilities:

- parse Vitest JSON outputs
- parse VarLens parity evidence from `.planning/artifacts/web/parity/latest.json`
- emit `.planning/artifacts/web/test-reporting/latest/ctrf-report.json`
- keep VarLens-specific data in CTRF `extra`

Acceptance:

- Every attempted test maps to a CTRF test case.
- Every manifest-backed parity fixture maps to a CTRF test case or case attachment entry.
- Setup failures are represented as failed synthetic setup cases, not lost process errors.

## Phase 3: Human Summary

Generate:

```text
.planning/artifacts/web/test-reporting/latest/summary.md
```

Acceptance:

- A developer can identify failed suites without opening JSON.
- Parity failures show expected/actual counts and mismatch summaries.
- Cleanup success/failure is visible per parity scenario.

## Phase 4: Rich HTML Report

Add Allure as an optional presentation layer after CTRF and Markdown are working.

Responsibilities:

- produce `allure-results/` during reported Vitest runs or convert normalized evidence into Allure
  result files
- run `allure generate`, not `allure serve`
- write output under `latest/allure-report/`
- document Java or CLI prerequisites if required

Acceptance:

- HTML report is generated without opening a browser.
- Missing Allure tooling fails only the HTML report target, not the core CTRF/Markdown report.

## Phase 5: CI and PR Usage

Once local reporting is stable, wire it into an explicit web lane:

- keep default desktop CI unchanged
- add a web-report artifact upload in web-only CI
- optionally print the Markdown summary into GitHub Actions job summary
- keep generated reports gitignored

Acceptance:

- A PR can attach the web report as an artifact.
- The report says when Postgres/data parity was not run and why.
- The report distinguishes static architecture failures from data parity mismatches.

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

