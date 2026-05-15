# Web Test Reporting

Status: implemented first reporting runner (2026-05-12).

This folder records the implemented reporting layer for the opt-in web validation lane.

The goal is not to make default desktop CI heavier. Default `make ci` must keep running the
desktop suite only. Reporting for web mode is an explicit web-track action that a developer or
operator runs when they need evidence that the current branch preserves the desktop behavior and
that the web migration gates are in a known state.

## Documents

| File | Purpose |
| --- | --- |
| `00-reporting-contract.md` | Reporting goals, non-goals, artifact rules, and opt-in guarantees. |
| `01-suite-inventory.md` | Current web-related test surfaces and how each should appear in reports. |
| `02-tooling-strategy.md` | Reporter tooling choice: raw Vitest outputs, CTRF normalization, and Allure HTML. |
| `03-report-model.md` | Normalized evidence model for run metadata, suites, cases, parity scenarios, and cleanup. |
| `04-implementation-plan.md` | Step-by-step implementation plan and acceptance criteria. |

## Implemented Command

```bash
make web-test-report
```

The command writes gitignored artifacts under:

```text
.planning/artifacts/web/test-reporting/
  latest/
  runs/<timestamp>-<sha>/
```

It currently emits:

- color-coded PDF handoff report
- separate IPC/API surface and domain data parity sections
- per-scenario desktop/web parity fingerprints over normalized result payloads
- Markdown summary
- stdout/stderr logs per suite

The report package is intentionally compact. Raw Vitest JSON, JUnit XML, CTRF JSON, transient
HTML/Markdown render inputs, and generated secret material are used during the run, then removed
from the handoff artifact. The retained files are:

```text
.planning/artifacts/web/test-reporting/latest/
  summary.md
  stakeholder-report.pdf
  logs/
```

The report has a separate harness status and report status. A run where all commands pass but exact
IPC parity is not complete is reported as `INCOMPLETE`, not `PASSED`, and returns a failing exit code
so automation cannot treat 4/23 IPC parity coverage as a full validation pass.

Heavy parity remains explicit:

```bash
VARLENS_WEB_REPORT_PARITY=1 make web-test-report
VARLENS_WEB_REPORT_PARITY_E2E=1 VARLENS_PG_URL=... make web-test-report
```

When web mode itself is active, the report runner treats that as the full web lane:

```bash
VARLENS_WEB=1 VARLENS_PG_URL=... make web-test-report
```

If `VARLENS_PG_URL` is not already exported, the runner loads `.env.postgres.local` in this mode.
It also creates a per-run `VARLENS_RECOVERY_KEY_DIR` under the report artifact directory when none is
provided. Postgres-backed integration and manifest parity are required. Missing Postgres
configuration is a failing prerequisite, not a harmless skip.

## Operating Rule

The stakeholder PDF is the handoff artifact. The technical summary and logs are the retained evidence
package behind it. Raw reporter files remain implementation details: the runner uses them to compute
the report, then removes them so the artifact folder stays small. A failing test should still be
visible in the final report before the command returns a failing exit code.

For parity evidence, the manifest-backed data test compares normalized desktop SQLite results against
normalized web PostgreSQL results directly and records matching SHA-256 fingerprints in the report.
The hash is not the assertion by itself; it is the compact stakeholder-facing proof that the compared
result payloads were identical for that run.

The stakeholder report intentionally separates IPC parity evidence from domain data parity. IPC
coverage uses the 23 stakeholder-facing IPC areas as the report inventory. IPC rows that do not yet
have an exact desktop/web result scenario are marked as needing parity tests instead of being hidden
behind the manifest fixture count. Domain data parity means the covered clinical data workflows
produced identical normalized results across desktop SQLite and web PostgreSQL.
