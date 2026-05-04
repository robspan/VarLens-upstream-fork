# Handover checklist — robspan/VarLens → Labor Berlin

The transfer itself is a one-click op (GitHub: Settings → Danger Zone → Transfer ownership). Everything below is the **delta** that has to happen around it. Baseline policy lives in `AGENTS.md` and the Charité Confluence.

## Mandatory swaps

1. **CLAUDE.md** — replace with the post-handover snapshot:
   ```bash
   cp .planning/handover/CLAUDE.post-handover.md CLAUDE.md
   git add CLAUDE.md && git commit -m "docs(claude): drop fork-specific override on handover"
   diff CLAUDE.md .planning/handover/CLAUDE.post-handover.md   # must be empty
   ```
2. **License posture** — `LICENSE` (MIT, Bernt's code) stays. Additions are "all rights reserved" by default; if Labor Berlin chooses an open license, add `NOTICE.md` distinguishing MIT-from-upstream vs. Labor-Berlin-licensed parts. Do not edit the existing `LICENSE`.
3. **Origin URL** — `git remote set-url origin <new-url>`. Hook + CI workflow are origin-agnostic.

## Stays as-is (do not delete on handover)

- `.planning/web/` — decision and testing-strategy records, project-level not fork-level.
- `tests/refactor-checkpoint/` — desktop-preservation snapshots; useful until the StorageSession refactor is complete.
- `tests/web-gate/` — Phase 1 gate suite.

## Memory

Operator-scoped Claude memory at `~/.claude/projects/-Users-robinspanier-Documents-GitHub-VarLens/memory/` is local to `robspan`, never travels with the repo, no action needed.

## Optional

- Commit-author email policy for new work — set per Labor Berlin preference; do **not** rewrite history.
- Repo visibility / Actions-minutes / hosting choice — Labor Berlin's call.

## Verification

```bash
make install-hooks
make sync-upstream     # no-op if recently synced
make ci                # local CI gate
```

If all three pass and `diff CLAUDE.md .planning/handover/CLAUDE.post-handover.md` is empty, the mechanical handover is done.
