# Tooling Strategy

The report stack should use established formats first and VarLens-specific structure second.

## Selected Layers

| Layer | Tooling | Why |
| --- | --- | --- |
| Raw test output | Vitest `json` and `junit` reporters | Already installed, no new runtime dependency, useful in CI systems. |
| Normalized exchange | CTRF JSON | Common schema across test frameworks, easy to merge and inspect. |
| Human report | Markdown summary plus Allure HTML | Markdown is reviewable; Allure provides richer navigation, metadata, steps, and attachments. |
| VarLens evidence | Existing parity JSON/Markdown | Captures domain-specific facts that generic reporters cannot infer. |

## Source Notes

- Vitest supports multiple reporters at once and can write `json`/`junit` outputs via `outputFile`.
  It also supports blob reports for later merging.
  Source: <https://vitest.dev/guide/reporters>
- Playwright has built-in JSON, JUnit, HTML, and blob reporters. Its HTML reporter can be configured
  with `open: "never"`, which matters if VarLens later moves browser E2E tests under Playwright.
  Source: <https://playwright.dev/docs/test-reporters>
- Allure's Vitest adapter supports structured metadata, hierarchy, steps, attachments, environment
  information, and test-plan selection. `allure generate` creates a static HTML report; `allure
  serve` opens a browser and should not be used by automation.
  Source: <https://allurereport.org/docs/vitest/>
- CTRF is an open JSON report format intended to keep the same structure across frameworks. It
  requires test `name`, `status`, and `duration`, while allowing extra metadata.
  Source: <https://ctrf.io/>

## Decision

Implement reporting in this order:

1. Generate raw Vitest JSON and JUnit for each web suite.
2. Convert raw suite outputs plus VarLens parity evidence into one `ctrf-report.json`.
3. Generate `summary.md` from the normalized report.
4. Add Allure output as an opt-in rich report layer after the core normalized report is stable.

This avoids building the whole system around Allure before the evidence model is correct. Allure is
the presentation layer, not the only source of truth.

## Browser Behavior

No reporting command may open a browser automatically.

- Do not use `allure serve` in Make targets.
- If Playwright HTML reports are added later, set `open: "never"` or
  `PLAYWRIGHT_HTML_OPEN=never`.
- If Vitest HTML reporter is considered later, confirm it does not leave a dev server running in
  automation before enabling it.

## Dependency Policy

Phase 1 should use existing dependencies only.

Phase 2 may add:

- `allure-vitest`
- an Allure CLI package or documented local prerequisite
- a CTRF reporter package only if direct conversion from Vitest JSON proves weaker than the package

All added dependencies stay on the web-reporting path and must not affect default desktop commands.

