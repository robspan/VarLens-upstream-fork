# Handover checklist — robspan/VarLens → Labor Berlin

This folder collects everything that must be reviewed, swapped, or removed when the private fork is transferred from `robspan/VarLens` to a Labor Berlin / Charité-controlled GitHub account or self-hosted Git host.

The transfer itself is a one-click operation (GitHub: Settings → Danger Zone → Transfer ownership). Everything below is the **content/policy work** that has to happen around that transfer.

## Repository state at handover

- Origin: private GitHub repo on `robspan` account.
- Upstream: `berntpopp/VarLens` (public, MIT) — referenced via `upstream` remote, sync-only.
- Active work branch: `VarLens-Web`.
- Default branch: `main` (mirror of upstream, fast-forwarded via `make sync-upstream`).

## Mandatory swaps before handover

### 1. CLAUDE.md → revert the fork-specific override

The current `CLAUDE.md` contains a section **"Fork-specific override: direct pushes to main are allowed"** that exists only because this is a private single-operator fork. Once the repo is multi-operator under Labor Berlin, the upstream "no direct commits to main" rule from `AGENTS.md` should reapply.

**Action:** replace the contents of `/CLAUDE.md` with the snapshot in this folder:

```bash
cp .planning/handover/CLAUDE.post-handover.md CLAUDE.md
git add CLAUDE.md
git commit -m "docs(claude): drop fork-specific override on handover to Labor Berlin"
```

Verify with `diff CLAUDE.md .planning/handover/CLAUDE.post-handover.md` — should be empty.

### 2. Memory cleanup (Claude Code-specific)

The auto-memory at `~/.claude/projects/-Users-robinspanier-Documents-GitHub-VarLens/memory/` contains entries scoped to the operator persona ("internal-IT contractor", "Charité downstream fork"). On handover, those memories belong to the new operator's environment, not the old one.

**Action:** the new operator's Claude session will build its own memory. The original memories under `robspan`'s `~/.claude/...` path do **not** travel with the repo and do **not** need to be migrated. No action required in the repo.

### 3. Confirm license posture

- `LICENSE` (Bernt Popp's MIT) stays as-is — it covers his code.
- Once Labor Berlin has the repo, **they** decide the license terms for the additions (`.planning/web/`, web/server layers, IaC, etc.). Until they do, those additions remain "all rights reserved" by default.
- If Labor Berlin chooses MIT (or any open license) for their additions, add a top-level `NOTICE.md` clarifying which parts are MIT-from-upstream vs. Labor-Berlin-licensed.
- Do not edit the existing `LICENSE` file to claim coverage over additions; that would misrepresent the upstream MIT notice.

### 4. Remote configuration (post-transfer)

After GitHub transfers the repo, the operator's local clone needs:

```bash
git remote set-url origin <new-url>
# upstream remote stays unchanged
```

The `pre-commit` hook (installed via `make install-hooks`) and `upstream-sync-check.yml` workflow continue to function — they don't depend on the origin URL.

### 5. Decision records that should stay

- `.planning/web/decision-postgres-as-web-backend.md` — Postgres backend choice for the web build.
- `.planning/web/testing/desktop-to-web-parity.md` and related — Phase 1 gate suite design.

These are project decisions, not fork-specific overrides. They travel with the repo.

## Optional but recommended

### Author email on existing commits

The git history contains commits authored as `robin.spanier@robspan.de`. If Labor Berlin prefers a Labor-Berlin domain for new commits going forward, set `git config user.email` accordingly in the new operator's clone. **Do not rewrite history** — that would invalidate signatures and cause conflicts with the upstream sync.

### Repository visibility

The new owner decides whether to keep it private, make it internal to a Labor Berlin GitHub org, or publish under a Labor-Berlin-chosen license.

### CI Actions minutes

If the destination is a private GitHub repo, Actions consumes paid minutes. Consider whether self-hosted runners or a Charité-internal Git host (Gitea/Forgejo) is preferable for the long-term home.

## Verification after handover

Run from the transferred repo:

```bash
make install-hooks
make sync-upstream     # should be a no-op if recently synced
make ci                # full local CI gate
```

If all three succeed and `diff CLAUDE.md .planning/handover/CLAUDE.post-handover.md` is empty, the handover is mechanically complete. The remaining work (license decisions, hosting decisions, organisational policy) is for Labor Berlin.
