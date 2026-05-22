# Web Cohort Association Support

Status: backlog
Created: 2026-05-12

## Why This Exists

Cohort read paths are implemented in web mode: query, summary, carriers, gene burden, and column metadata. Gene-burden association execution is still a desktop IPC workflow and does not map to the current web storage executor contract.

The cleanup pass makes this explicit:

- `cohort.getSummaryStatus` returns stable non-stale status for PostgreSQL web mode.
- `cohort.rebuildSummary`, `cohort.runAssociation`, and `cohort.cancelAssociation` return explicit `unsupported-web-capability` responses.

## Target Behavior

Choose one of these before implementing:

- Implement association as a web storage task backed by PostgreSQL.
- Gate the association-run UI in web mode while preserving read-only gene burden views.

## Acceptance Checks

- Direct web RPC calls no longer return 501 for supported association behavior.
- Progress events are implemented if association execution is enabled.
- Renderer tests prove the web UI either hides the run action or can run/cancel association.
- Default desktop tests remain unchanged; web association tests run only in web lanes.
