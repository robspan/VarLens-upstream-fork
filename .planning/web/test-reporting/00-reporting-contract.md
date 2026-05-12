# Reporting Contract

## Goal

Produce a defensible report for the opt-in web validation lane:

1. What command ran.
2. What commit and environment it ran against.
3. Which web suites were attempted.
4. Which tests passed, failed, skipped, or were intentionally not applicable.
5. Which desktop-vs-web parity scenarios used real data.
6. Whether each scenario cleaned up after itself.
7. Where raw evidence and human-readable reports are stored.

The report should let a developer say: "Given this input data and this commit, we mechanically
compared the desktop SQLite path and the web PostgreSQL path as far as the current web lane
implements it."

## Non-Goals

- Do not add web reporting to default `make ci`.
- Do not require Docker, PostgreSQL, Java, browser launches, or web build artifacts for desktop-only
  contributors.
- Do not pretend web has feature-complete parity where tests only cover a subset.
- Do not commit generated reports or downloaded datasets to git.
- Do not turn the report into a research-grade clinical validation package. It is an engineering
  parity and migration report.

## Required Properties

| Property | Requirement |
| --- | --- |
| Opt-in | Web reports run only through explicit web targets such as `make web-test-report`. |
| Atomic suites | Heavy suites that mutate state get their own setup and teardown boundary. |
| Continue-on-failure | The orchestrator attempts later suites even if an earlier suite fails. |
| Fail at end | A failing suite makes the final command fail after report generation. |
| No browser openings | HTML report generation must not auto-open a browser or GUI. |
| Gitignored artifacts | Machine outputs live under `.planning/artifacts/web/` and remain uncommitted. |
| Standard formats | Raw results should include common formats before VarLens-specific aggregation. |
| Human summary | A developer-readable report is generated beside machine-readable outputs. |

## Artifact Layout

Planned location:

```text
.planning/artifacts/web/test-reporting/
  latest/
    manifest.json
    summary.md
    ctrf-report.json
    junit/
      web-gate.xml
      web-gate-parity.xml
      web-parity-e2e.xml
    vitest/
      web-gate.json
      web-gate-parity.json
      web-parity-e2e.json
    parity/
      latest.json
      latest.md
    allure-results/
    allure-report/
  runs/
    <utc-timestamp>-<short-sha>/
      ...
```

`latest/` is disposable. `runs/` is useful for comparing a short sequence of local attempts and
should still be gitignored.

## Report Boundaries

There are two report classes:

1. **Gate report**: summarizes all opt-in web-gate suites, including Rob's static, integration, and
   parity tests.
2. **Data parity report**: summarizes manifest-backed real-data parity checks only. It is nested
   inside the gate report, but it remains readable on its own.

Keeping these separate prevents a broad "web gate failed" from hiding the more specific question:
"Did the same imported data produce the same observable result?"

