# Web Planning Index

This folder is the single home for robspan's VarLens web-track planning. Keep the active web
migration record here so the repo does not split one project across unrelated `.planning/`
directories.

## Reading Order And Status

| Area | Purpose |
| --- | --- |
| `context/` | Inputs and accepted decisions. Read first; not a task list. |
| `completed/` | Completed execution plans only. Historical, not current truth. |
| `active/` | Current or mixed workstreams that still contain open verification, stale claims, or implementation gaps. |
| `backlog/` | Deferred work and next-stage plans. Important, but not in the current execution lane. |
| `operations/` | Ongoing operator evidence and audits. |

## Status Rule

Folder name communicates lifecycle:

- `context/` means information that constrains the work.
- `completed/` means a phase plan is done; do not use it as a live checklist.
- `active/` means current execution work or mixed planning that still needs cleanup before it can be archived.
- `backlog/` means not current yet; move items into `active/` when they become execution work.
- `operations/` means operational records that can keep growing over time.

## Completion Rule

When an `active/` workstream finishes:

1. Update its own status/acceptance docs first.
2. Move the final record or summary into `completed/`.
3. Leave only genuinely unfinished follow-ups in `backlog/`.
4. Do not leave completed work in `active/` just because it used to be active.

Before moving a folder into `completed/`, verify the whole folder. If even one file still contains
open work, stale claims that change the current interpretation, or acceptance criteria not yet met,
the folder stays in `active/` or gets split.

## Naming Rule

- Use lifecycle folders at the top level so web planning has one obvious status model.
- Use numbered files inside active topic folders when order matters.
- Use dates in filenames for point-in-time audits, reports, and restore logs.
- Put dated QA reports and operator notes under `operations/`, not `completed/`, unless they are
  the final summary of a closed execution plan.
- Keep generated outputs under `.planning/artifacts/`, not in this folder.
- Move completed or obsolete web material to `.planning/archive/` only after the active web index no
  longer needs it.
