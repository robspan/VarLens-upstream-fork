# Test Reporting Follow-Ups

Status: backlog.

The first web report runner is implemented by `make web-test-report`. These follow-ups remain
useful, but they are not required for the local defensible-report baseline.

## Rich HTML Report

Add Allure or another established HTML report layer after the Markdown/CTRF baseline has had usage.

Requirements:

- generate static HTML only
- do not call a command that opens a browser
- keep missing HTML tooling separate from the core report runner
- write output under `.planning/artifacts/web/test-reporting/latest/`

## Web CI Artifact Upload

When the web lane stabilizes, upload report artifacts from explicit web CI jobs.

Requirements:

- default desktop CI remains unchanged
- web report artifacts stay gitignored locally
- GitHub Actions may add `summary.md` to `$GITHUB_STEP_SUMMARY`
- report generation must continue to run all suites and fail at the end
