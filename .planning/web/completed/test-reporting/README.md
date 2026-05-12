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

- raw Vitest JSON
- JUnit XML
- CTRF JSON
- Markdown summary
- stdout/stderr logs per suite

Heavy parity remains explicit:

```bash
VARLENS_WEB_REPORT_PARITY=1 make web-test-report
VARLENS_WEB_REPORT_PARITY_E2E=1 VARLENS_PG_URL=... make web-test-report
```

## Operating Rule

The report is evidence, not a new hidden gate. A failing test should still be visible in the final
report, and the report generator should preserve as much diagnostic data as possible before
returning a failing exit code.
